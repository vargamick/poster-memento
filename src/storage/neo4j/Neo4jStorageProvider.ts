import type {
  StorageProvider,
  SearchOptions,
  PaginationOptions,
  PaginatedKnowledgeGraph,
  PaginationMetadata
} from '../StorageProvider.js';
import type { KnowledgeGraph, Entity } from '../../KnowledgeGraphManager.js';
import type { Relation, RelationMetadata } from '../../types/relation.js';
import type { EntityEmbedding, SemanticSearchOptions } from '../../types/entity-embedding.js';
import { v4 as uuidv4 } from 'uuid';
import { Neo4jConnectionManager } from './Neo4jConnectionManager.js';
import { DEFAULT_NEO4J_CONFIG, type Neo4jConfig } from './Neo4jConfig.js';
import { Neo4jSchemaManager } from './Neo4jSchemaManager.js';
import { logger } from '../../utils/logger.js';
import neo4j from 'neo4j-driver';
import { Neo4jVectorStore } from './Neo4jVectorStore.js';
import { EmbeddingServiceFactory } from '../../embeddings/EmbeddingServiceFactory.js';
import type { EmbeddingService } from '../../embeddings/EmbeddingService.js';
import {
  initializeDateFormatterFromEnv,
  formatDateForStorage,
  formatDateForDisplay,
  formatTimestampForAPI
} from '../../utils/dateFormatter.js';
import { CypherValidator, Neo4jErrorHandler } from '../../utils/cypherValidator.js';
import {
  PaginationConfig,
  loadPaginationConfigFromEnvironment,
  calculateOffsetFromPage,
  calculateTotalPages
} from '../../config/PaginationConfig.js';
import { VectorStoreFactory, type VectorStoreFactoryOptions } from '../VectorStoreFactory.js';
import type { VectorStore } from '../../types/vector-store.js';
import { PostgresConnectionManager } from '../postgres/PostgresConnectionManager.js';
import { PostgresVectorStore } from '../postgres/PostgresVectorStore.js';

/**
 * Escape special regex characters in a string to use it as a literal match
 * @param str The string to escape
 * @returns The escaped string safe for use in regex patterns
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Configuration options for Neo4j storage provider
 */
export interface Neo4jStorageProviderOptions {
  /**
   * Neo4j connection configuration
   */
  config?: Partial<Neo4jConfig>;

  /**
   * Pre-configured connection manager (optional)
   */
  connectionManager?: Neo4jConnectionManager;

  /**
   * Configuration for temporal confidence decay
   */
  decayConfig?: {
    /**
     * Whether confidence decay is enabled
     */
    enabled: boolean;

    /**
     * Number of days for confidence to decay by half (default: 30)
     */
    halfLifeDays?: number;

    /**
     * Minimum confidence threshold below which confidence won't decay (default: 0.1)
     */
    minConfidence?: number;
  };

  /**
   * Vector store configuration
   * Allows choosing between Neo4j and PostgreSQL for vector storage
   */
  vectorStoreOptions?: VectorStoreFactoryOptions;
}

/**
 * Extended Entity interface with additional properties needed for Neo4j
 */
interface ExtendedEntity extends Entity {
  id?: string;
  version?: number;
  createdAt?: number;
  updatedAt?: number;
  validFrom?: number;
  validTo?: number | null;
  changedBy?: string | null;
}

/**
 * Extended Relation interface with additional properties needed for Neo4j
 * Note: This doesn't extend Relation to avoid type conflicts with strength/confidence
 */
interface ExtendedRelation {
  id?: string;
  from: string;
  to: string;
  relationType: string;
  version?: number;
  createdAt?: number;
  updatedAt?: number;
  validFrom?: number;
  validTo?: number | null;
  changedBy?: string | null;
  strength?: number | null | undefined;
  confidence?: number | null | undefined;
  metadata?: Record<string, unknown> | null;
}

// These interfaces are used for documentation purposes to understand the Neo4j data model

/**
 * Extended SemanticSearchOptions with additional properties needed for Neo4j
 */
interface Neo4jSemanticSearchOptions extends SemanticSearchOptions {
  queryVector?: number[];
}

/**
 * Knowledge graph with optional diagnostics
 */
interface KnowledgeGraphWithDiagnostics extends KnowledgeGraph {
  diagnostics?: Record<string, unknown>;
}

/**
 * A storage provider that uses Neo4j to store the knowledge graph
 */
export class Neo4jStorageProvider implements StorageProvider {
  private connectionManager: Neo4jConnectionManager;
  private schemaManager: Neo4jSchemaManager;
  private readonly config: Neo4jConfig;
  private readonly decayConfig: {
    enabled: boolean;
    halfLifeDays: number;
    minConfidence: number;
  };
  private vectorStore: VectorStore;
  private embeddingService: EmbeddingService | null = null;
  private paginationConfig: PaginationConfig;

  /**
   * Create a new Neo4jStorageProvider
   * @param options Configuration options
   */
  constructor(options?: Neo4jStorageProviderOptions) {
    // Initialize date formatter from environment variables
    initializeDateFormatterFromEnv();
    
    // Set up pagination configuration
    this.paginationConfig = loadPaginationConfigFromEnvironment();
    
    // Set up configuration
    this.config = {
      ...DEFAULT_NEO4J_CONFIG,
      ...(options?.config || {}),
    };

    // Configure decay settings
    this.decayConfig = {
      enabled: options?.decayConfig?.enabled ?? true,
      halfLifeDays: options?.decayConfig?.halfLifeDays ?? 30,
      minConfidence: options?.decayConfig?.minConfidence ?? 0.1,
    };

    // Set up connection manager
    this.connectionManager = options?.connectionManager || new Neo4jConnectionManager(this.config);

    // Set up schema manager
    this.schemaManager = new Neo4jSchemaManager(this.connectionManager, this.config, false);

    // Set up vector store based on configuration
    this.vectorStore = this.createVectorStore(options?.vectorStoreOptions);

    logger.debug('Neo4jStorageProvider: Initializing embedding service');
    try {
      // Set up embedding service
      this.embeddingService = EmbeddingServiceFactory.createFromEnvironment();
      logger.debug('Neo4jStorageProvider: Embedding service initialized successfully', {
        provider: this.embeddingService.getProviderInfo().provider,
        model: this.embeddingService.getProviderInfo().model,
        dimensions: this.embeddingService.getProviderInfo().dimensions,
      });
    } catch (error) {
      logger.error('Neo4jStorageProvider: Failed to initialize embedding service', error);
    }

    // Initialize the schema and vector store
    this.initializeSchema().catch((err) => {
      logger.error('Failed to initialize Neo4j schema', err);
    });
  }

  /**
   * Get the connection manager (primarily for testing)
   */
  getConnectionManager(): Neo4jConnectionManager {
    return this.connectionManager;
  }

  /**
   * Create a vector store based on configuration
   * @param vectorStoreOptions Optional vector store configuration
   * @returns VectorStore instance (Neo4j or PostgreSQL)
   */
  private createVectorStore(vectorStoreOptions?: VectorStoreFactoryOptions): VectorStore {
    const vectorType = vectorStoreOptions?.type || 'neo4j';

    logger.info('Neo4jStorageProvider: Creating vector store', {
      type: vectorType,
      indexName: vectorStoreOptions?.indexName || this.config.vectorIndexName,
    });

    if (vectorType === 'postgres') {
      // Create PostgreSQL vector store
      if (!vectorStoreOptions?.postgresConfig) {
        logger.warn(
          'Neo4jStorageProvider: PostgreSQL vector store requested but no config provided, falling back to Neo4j'
        );
        return this.createNeo4jVectorStore(vectorStoreOptions);
      }

      const postgresConnectionManager = new PostgresConnectionManager(
        vectorStoreOptions.postgresConfig
      );

      return new PostgresVectorStore({
        connectionManager: postgresConnectionManager,
        tableName: vectorStoreOptions.indexName || 'entity_embeddings',
        dimensions: vectorStoreOptions.dimensions || this.config.vectorDimensions,
        similarityFunction: vectorStoreOptions.similarityFunction || 'cosine',
      });
    }

    // Default: Create Neo4j vector store
    return this.createNeo4jVectorStore(vectorStoreOptions);
  }

  /**
   * Create a Neo4j vector store
   * @param vectorStoreOptions Optional vector store configuration
   * @returns Neo4jVectorStore instance
   */
  private createNeo4jVectorStore(vectorStoreOptions?: VectorStoreFactoryOptions): Neo4jVectorStore {
    return new Neo4jVectorStore({
      connectionManager: this.connectionManager,
      indexName: vectorStoreOptions?.indexName || this.config.vectorIndexName,
      dimensions: vectorStoreOptions?.dimensions || this.config.vectorDimensions,
      similarityFunction: vectorStoreOptions?.similarityFunction || 'cosine',
      entityNodeLabel: 'Entity',
    });
  }

  /**
   * Build pagination parameters for Neo4j queries
   * @param options Pagination options
   * @returns Processed pagination parameters
   */
  private buildPaginationParams(options: PaginationOptions = {}): {
    offset: number;
    limit: number;
    skip?: number;
  } {
    // Handle page-based navigation
    if (options.page && options.pageSize) {
      const offset = calculateOffsetFromPage(options.page, options.pageSize);
      const limit = Math.min(options.pageSize, this.paginationConfig.maxPageSize);
      return { offset, limit, skip: offset };
    }

    // Handle offset/limit navigation
    const offset = options.offset || 0;
    const limit = Math.min(
      options.limit || this.paginationConfig.defaultLimit,
      this.paginationConfig.maxLimit
    );

    return { offset, limit, skip: offset };
  }

  /**
   * Build pagination metadata from query results
   * @param options Original pagination options
   * @param returned Number of results returned
   * @param total Total count (if available)
   * @param queryTime Query execution time
   * @returns Pagination metadata
   */
  private buildPaginationMetadata(
    options: PaginationOptions,
    returned: number,
    total: number | undefined,
    queryTime: number
  ): PaginationMetadata {
    const { offset, limit } = this.buildPaginationParams(options);
    
    const metadata: PaginationMetadata = {
      offset,
      limit,
      returned,
      total,
      hasMore: returned === limit, // If we got exactly the limit, there might be more
      queryTime,
    };

    // Add page-based metadata if using page navigation
    if (options.page && options.pageSize) {
      metadata.currentPage = options.page;
      if (total !== undefined) {
        metadata.totalPages = calculateTotalPages(total, options.pageSize);
      }
    }

    return metadata;
  }

  /**
   * Convert KnowledgeGraph to PaginatedKnowledgeGraph
   * @param graph Original knowledge graph
   * @param options Pagination options used
   * @param total Total count (if available)
   * @returns Paginated knowledge graph
   */
  private toPaginatedKnowledgeGraph(
    graph: KnowledgeGraph,
    options: PaginationOptions,
    total?: number
  ): PaginatedKnowledgeGraph {
    const pagination = this.buildPaginationMetadata(
      options,
      graph.entities.length,
      total,
      graph.timeTaken || 0
    );

    return {
      entities: graph.entities,
      relations: graph.relations,
      total: graph.total,
      timeTaken: graph.timeTaken,
      diagnostics: (graph as any).diagnostics,
      pagination,
    };
  }

  /**
   * Initialize Neo4j schema
   */
  private async initializeSchema(): Promise<void> {
    try {
      await this.schemaManager.initializeSchema(false);
      logger.info('Neo4j schema initialized successfully');

      // Initialize vector store after schema is ready
      try {
        await this.vectorStore.initialize();
        logger.info('Neo4j vector store initialized successfully');
      } catch (vectorError) {
        logger.error('Failed to initialize Neo4j vector store', vectorError);
        // Continue even if vector store initialization fails
      }
    } catch (schemaError) {
      logger.error('Failed to initialize Neo4j schema', schemaError);
      throw schemaError;
    }
  }

  /**
   * Close Neo4j connections
   */
  async close(): Promise<void> {
    try {
      await this.connectionManager.close();
      logger.debug('Neo4j connections closed');
    } catch (error) {
      logger.error('Error closing Neo4j connections', error);
    }
  }

  /**
   * Execute a validated Cypher query with enhanced error handling
   * @param query The Cypher query to validate and execute
   * @param parameters Query parameters
   * @param queryId Optional query identifier for debugging
   * @returns Query result
   */
  private async executeValidatedQuery(
    query: string,
    parameters: Record<string, unknown> = {},
    queryId?: string
  ): Promise<any> {
    try {
      // Validate the query before execution
      const validation = CypherValidator.validateQuery(query, {
        maxLength: 50000,
        requireSemicolon: false
      });

      // Log validation results
      CypherValidator.logValidationResult(query, validation, queryId);

      // If validation failed, throw an error with helpful suggestions
      if (!validation.isValid) {
        const errorDetails = {
          type: 'QUERY_VALIDATION_ERROR',
          message: 'Cypher query failed validation',
          errors: validation.errors,
          warnings: validation.warnings,
          query: query.substring(0, 500) + (query.length > 500 ? '...' : ''),
          queryId
        };
        
        logger.error('Query validation failed', errorDetails);
        throw new Error(`Query validation failed: ${validation.errors.join(', ')}`);
      }

      // Use sanitized query if available
      const finalQuery = validation.sanitizedQuery || query;

      // Execute the validated query
      const result = await this.connectionManager.executeQuery(finalQuery, parameters);
      
      // Log successful execution
      logger.debug(`Query executed successfully${queryId ? ` [${queryId}]` : ''}`, {
        queryLength: finalQuery.length,
        parametersCount: Object.keys(parameters).length,
        recordsReturned: result.records?.length || 0
      });

      return result;
    } catch (error) {
      // Enhanced error handling with suggestions
      const parsedError = Neo4jErrorHandler.parseError(error);
      
      logger.error(`Query execution failed${queryId ? ` [${queryId}]` : ''}`, {
        errorType: parsedError.type,
        message: parsedError.message,
        suggestions: parsedError.suggestions,
        isRecoverable: parsedError.isRecoverable,
        query: query.substring(0, 200) + (query.length > 200 ? '...' : ''),
        parameters: Object.keys(parameters)
      });

      // Re-throw with enhanced error information
      const enhancedError = new Error(`${parsedError.message}${queryId ? ` [Query: ${queryId}]` : ''}`);
      (enhancedError as any).suggestions = parsedError.suggestions;
      (enhancedError as any).isRecoverable = parsedError.isRecoverable;
      (enhancedError as any).originalError = error;
      
      throw enhancedError;
    }
  }

  /**
   * Execute a raw Cypher query (public method for custom queries)
   * @param query The Cypher query to execute
   * @param parameters Query parameters
   * @returns Query result with records
   */
  async runCypher(
    query: string,
    parameters: Record<string, unknown> = {}
  ): Promise<{ records: any[] }> {
    return this.executeValidatedQuery(query, parameters, 'runCypher');
  }

  /**
   * Convert a Neo4j node to an entity object
   * @param node Neo4j node properties
   * @returns Entity object
   */
  private nodeToEntity(node: Record<string, unknown>): ExtendedEntity {
    const observations =
      typeof node.observations === 'string' ? JSON.parse(node.observations as string) : [];

    return {
      name: node.name as string,
      entityType: node.entityType as string,
      observations,
      id: node.id as string | undefined,
      version: node.version as number | undefined,
      createdAt: node.createdAt as number | undefined,
      updatedAt: node.updatedAt as number | undefined,
      validFrom: node.validFrom as number | undefined,
      validTo: node.validTo as number | null | undefined,
      changedBy: node.changedBy as string | null | undefined,
    };
  }

  /**
   * Parse a Neo4j relationship into a relation object
   * Enhanced with detailed error logging and data preservation
   * @param rel Relationship properties
   * @param fromNode From node name
   * @param toNode To node name
   * @returns Relation object
   */
  private relationshipToRelation(
    rel: Record<string, unknown>,
    fromNode: string,
    toNode: string
  ): Relation {
    // Extract timestamps from the Neo4j relation for metadata
    const now = Date.now();
    const createdAt = (rel.createdAt as number) || now;
    const updatedAt = (rel.updatedAt as number) || now;

    // Create metadata with required fields as a flexible Record type
    const metadata: Record<string, unknown> & RelationMetadata = {
      createdAt,
      updatedAt,
    };

    // Enhanced metadata parsing with detailed error handling
    if (typeof rel.metadata === 'string' && rel.metadata) {
      try {
        const parsedMetadata = JSON.parse(rel.metadata as string);
        Object.assign(metadata, parsedMetadata);
      } catch (parseError) {
        // Log detailed error information for debugging
        logger.error('Failed to parse relation metadata - preserving unparseable data', {
          from: fromNode,
          to: toNode,
          relationType: rel.relationType,
          metadataPreview: rel.metadata.substring(0, 100),
          errorMessage: parseError instanceof Error ? parseError.message : String(parseError),
          errorType: parseError instanceof Error ? parseError.constructor.name : typeof parseError,
        });
        
        // Preserve unparseable metadata in special fields for recovery
        metadata._unparseable_metadata = rel.metadata;
        metadata._parse_error = parseError instanceof Error ? parseError.message : 'JSON parse failed';
        metadata._parse_error_timestamp = now;
      }
    } else if (rel.metadata && typeof rel.metadata === 'object') {
      // Metadata already parsed as object
      Object.assign(metadata, rel.metadata as Record<string, unknown>);
    }

    // Create a standard Relation object with proper type handling
    return {
      from: fromNode,
      to: toNode,
      relationType: rel.relationType as string,
      // Convert null to undefined for compatibility with Relation interface
      strength: (rel.strength as number | null) === null ? undefined : (rel.strength as number),
      confidence:
        (rel.confidence as number | null) === null ? undefined : (rel.confidence as number),
      metadata,
    };
  }

  /**
   * Load the complete knowledge graph from Neo4j
   */
  async loadGraph(): Promise<KnowledgeGraph> {
    try {
      const startTime = Date.now();

      // Load entities query
      const entityQuery = `
        MATCH (e:Entity)
        WHERE e.validTo IS NULL
        RETURN e
      `;

      // Execute query to get all current entities
      const entityResult = await this.connectionManager.executeQuery(entityQuery, {});

      // Process entity results
      const entities = entityResult.records.map((record) => {
        const node = record.get('e').properties;
        return this.nodeToEntity(node);
      });

      // Load relations query
      const relationQuery = `
        MATCH (from:Entity)-[r:RELATES_TO]->(to:Entity)
        WHERE r.validTo IS NULL
        RETURN from.name AS fromName, to.name AS toName, r
      `;

      // Execute query to get all current relations
      const relationResult = await this.connectionManager.executeQuery(relationQuery, {});

      // Process relation results
      const relations = relationResult.records.map((record) => {
        const fromName = record.get('fromName');
        const toName = record.get('toName');
        const rel = record.get('r').properties;

        return this.relationshipToRelation(rel, fromName, toName);
      });

      const timeTaken = Date.now() - startTime;

      // Return the complete graph
      return {
        entities,
        relations,
        total: entities.length,
        timeTaken,
      };
    } catch (error) {
      logger.error('Error loading graph from Neo4j', error);
      throw error;
    }
  }

  /**
   * Save a complete knowledge graph to Neo4j (warning: this will overwrite existing data)
   * @param graph The knowledge graph to save
   */
  async saveGraph(graph: KnowledgeGraph): Promise<void> {
    try {
      // Start a new session
      const session = await this.connectionManager.getSession();

      try {
        // Begin transaction
        const txc = session.beginTransaction();

        try {
          // Delete all existing data
          await txc.run('MATCH (n) DETACH DELETE n', {});

          // Process entities
          for (const entity of graph.entities) {
            const extendedEntity = entity as ExtendedEntity;
            const params = {
              id: extendedEntity.id || uuidv4(),
              name: entity.name,
              entityType: entity.entityType,
              observations: JSON.stringify(entity.observations || []),
              version: extendedEntity.version || 1,
              createdAt: extendedEntity.createdAt || Date.now(),
              updatedAt: extendedEntity.updatedAt || Date.now(),
              validFrom: extendedEntity.validFrom || Date.now(),
              validTo: extendedEntity.validTo || null,
              changedBy: extendedEntity.changedBy || null,
            };

            // Create entity
            await txc.run(
              `
              CREATE (e:Entity {
                id: $id,
                name: $name,
                entityType: $entityType,
                observations: $observations,
                version: $version,
                createdAt: $createdAt,
                updatedAt: $updatedAt,
                validFrom: $validFrom,
                validTo: $validTo,
                changedBy: $changedBy
              })
            `,
              params
            );
          }

          // Process relations
          for (const relation of graph.relations) {
            const extendedRelation = relation as ExtendedRelation;
            const params = {
              id: extendedRelation.id || uuidv4(),
              fromName: relation.from,
              toName: relation.to,
              relationType: relation.relationType,
              strength: relation.strength || null,
              confidence: relation.confidence || null,
              metadata: relation.metadata ? JSON.stringify(relation.metadata) : null,
              version: extendedRelation.version || 1,
              createdAt: extendedRelation.createdAt || Date.now(),
              updatedAt: extendedRelation.updatedAt || Date.now(),
              validFrom: extendedRelation.validFrom || Date.now(),
              validTo: extendedRelation.validTo || null,
              changedBy: extendedRelation.changedBy || null,
            };

            // Create relation
            await txc.run(
              `
              MATCH (from:Entity {name: $fromName})
              MATCH (to:Entity {name: $toName})
              CREATE (from)-[r:RELATES_TO {
                id: $id,
                relationType: $relationType,
                strength: $strength,
                confidence: $confidence,
                metadata: $metadata,
                version: $version,
                createdAt: $createdAt,
                updatedAt: $updatedAt,
                validFrom: $validFrom,
                validTo: $validTo,
                changedBy: $changedBy
              }]->(to)
            `,
              params
            );
          }

          // Commit transaction
          await txc.commit();
          logger.info(
            `Saved graph with ${graph.entities.length} entities and ${graph.relations.length} relations to Neo4j`
          );
        } catch (error) {
          // Rollback on error
          await txc.rollback();
          throw error;
        }
      } finally {
        // Close session
        await session.close();
      }
    } catch (error) {
      logger.error('Error saving graph to Neo4j', error);
      throw error;
    }
  }

  /**
   * Search for nodes in the graph that match the query
   * @param query The search query string
   * @param options Optional search parameters
   */
  async searchNodes(query: string, options: SearchOptions = {}): Promise<PaginatedKnowledgeGraph> {
    try {
      const startTime = Date.now();
      
      // Build pagination parameters
      const paginationParams = this.buildPaginationParams(options);
      
      // Prepare search parameters - escape special regex chars to prevent invalid patterns
      const parameters: Record<string, unknown> = {
        query: `(?i).*${escapeRegex(query)}.*`, // Case-insensitive regex pattern
        skip: neo4j.int(paginationParams.offset),
        limit: neo4j.int(paginationParams.limit),
      };

      // Add entity type filter if provided
      let entityTypeFilter = '';
      if (options.entityTypes && options.entityTypes.length > 0) {
        entityTypeFilter = 'AND e.entityType IN $entityTypes';
        parameters.entityTypes = options.entityTypes;
      }

      // Build the search query with pagination
      const searchQuery = `
        MATCH (e:Entity)
        WHERE (e.name =~ $query OR e.entityType =~ $query OR e.observations =~ $query)
        ${entityTypeFilter}
        AND e.validTo IS NULL
        RETURN e
        SKIP $skip
        LIMIT $limit
      `;

      // Execute the search
      const result = await this.connectionManager.executeQuery(searchQuery, parameters);

      // Process entity results
      const entities = result.records.map((record) => {
        const node = record.get('e').properties;
        return this.nodeToEntity(node);
      });

      // Get total count if requested
      let total: number | undefined;
      if (options.includeTotalCount) {
        const countQuery = `
          MATCH (e:Entity)
          WHERE (e.name =~ $query OR e.entityType =~ $query OR e.observations =~ $query)
          ${entityTypeFilter}
          AND e.validTo IS NULL
          RETURN count(e) as total
        `;
        
        // Build query parameters explicitly to avoid TypeScript spread operator issues
        const countQueryParams: Record<string, unknown> = {
          query: parameters.query
        };
        if (parameters.entityTypes) {
          countQueryParams.entityTypes = parameters.entityTypes;
        }
        
        const countResult = await this.connectionManager.executeQuery(countQuery, countQueryParams);
        
        total = countResult.records[0]?.get('total').toNumber();
      }

      // Get relations between found entities
      let relations: Relation[] = [];
      const entityNames = entities.map((e) => e.name);
      if (entityNames.length > 0) {
        const relationsQuery = `
          MATCH (from:Entity)-[r:RELATES_TO]->(to:Entity)
          WHERE from.name IN $entityNames
          AND to.name IN $entityNames
          AND r.validTo IS NULL
          RETURN from.name AS fromName, to.name AS toName, r
        `;

        const relationsResult = await this.connectionManager.executeQuery(relationsQuery, {
          entityNames,
        });

        // Process relation results
        relations = relationsResult.records.map((record) => {
          const fromName = record.get('fromName');
          const toName = record.get('toName');
          const rel = record.get('r').properties;

          return this.relationshipToRelation(rel, fromName, toName);
        });
      }

      const timeTaken = Date.now() - startTime;

      // Create knowledge graph
      const graph: KnowledgeGraph = {
        entities,
        relations,
        total: entities.length,
        timeTaken,
      };

      // Convert to paginated graph
      return this.toPaginatedKnowledgeGraph(graph, options, total);
    } catch (error) {
      logger.error('Error searching nodes in Neo4j', error);
      throw error;
    }
  }

  /**
   * Open specific nodes by their exact names
   * @param names Array of node names to open
   * @param options Optional pagination parameters
   */
  async openNodes(names: string[], options: PaginationOptions = {}): Promise<PaginatedKnowledgeGraph> {
    try {
      const startTime = Date.now();

      if (!names || names.length === 0) {
        const emptyGraph: KnowledgeGraph = { entities: [], relations: [] };
        return this.toPaginatedKnowledgeGraph(emptyGraph, options);
      }

      // Build pagination parameters
      const paginationParams = this.buildPaginationParams(options);

      // Apply pagination to the names array if needed
      const paginatedNames = names.slice(paginationParams.offset, paginationParams.offset + paginationParams.limit);

      // Query for entities by name
      const entityQuery = `
        MATCH (e:Entity)
        WHERE e.name IN $names
        AND e.validTo IS NULL
        RETURN e
      `;

      // Execute query to get entities
      const entityResult = await this.connectionManager.executeQuery(entityQuery, { names: paginatedNames });

      // Process entity results
      const entities = entityResult.records.map((record) => {
        const node = record.get('e').properties;
        return this.nodeToEntity(node);
      });

      // Get total count if requested
      let total: number | undefined;
      if (options.includeTotalCount) {
        total = names.length; // Total is just the length of the names array
      }

      // Get relations between the specified entities
      const relationsQuery = `
        MATCH (from:Entity)-[r:RELATES_TO]->(to:Entity)
        WHERE from.name IN $names
        AND to.name IN $names
        AND r.validTo IS NULL
        RETURN from.name AS fromName, to.name AS toName, r
      `;

      // Execute query to get relations
      const relationsResult = await this.connectionManager.executeQuery(relationsQuery, { names: paginatedNames });

      // Process relation results
      const relations = relationsResult.records.map((record) => {
        const fromName = record.get('fromName');
        const toName = record.get('toName');
        const rel = record.get('r').properties;

        return this.relationshipToRelation(rel, fromName, toName);
      });

      const timeTaken = Date.now() - startTime;

      // Create knowledge graph
      const graph: KnowledgeGraph = {
        entities,
        relations,
        total: entities.length,
        timeTaken,
      };

      // Convert to paginated graph
      return this.toPaginatedKnowledgeGraph(graph, options, total);
    } catch (error) {
      logger.error('Error opening nodes in Neo4j', error);
      throw error;
    }
  }

  /**
   * Create new entities in the knowledge graph
   * @param entities Array of entities to create
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async createEntities(entities: any[]): Promise<any[]> {
    try {
      if (!entities || entities.length === 0) {
        return [];
      }

      const session = await this.connectionManager.getSession();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const createdEntities: any[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const skippedEntities: any[] = [];

      try {
        // Begin transaction
        const txc = session.beginTransaction();

        try {
          // Check for existing entities first
          const entityNames = entities.map(e => e.name);
          const existingQuery = `
            MATCH (e:Entity)
            WHERE e.name IN $names AND e.validTo IS NULL
            RETURN e.name AS existingName
          `;
          
          const existingResult = await txc.run(existingQuery, { names: entityNames });
          const existingNames = existingResult.records.map(r => r.get('existingName'));
          
          // Separate new entities from duplicates
          const newEntities = entities.filter(e => !existingNames.includes(e.name));
          const duplicateEntities = entities.filter(e => existingNames.includes(e.name));
          
          // Log duplicate information for debugging
          if (duplicateEntities.length > 0) {
            logger.info(`Neo4j createEntities: Skipping ${duplicateEntities.length} duplicate entities: ${duplicateEntities.map(e => e.name).join(', ')}`);
            skippedEntities.push(...duplicateEntities.map(e => ({
              name: e.name,
              entityType: e.entityType,
              reason: 'duplicate',
              message: 'Entity with this name already exists'
            })));
          }
          
          // Log processing summary
          logger.info(`Neo4j createEntities: Processing ${entities.length} entities - ${newEntities.length} new, ${duplicateEntities.length} duplicates`);

          for (const entity of newEntities) {
            // Generate temporal and identity metadata
            const now = Date.now();
            const entityId = uuidv4();

            // Add debug log for embedding generation attempts
            logger.debug(
              `Neo4jStorageProvider: Processing embeddings for entity "${entity.name}"`,
              {
                entityType: entity.entityType,
                hasEmbeddingService: !!this.embeddingService,
              }
            );

            // Generate embedding if embedding service is available
            let embedding = null;
            if (this.embeddingService) {
              try {
                // Prepare text for embedding
                const text = Array.isArray(entity.observations)
                  ? entity.observations.join('\n')
                  : '';

                // Generate embedding using the instance's embedding service
                embedding = await this.embeddingService.generateEmbedding(text);
                logger.info(`Generated embedding for entity: ${entity.name}`);
              } catch (error) {
                logger.error(`Failed to generate embedding for entity: ${entity.name}`, error);
                // Continue without embedding if generation fails
              }
            } else {
              logger.warn(
                `Neo4jStorageProvider: Skipping embedding for entity "${entity.name}" - No embedding service available`
              );
            }

            // Create entity with parameters
            const params = {
              id: entityId,
              name: entity.name,
              entityType: entity.entityType,
              observations: JSON.stringify(entity.observations || []),
              version: 1,
              createdAt: entity.createdAt || now,
              updatedAt: entity.updatedAt || now,
              validFrom: entity.validFrom || now,
              validTo: null,
              changedBy: entity.changedBy || null,
              embedding: embedding, // Add embedding directly to entity
            };

            // Create entity query
            const createQuery = `
              CREATE (e:Entity {
                id: $id,
                name: $name,
                entityType: $entityType,
                observations: $observations,
                version: $version,
                createdAt: $createdAt,
                updatedAt: $updatedAt,
                validFrom: $validFrom,
                validTo: $validTo,
                changedBy: $changedBy,
                embedding: $embedding
              })
              RETURN e
            `;

            // Execute query
            const result = await txc.run(createQuery, params);

            // Get created entity from result
            if (result.records.length > 0) {
              const node = result.records[0].get('e').properties;
              const createdEntity = this.nodeToEntity(node);
              createdEntities.push(createdEntity);
              logger.info(`Created entity with embedding: ${entity.name}`);

              // Store embedding in vector store if it was generated
              if (embedding && this.vectorStore) {
                try {
                  await this.vectorStore.addVector(
                    entity.name,
                    embedding,
                    {
                      entityType: entity.entityType,
                      entityId: entityId
                    }
                  );
                  logger.debug(`Stored vector for entity: ${entity.name}`);
                } catch (vectorError) {
                  logger.error(`Failed to store vector for entity: ${entity.name}`, vectorError);
                  // Continue even if vector storage fails
                }
              }
            }
          }

          // Commit transaction
          await txc.commit();

          return createdEntities;
        } catch (error) {
          // Rollback on error
          await txc.rollback();
          throw error;
        }
      } finally {
        // Close session
        await session.close();
      }
    } catch (error) {
      logger.error('Error creating entities in Neo4j', error);
      throw error;
    }
  }

  /**
   * Create new relations between entities
   * Uses MERGE to prevent duplicates - idempotent operation
   * @param relations Array of relations to create
   */
  async createRelations(relations: Relation[]): Promise<Relation[]> {
    try {
      if (!relations || relations.length === 0) {
        return [];
      }

      const session = await this.connectionManager.getSession();
      const createdRelations: Relation[] = [];

      try {
        // Begin transaction
        const txc = session.beginTransaction();

        try {
          for (const relation of relations) {
            // Generate temporal and identity metadata
            const now = Date.now();
            const relationId = uuidv4();

            // Check if entities exist
            const checkQuery = `
              MATCH (from:Entity {name: $fromName})
              MATCH (to:Entity {name: $toName})
              RETURN from, to
            `;

            const checkResult = await txc.run(checkQuery, {
              fromName: relation.from,
              toName: relation.to,
            });

            // If either entity doesn't exist, skip this relation
            if (checkResult.records.length === 0) {
              logger.warn(
                `Skipping relation creation: One or both entities not found (${relation.from} -> ${relation.to})`
              );
              continue;
            }

            // Prepare relation parameters
            const extendedRelation = relation as ExtendedRelation;
            const params = {
              id: relationId,
              fromName: relation.from,
              toName: relation.to,
              relationType: relation.relationType,
              strength: relation.strength || null,
              confidence: relation.confidence || null,
              metadata: relation.metadata ? JSON.stringify(relation.metadata) : null,
              version: 1,
              createdAt: extendedRelation.createdAt || now,
              updatedAt: extendedRelation.updatedAt || now,
              validFrom: extendedRelation.validFrom || now,
              validTo: null,
              changedBy: extendedRelation.changedBy || null,
              now: now,
            };

            // Use MERGE to prevent duplicates - idempotent behavior
            // MERGE matches on from/to/relationType, the unique identifier for a relation
            const mergeQuery = `
              MATCH (from:Entity {name: $fromName})
              MATCH (to:Entity {name: $toName})
              MERGE (from)-[r:RELATES_TO {relationType: $relationType}]->(to)
              ON CREATE SET
                r.id = $id,
                r.strength = $strength,
                r.confidence = $confidence,
                r.metadata = $metadata,
                r.version = $version,
                r.createdAt = $createdAt,
                r.updatedAt = $updatedAt,
                r.validFrom = $validFrom,
                r.validTo = $validTo,
                r.changedBy = $changedBy
              ON MATCH SET
                r.updatedAt = $now,
                r.version = COALESCE(r.version, 0) + 1,
                r.strength = COALESCE($strength, r.strength),
                r.confidence = COALESCE($confidence, r.confidence),
                r.metadata = COALESCE($metadata, r.metadata)
              RETURN r, from, to
            `;

            // Execute query
            const result = await txc.run(mergeQuery, params);

            // Get created/updated relation from result
            if (result.records.length > 0) {
              const record = result.records[0];
              const rel = record.get('r').properties;
              const fromNode = record.get('from').properties;
              const toNode = record.get('to').properties;

              const createdRelation = this.relationshipToRelation(rel, fromNode.name, toNode.name);

              createdRelations.push(createdRelation);
              
              // Log whether this was a create or update
              if (rel.version === 1) {
                logger.info(`Created new relation: ${relation.from} -> ${relation.to} (${relation.relationType})`);
              } else {
                logger.info(`Updated existing relation: ${relation.from} -> ${relation.to} (${relation.relationType}), version ${rel.version}`);
              }
            }
          }

          // Commit transaction
          await txc.commit();

          return createdRelations;
        } catch (error) {
          // Rollback on error
          await txc.rollback();
          throw error;
        }
      } finally {
        // Close session
        await session.close();
      }
    } catch (error) {
      logger.error('Error creating relations in Neo4j', error);
      throw error;
    }
  }

  /**
   * Add observations to entities
   * @param observations Array of objects with entity name and observation contents
   */
  async addObservations(
    observations: { entityName: string; contents: string[] }[]
  ): Promise<{ entityName: string; addedObservations: string[] }[]> {
    try {
      if (!observations || observations.length === 0) {
        return [];
      }

      const session = await this.connectionManager.getSession();
      const results: { entityName: string; addedObservations: string[] }[] = [];

      try {
        // Begin transaction
        const txc = session.beginTransaction();

        try {
          for (const obs of observations) {
            if (!obs.entityName || !obs.contents || obs.contents.length === 0) {
              continue;
            }

            // Step 1: Get the current entity and its relationships
            const getQuery = `
              MATCH (e:Entity {name: $name})
              WHERE e.validTo IS NULL
              OPTIONAL MATCH (e)-[r:RELATES_TO]->(to:Entity)
              WHERE r.validTo IS NULL
              OPTIONAL MATCH (from:Entity)-[r2:RELATES_TO]->(e)
              WHERE r2.validTo IS NULL
              RETURN e, collect(DISTINCT {rel: r, to: to}) as outgoing,
                        collect(DISTINCT {rel: r2, from: from}) as incoming
            `;

            const getResult = await txc.run(getQuery, { name: obs.entityName });

            if (getResult.records.length === 0) {
              logger.warn(`Entity not found: ${obs.entityName}`);
              continue;
            }

            // Get entity properties
            const currentNode = getResult.records[0].get('e').properties;
            const currentObservations = JSON.parse(currentNode.observations || '[]');
            const outgoingRels = getResult.records[0].get('outgoing');
            const incomingRels = getResult.records[0].get('incoming');

            // Step 2: Create a new version of the entity with updated observations
            const now = Date.now();
            const newVersion = (currentNode.version || 0) + 1;
            const newEntityId = uuidv4();

            // Filter out duplicates
            const newObservations = obs.contents.filter(
              (content) => !currentObservations.includes(content)
            );

            // Skip if no new observations
            if (newObservations.length === 0) {
              results.push({
                entityName: obs.entityName,
                addedObservations: [],
              });
              continue;
            }

            // Combine observations
            const allObservations = [...currentObservations, ...newObservations];

            // Step 3: Invalidate the old entity by setting validTo timestamp
            // This preserves the entity in history while marking it as superseded
            const invalidateQuery = `
              MATCH (e:Entity {id: $id})
              SET e.validTo = $now
              RETURN e
            `;

            await txc.run(invalidateQuery, {
              id: currentNode.id,
              now,
            });

            // Step 4: Create the new version of the entity
            // The uniqueness constraint is on (name, validTo), so this CREATE won't conflict
            // because the old entity now has validTo set to a timestamp, while this new entity has validTo = null
            const createQuery = `
              CREATE (e:Entity {
                name: $name,
                id: $id,
                entityType: $entityType,
                observations: $observations,
                version: $version,
                createdAt: $createdAt,
                updatedAt: $now,
                validFrom: $now,
                validTo: null,
                changedBy: $changedBy
              })
              RETURN e
            `;

            const createParams = {
              id: newEntityId,
              name: currentNode.name,
              entityType: currentNode.entityType,
              observations: JSON.stringify(allObservations),
              version: newVersion,
              createdAt: currentNode.createdAt,
              now,
              changedBy: null,
            };

            await txc.run(createQuery, createParams);

            // Step 5: Recreate relationships for the new version
            for (const outRel of outgoingRels) {
              if (!outRel.rel || !outRel.to) continue;

              const relProps = outRel.rel.properties;
              const newRelId = uuidv4();

              const createOutRelQuery = `
                MATCH (from:Entity {id: $fromId})
                MATCH (to:Entity {id: $toId})
                CREATE (from)-[r:RELATES_TO {
                  id: $id,
                  relationType: $relationType,
                  strength: $strength,
                  confidence: $confidence,
                  metadata: $metadata,
                  version: $version,
                  createdAt: $createdAt,
                  updatedAt: $now,
                  validFrom: $now,
                  validTo: null,
                  changedBy: $changedBy
                }]->(to)
              `;

              await txc.run(createOutRelQuery, {
                fromId: newEntityId,
                toId: outRel.to.properties.id,
                id: newRelId,
                relationType: relProps.relationType,
                strength: relProps.strength !== undefined ? relProps.strength : 0.9,
                confidence: relProps.confidence !== undefined ? relProps.confidence : 0.95,
                metadata: relProps.metadata || null,
                version: relProps.version || 1,
                createdAt: relProps.createdAt || Date.now(),
                now,
                changedBy: null,
              });
            }

            for (const inRel of incomingRels) {
              if (!inRel.rel || !inRel.from) continue;

              const relProps = inRel.rel.properties;
              const newRelId = uuidv4();

              const createInRelQuery = `
                MATCH (from:Entity {id: $fromId})
                MATCH (to:Entity {id: $toId})
                CREATE (from)-[r:RELATES_TO {
                  id: $id,
                  relationType: $relationType,
                  strength: $strength,
                  confidence: $confidence,
                  metadata: $metadata,
                  version: $version,
                  createdAt: $createdAt,
                  updatedAt: $now,
                  validFrom: $now,
                  validTo: null,
                  changedBy: $changedBy
                }]->(to)
              `;

              await txc.run(createInRelQuery, {
                fromId: inRel.from.properties.id,
                toId: newEntityId,
                id: newRelId,
                relationType: relProps.relationType,
                strength: relProps.strength !== undefined ? relProps.strength : 0.9,
                confidence: relProps.confidence !== undefined ? relProps.confidence : 0.95,
                metadata: relProps.metadata || null,
                version: relProps.version || 1,
                createdAt: relProps.createdAt || Date.now(),
                now,
                changedBy: null,
              });
            }

            // Step 6: Add result to return array
            results.push({
              entityName: obs.entityName,
              addedObservations: newObservations,
            });
          }

          // Commit transaction
          await txc.commit();

          return results;
        } catch (error) {
          // Rollback on error
          await txc.rollback();
          throw error;
        }
      } finally {
        // Close session
        await session.close();
      }
    } catch (error) {
      logger.error('Error adding observations in Neo4j', error);
      throw error;
    }
  }

  /**
   * Delete entities and their relations
   * @param entityNames Array of entity names to delete
   */
  async deleteEntities(entityNames: string[]): Promise<void> {
    try {
      if (!entityNames || entityNames.length === 0) {
        return;
      }

      const session = await this.connectionManager.getSession();

      try {
        // Begin transaction
        const txc = session.beginTransaction();

        try {
          // Delete entities and their relations
          const deleteQuery = `
            MATCH (e:Entity)
            WHERE e.name IN $names
            DETACH DELETE e
          `;

          await txc.run(deleteQuery, { names: entityNames });

          // Commit transaction
          await txc.commit();
        } catch (error) {
          // Rollback on error
          await txc.rollback();
          throw error;
        }
      } finally {
        // Close session
        await session.close();
      }
    } catch (error) {
      logger.error('Error deleting entities in Neo4j', error);
      throw error;
    }
  }

  /**
   * Update an existing entity with new properties
   * @param entityName The name of the entity to update
   * @param updates The updates to apply to the entity
   */
  async updateEntity(entityName: string, updates: Partial<ExtendedEntity>): Promise<ExtendedEntity> {
    try {
      const session = await this.connectionManager.getSession();

      try {
        // Begin transaction
        const txc = session.beginTransaction();

        try {
          // Step 1: Get the current entity and its relationships
          const getQuery = `
            MATCH (e:Entity {name: $name})
            WHERE e.validTo IS NULL
            OPTIONAL MATCH (e)-[r:RELATES_TO]->(to:Entity)
            WHERE r.validTo IS NULL
            OPTIONAL MATCH (from:Entity)-[r2:RELATES_TO]->(e)
            WHERE r2.validTo IS NULL
            RETURN e, collect(DISTINCT {rel: r, to: to}) as outgoing,
                      collect(DISTINCT {rel: r2, from: from}) as incoming
          `;

          const getResult = await txc.run(getQuery, { name: entityName });

          if (getResult.records.length === 0) {
            throw new Error(`Entity '${entityName}' not found`);
          }

          // Get entity properties
          const currentNode = getResult.records[0].get('e').properties;
          const outgoingRels = getResult.records[0].get('outgoing');
          const incomingRels = getResult.records[0].get('incoming');

          // Step 2: Create updated entity data
          const now = Date.now();
          const newVersion = (currentNode.version || 0) + 1;
          const newEntityId = uuidv4();

          // Merge updates with current values
          const updatedData = {
            id: newEntityId,
            name: updates.name || currentNode.name,
            entityType: updates.entityType || currentNode.entityType,
            observations: updates.observations ? JSON.stringify(updates.observations) : currentNode.observations,
            version: newVersion,
            createdAt: currentNode.createdAt,
            updatedAt: now,
            validFrom: now,
            validTo: null,
            changedBy: updates.changedBy || null,
          };

          // Step 3: Mark the old entity and its relationships as invalid
          const invalidateQuery = `
            MATCH (e:Entity {id: $id})
            SET e.validTo = $now
            WITH e
            OPTIONAL MATCH (e)-[r:RELATES_TO]->()
            WHERE r.validTo IS NULL
            SET r.validTo = $now
            WITH e
            OPTIONAL MATCH ()-[r2:RELATES_TO]->(e)
            WHERE r2.validTo IS NULL
            SET r2.validTo = $now
          `;

          await txc.run(invalidateQuery, {
            id: currentNode.id,
            now,
          });

          // Step 4: Create the new version
          const createQuery = `
            CREATE (e:Entity {
              id: $id,
              name: $name,
              entityType: $entityType,
              observations: $observations,
              version: $version,
              createdAt: $createdAt,
              updatedAt: $updatedAt,
              validFrom: $validFrom,
              validTo: $validTo,
              changedBy: $changedBy
            })
            RETURN e
          `;

          const createResult = await txc.run(createQuery, updatedData);

          // Step 5: Recreate relationships for the new version
          for (const outRel of outgoingRels) {
            if (!outRel.rel || !outRel.to) continue;

            const relProps = outRel.rel.properties;
            const newRelId = uuidv4();

            const createOutRelQuery = `
              MATCH (from:Entity {id: $fromId})
              MATCH (to:Entity {id: $toId})
              CREATE (from)-[r:RELATES_TO {
                id: $id,
                relationType: $relationType,
                strength: $strength,
                confidence: $confidence,
                metadata: $metadata,
                version: $version,
                createdAt: $createdAt,
                updatedAt: $now,
                validFrom: $now,
                validTo: null,
                changedBy: $changedBy
              }]->(to)
            `;

            await txc.run(createOutRelQuery, {
              fromId: newEntityId,
              toId: outRel.to.properties.id,
              id: newRelId,
              relationType: relProps.relationType,
              strength: relProps.strength !== undefined ? relProps.strength : 0.9,
              confidence: relProps.confidence !== undefined ? relProps.confidence : 0.95,
              metadata: relProps.metadata || null,
              version: relProps.version || 1,
              createdAt: relProps.createdAt || Date.now(),
              now,
              changedBy: null,
            });
          }

          for (const inRel of incomingRels) {
            if (!inRel.rel || !inRel.from) continue;

            const relProps = inRel.rel.properties;
            const newRelId = uuidv4();

            const createInRelQuery = `
              MATCH (from:Entity {id: $fromId})
              MATCH (to:Entity {id: $toId})
              CREATE (from)-[r:RELATES_TO {
                id: $id,
                relationType: $relationType,
                strength: $strength,
                confidence: $confidence,
                metadata: $metadata,
                version: $version,
                createdAt: $createdAt,
                updatedAt: $now,
                validFrom: $now,
                validTo: null,
                changedBy: $changedBy
              }]->(to)
            `;

            await txc.run(createInRelQuery, {
              fromId: inRel.from.properties.id,
              toId: newEntityId,
              id: newRelId,
              relationType: relProps.relationType,
              strength: relProps.strength !== undefined ? relProps.strength : 0.9,
              confidence: relProps.confidence !== undefined ? relProps.confidence : 0.95,
              metadata: relProps.metadata || null,
              version: relProps.version || 1,
              createdAt: relProps.createdAt || Date.now(),
              now,
              changedBy: null,
            });
          }

          // Commit transaction
          await txc.commit();

          // Return the updated entity
          if (createResult.records.length > 0) {
            const node = createResult.records[0].get('e').properties;
            return this.nodeToEntity(node);
          }

          throw new Error('Failed to create updated entity');
        } catch (error) {
          // Rollback on error
          await txc.rollback();
          throw error;
        }
      } finally {
        // Close session
        await session.close();
      }
    } catch (error) {
      logger.error(`Error updating entity '${entityName}' in Neo4j`, error);
      throw error;
    }
  }

  /**
   * Soft delete observations from entities using temporal validity
   * This sets validTo timestamp instead of physically removing observations
   * @param deletions Array of objects with entity name and observations to soft delete
   */
  async softDeleteObservations(
    deletions: { entityName: string; observations: string[] }[]
  ): Promise<{ entityName: string; softDeletedObservations: string[] }[]> {
    try {
      if (!deletions || deletions.length === 0) {
        return [];
      }

      const session = await this.connectionManager.getSession();
      const results: { entityName: string; softDeletedObservations: string[] }[] = [];

      try {
        // Begin transaction
        const txc = session.beginTransaction();

        try {
          const now = Date.now();

          for (const deletion of deletions) {
            if (
              !deletion.entityName ||
              !deletion.observations ||
              deletion.observations.length === 0
            ) {
              continue;
            }

            // For now, we'll store temporal observation data in metadata
            // This is a backward-compatible approach while we migrate to the new structure
            const metadataQuery = `
              MATCH (e:Entity {name: $name})
              WHERE e.validTo IS NULL
              RETURN e
            `;

            const entityResult = await txc.run(metadataQuery, { name: deletion.entityName });

            if (entityResult.records.length === 0) {
              logger.warn(`Entity not found for soft delete observations: ${deletion.entityName}`);
              continue;
            }

            const entity = entityResult.records[0].get('e').properties;

            // Create metadata entry for soft-deleted observations
            const updateMetadataQuery = `
              MATCH (e:Entity {name: $name})
              WHERE e.validTo IS NULL
              SET e.observationDeletions = COALESCE(e.observationDeletions, '[]')
              WITH e
              SET e.observationDeletions = $deletions,
                  e.updatedAt = $now
              RETURN e
            `;

            // Get current deletions
            let currentDeletions = [];
            if (entity.observationDeletions) {
              try {
                currentDeletions = JSON.parse(entity.observationDeletions);
              } catch {
                currentDeletions = [];
              }
            }

            // Add new deletions with timestamp
            const newDeletions = deletion.observations.map(obs => ({
              content: obs,
              deletedAt: now,
              validTo: now
            }));

            const allDeletions = [...currentDeletions, ...newDeletions];

            await txc.run(updateMetadataQuery, {
              name: deletion.entityName,
              deletions: JSON.stringify(allDeletions),
              now
            });

            results.push({
              entityName: deletion.entityName,
              softDeletedObservations: deletion.observations
            });

            logger.info(`Soft deleted ${deletion.observations.length} observations from entity: ${deletion.entityName}`);
          }

          // Commit transaction
          await txc.commit();

          return results;
        } catch (error) {
          // Rollback on error
          await txc.rollback();
          throw error;
        }
      } finally {
        // Close session
        await session.close();
      }
    } catch (error) {
      logger.error('Error soft deleting observations in Neo4j', error);
      throw error;
    }
  }

  /**
   * Delete observations from entities (DEPRECATED - use softDeleteObservations instead)
   * @param deletions Array of objects with entity name and observations to delete
   */
  async deleteObservations(
    deletions: { entityName: string; observations: string[] }[]
  ): Promise<void> {
    try {
      if (!deletions || deletions.length === 0) {
        return;
      }

      const session = await this.connectionManager.getSession();

      try {
        // Begin transaction
        const txc = session.beginTransaction();

        try {
          for (const deletion of deletions) {
            if (
              !deletion.entityName ||
              !deletion.observations ||
              deletion.observations.length === 0
            ) {
              continue;
            }

            // Step 1: Get the current entity
            const getQuery = `
              MATCH (e:Entity {name: $name})
              WHERE e.validTo IS NULL
              RETURN e
            `;

            const getResult = await txc.run(getQuery, { name: deletion.entityName });

            if (getResult.records.length === 0) {
              logger.warn(`Entity not found: ${deletion.entityName}`);
              continue;
            }

            // Get entity properties
            const currentNode = getResult.records[0].get('e').properties;
            const currentObservations = JSON.parse(currentNode.observations || '[]');

            // Step 2: Remove the observations
            const updatedObservations = currentObservations.filter(
              (obs: string) => !deletion.observations.includes(obs)
            );

            // Step 3: Create a new version of the entity with updated observations
            const now = Date.now();
            const newVersion = (currentNode.version || 0) + 1;
            const newEntityId = uuidv4();

            // Step 4: Mark the old entity as invalid
            const invalidateQuery = `
              MATCH (e:Entity {id: $id})
              SET e.validTo = $now
            `;

            await txc.run(invalidateQuery, {
              id: currentNode.id,
              now,
            });

            // Step 5: Create the new version
            const createQuery = `
              CREATE (e:Entity {
                id: $id,
                name: $name,
                entityType: $entityType,
                observations: $observations,
                version: $version,
                createdAt: $createdAt,
                updatedAt: $now,
                validFrom: $now,
                validTo: null,
                changedBy: $changedBy
              })
              RETURN e
            `;

            const createParams = {
              id: newEntityId,
              name: currentNode.name,
              entityType: currentNode.entityType,
              observations: JSON.stringify(updatedObservations),
              version: newVersion,
              createdAt: currentNode.createdAt,
              now,
              changedBy: null,
            };

            await txc.run(createQuery, createParams);
          }

          // Commit transaction
          await txc.commit();
        } catch (error) {
          // Rollback on error
          await txc.rollback();
          throw error;
        }
      } finally {
        // Close session
        await session.close();
      }
    } catch (error) {
      logger.error('Error deleting observations in Neo4j', error);
      throw error;
    }
  }

  /**
   * Soft delete relations from the graph using temporal validity
   * Sets validTo timestamp instead of hard deleting - maintains audit trail
   * @param relations Array of relations to soft delete
   */
  async deleteRelations(relations: Relation[]): Promise<void> {
    try {
      if (!relations || relations.length === 0) {
        return;
      }

      const session = await this.connectionManager.getSession();

      try {
        // Begin transaction
        const txc = session.beginTransaction();

        try {
          const now = Date.now();

          for (const relation of relations) {
            // Soft delete relation by setting validTo timestamp
            // This maintains audit trail and allows historical queries
            const softDeleteQuery = `
              MATCH (from:Entity {name: $fromName})-[r:RELATES_TO]->(to:Entity {name: $toName})
              WHERE r.relationType = $relationType
              AND r.validTo IS NULL
              SET r.validTo = $now,
                  r.updatedAt = $now
              RETURN count(r) as deletedCount
            `;

            const result = await txc.run(softDeleteQuery, {
              fromName: relation.from,
              toName: relation.to,
              relationType: relation.relationType,
              now,
            });

            const deletedCount = result.records[0]?.get('deletedCount').toNumber() || 0;
            
            if (deletedCount > 0) {
              logger.info(`Soft deleted ${deletedCount} relation(s): ${relation.from} -> ${relation.to} (${relation.relationType})`);
            } else {
              logger.warn(`No active relation found to delete: ${relation.from} -> ${relation.to} (${relation.relationType})`);
            }
          }

          // Commit transaction
          await txc.commit();
        } catch (error) {
          // Rollback on error
          await txc.rollback();
          throw error;
        }
      } finally {
        // Close session
        await session.close();
      }
    } catch (error) {
      logger.error('Error soft deleting relations in Neo4j', error);
      throw error;
    }
  }

  /**
   * Get an entity by name
   * @param entityName Name of the entity to retrieve
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getEntity(entityName: string): Promise<any | null> {
    try {
      // Query for entity by name
      const query = `
        MATCH (e:Entity {name: $name})
        WHERE e.validTo IS NULL
        RETURN e
      `;

      // Execute query
      const result = await this.connectionManager.executeQuery(query, { name: entityName });

      // Return null if no entity found
      if (result.records.length === 0) {
        return null;
      }

      // Convert node to entity
      const node = result.records[0].get('e').properties;
      return this.nodeToEntity(node);
    } catch (error) {
      logger.error(`Error retrieving entity ${entityName} from Neo4j`, error);
      throw error;
    }
  }

  /**
   * Get a specific relation by its source, target, and type
   * @param from Source entity name
   * @param to Target entity name
   * @param type Relation type
   */
  async getRelation(from: string, to: string, type: string): Promise<Relation | null> {
    try {
      // Query for relation
      const query = `
        MATCH (from:Entity {name: $fromName})-[r:RELATES_TO]->(to:Entity {name: $toName})
        WHERE r.relationType = $relationType
        AND r.validTo IS NULL
        RETURN r, from, to
      `;

      // Execute query
      const result = await this.connectionManager.executeQuery(query, {
        fromName: from,
        toName: to,
        relationType: type,
      });

      // Return null if no relation found
      if (result.records.length === 0) {
        return null;
      }

      // Convert relationship to relation
      const record = result.records[0];
      const rel = record.get('r').properties;
      const fromNode = record.get('from').properties;
      const toNode = record.get('to').properties;

      return this.relationshipToRelation(rel, fromNode.name, toNode.name);
    } catch (error) {
      logger.error(`Error retrieving relation from Neo4j`, error);
      throw error;
    }
  }

  /**
   * Update an existing relation with new properties
   * @param relation The relation with updated properties
   */
  async updateRelation(relation: Relation): Promise<void> {
    try {
      const session = await this.connectionManager.getSession();

      try {
        // Begin transaction
        const txc = session.beginTransaction();

        try {
          // Step 1: Get the current relation
          const getQuery = `
            MATCH (from:Entity {name: $fromName})-[r:RELATES_TO]->(to:Entity {name: $toName})
            WHERE r.relationType = $relationType
            AND r.validTo IS NULL
            RETURN r
          `;

          const getResult = await txc.run(getQuery, {
            fromName: relation.from,
            toName: relation.to,
            relationType: relation.relationType,
          });

          if (getResult.records.length === 0) {
            throw new Error(
              `Relation not found: ${relation.from} -> ${relation.to} (${relation.relationType})`
            );
          }

          // Get relation properties
          const currentRel = getResult.records[0].get('r').properties;

          // Step 2: Update the relation with temporal versioning
          const now = Date.now();
          const newVersion = (currentRel.version || 0) + 1;
          const newRelationId = uuidv4();

          // Step 3: Mark the old relation as invalid
          const invalidateQuery = `
            MATCH (from:Entity {name: $fromName})-[r:RELATES_TO {id: $id}]->(to:Entity {name: $toName})
            SET r.validTo = $now
          `;

          await txc.run(invalidateQuery, {
            fromName: relation.from,
            toName: relation.to,
            id: currentRel.id,
            now,
          });

          // Step 4: Create the new version of the relation
          const createQuery = `
            MATCH (from:Entity {name: $fromName})
            MATCH (to:Entity {name: $toName})
            CREATE (from)-[r:RELATES_TO {
              id: $id,
              relationType: $relationType,
              strength: $strength,
              confidence: $confidence,
              metadata: $metadata,
              version: $version,
              createdAt: $createdAt,
              updatedAt: $now,
              validFrom: $now,
              validTo: null,
              changedBy: $changedBy
            }]->(to)
          `;

          const extendedRelation = relation as ExtendedRelation;
          const createParams = {
            id: newRelationId,
            fromName: relation.from,
            toName: relation.to,
            relationType: relation.relationType,
            strength: relation.strength !== undefined ? relation.strength : currentRel.strength,
            confidence:
              relation.confidence !== undefined ? relation.confidence : currentRel.confidence,
            metadata: relation.metadata ? JSON.stringify(relation.metadata) : currentRel.metadata,
            version: newVersion,
            createdAt: currentRel.createdAt,
            now,
            changedBy: extendedRelation.changedBy || null,
          };

          await txc.run(createQuery, createParams);

          // Commit transaction
          await txc.commit();
        } catch (error) {
          // Rollback on error
          await txc.rollback();
          throw error;
        }
      } finally {
        // Close session
        await session.close();
      }
    } catch (error) {
      logger.error('Error updating relation in Neo4j', error);
      throw error;
    }
  }

  /**
   * Get the history of all versions of an entity
   * @param entityName The name of the entity to retrieve history for
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getEntityHistory(entityName: string): Promise<any[]> {
    try {
      // Query for entity history
      const query = `
        MATCH (e:Entity {name: $name})
        RETURN e
        ORDER BY e.validFrom ASC
      `;

      // Execute query
      const result = await this.connectionManager.executeQuery(query, { name: entityName });

      // Return empty array if no history found
      if (result.records.length === 0) {
        return [];
      }

      // Convert nodes to entities
      return result.records.map((record) => {
        const node = record.get('e').properties;
        return this.nodeToEntity(node);
      });
    } catch (error) {
      logger.error(`Error retrieving history for entity ${entityName} from Neo4j`, error);
      throw error;
    }
  }

  /**
   * Get the history of all versions of a relation
   * @param from Source entity name
   * @param to Target entity name
   * @param relationType Type of the relation
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getRelationHistory(from: string, to: string, relationType: string): Promise<any[]> {
    try {
      // Query for relation history
      const query = `
        MATCH (from:Entity {name: $fromName})-[r:RELATES_TO]->(to:Entity {name: $toName})
        WHERE r.relationType = $relationType
        RETURN r, from, to
        ORDER BY r.validFrom ASC
      `;

      // Execute query
      const result = await this.connectionManager.executeQuery(query, {
        fromName: from,
        toName: to,
        relationType,
      });

      // Return empty array if no history found
      if (result.records.length === 0) {
        return [];
      }

      // Convert relationships to relations
      return result.records.map((record) => {
        const rel = record.get('r').properties;
        const fromNode = record.get('from').properties;
        const toNode = record.get('to').properties;

        return this.relationshipToRelation(rel, fromNode.name, toNode.name);
      });
    } catch (error) {
      logger.error(`Error retrieving relation history from Neo4j`, error);
      throw error;
    }
  }

  /**
   * Get the state of the knowledge graph at a specific point in time
   * @param timestamp The timestamp to get the graph state at
   */
  async getGraphAtTime(timestamp: number): Promise<KnowledgeGraph> {
    try {
      const startTime = Date.now();

      // Query for entities valid at timestamp
      const entityQuery = `
        MATCH (e:Entity)
        WHERE e.validFrom <= $timestamp
        AND (e.validTo IS NULL OR e.validTo > $timestamp)
        RETURN e
      `;

      // Execute entity query
      const entityResult = await this.connectionManager.executeQuery(entityQuery, { timestamp });

      // Convert nodes to entities
      const entities = entityResult.records.map((record) => {
        const node = record.get('e').properties;
        return this.nodeToEntity(node);
      });

      // Query for relations valid at timestamp
      const relationQuery = `
        MATCH (from:Entity)-[r:RELATES_TO]->(to:Entity)
        WHERE r.validFrom <= $timestamp
        AND (r.validTo IS NULL OR r.validTo > $timestamp)
        RETURN r, from.name AS fromName, to.name AS toName
      `;

      // Execute relation query
      const relationResult = await this.connectionManager.executeQuery(relationQuery, {
        timestamp,
      });

      // Convert relationships to relations
      const relations = relationResult.records.map((record) => {
        const rel = record.get('r').properties;
        const fromName = record.get('fromName');
        const toName = record.get('toName');

        return this.relationshipToRelation(rel, fromName, toName);
      });

      const timeTaken = Date.now() - startTime;

      // Return the graph state at the timestamp
      return {
        entities,
        relations,
        total: entities.length,
        timeTaken,
      };
    } catch (error) {
      logger.error(`Error retrieving graph state at timestamp ${timestamp} from Neo4j`, error);
      throw error;
    }
  }

  /**
   * Get the current knowledge graph with confidence decay applied to relations
   * based on their age and the configured decay settings
   */
  async getDecayedGraph(): Promise<KnowledgeGraph> {
    try {
      // If decay is not enabled, just return the regular graph
      if (!this.decayConfig.enabled) {
        return this.loadGraph();
      }

      const startTime = Date.now();

      // Load entities
      const entityQuery = `
        MATCH (e:Entity)
        WHERE e.validTo IS NULL
        RETURN e
      `;

      const entityResult = await this.connectionManager.executeQuery(entityQuery, {});

      const entities = entityResult.records.map((record) => {
        const node = record.get('e').properties;
        return this.nodeToEntity(node);
      });

      // Calculate decay factor
      const halfLifeMs = this.decayConfig.halfLifeDays * 24 * 60 * 60 * 1000;
      const decayFactor = Math.log(0.5) / halfLifeMs;

      // Load relations and apply decay
      const relationQuery = `
        MATCH (from:Entity)-[r:RELATES_TO]->(to:Entity)
        WHERE r.validTo IS NULL
        RETURN r, from.name AS fromName, to.name AS toName
      `;

      const relationResult = await this.connectionManager.executeQuery(relationQuery, {});

      const relations = relationResult.records.map((record) => {
        const rel = record.get('r').properties;
        const fromName = record.get('fromName');
        const toName = record.get('toName');

        // Create base relation
        const relation = this.relationshipToRelation(rel, fromName, toName);

        // Apply decay if confidence is present
        if (relation.confidence !== null && relation.confidence !== undefined) {
          const extendedRelation = relation as ExtendedRelation;
          const ageDiff =
            startTime - (extendedRelation.validFrom || extendedRelation.createdAt || startTime);
          let decayedConfidence = relation.confidence * Math.exp(decayFactor * ageDiff);

          // Don't let confidence decay below minimum
          if (decayedConfidence < this.decayConfig.minConfidence) {
            decayedConfidence = this.decayConfig.minConfidence;
          }

          relation.confidence = decayedConfidence;
        }

        return relation;
      });

      const timeTaken = Date.now() - startTime;

      // Return the graph with decayed confidence values
      return {
        entities,
        relations,
        total: entities.length,
        timeTaken,
        diagnostics: {
          decay_info: {
            enabled: this.decayConfig.enabled,
            halfLifeDays: this.decayConfig.halfLifeDays,
            minConfidence: this.decayConfig.minConfidence,
            decayFactor,
          },
        },
      };
    } catch (error) {
      logger.error('Error getting decayed graph from Neo4j', error);
      throw error;
    }
  }

  /**
   * Store or update the embedding vector for an entity
   * @param entityName The name of the entity to update
   * @param embedding The embedding data to store
   */
  async updateEntityEmbedding(entityName: string, embedding: EntityEmbedding): Promise<void> {
    try {
      // Verify that the entity exists
      const entity = await this.getEntity(entityName);
      if (!entity) {
        throw new Error(`Entity ${entityName} not found`);
      }

      const session = await this.connectionManager.getSession();

      try {
        // Begin transaction
        const txc = session.beginTransaction();

        try {
          // Update the entity with the embedding
          const updateQuery = `
            MATCH (e:Entity {name: $name})
            WHERE e.validTo IS NULL
            SET e.embedding = $embedding,
                e.updatedAt = $now
            RETURN e
          `;

          await txc.run(updateQuery, {
            name: entityName,
            embedding: embedding.vector,
            now: Date.now(),
          });

          // Commit transaction
          await txc.commit();
        } catch (error) {
          // Rollback on error
          await txc.rollback();
          throw error;
        }
      } finally {
        // Close session
        await session.close();
      }
    } catch (error) {
      logger.error(`Error updating embedding for entity ${entityName} in Neo4j`, error);
      throw error;
    }
  }

  /**
   * Get the embedding vector for an entity
   * @param entityName The name of the entity
   * @returns Promise resolving to the EntityEmbedding or null if not found
   */
  async getEntityEmbedding(entityName: string): Promise<EntityEmbedding | null> {
    try {
      // Verify that the entity exists
      const entity = await this.getEntity(entityName);
      if (!entity) {
        logger.debug(`Entity not found when retrieving embedding: ${entityName}`);
        return null;
      }

      const session = await this.connectionManager.getSession();

      try {
        // Query to get the entity with its embedding
        const query = `
          MATCH (e:Entity {name: $name})
          WHERE e.validTo IS NULL
          RETURN e.embedding AS embedding
        `;

        const result = await session.run(query, { name: entityName });

        if (result.records.length === 0 || !result.records[0].get('embedding')) {
          logger.debug(`No embedding found for entity: ${entityName}`);
          return null;
        }

        const embeddingVector = result.records[0].get('embedding');

        // Return the embedding in the expected format
        return {
          vector: embeddingVector,
          model: 'unknown', // We don't store the model info in Neo4j
          lastUpdated: entity.updatedAt || Date.now(),
        };
      } finally {
        await session.close();
      }
    } catch (error) {
      logger.error(`Error retrieving embedding for entity ${entityName} from Neo4j`, error);
      return null;
    }
  }

  /**
   * Find entities similar to a query vector
   * @param queryVector The vector to compare against
   * @param limit Maximum number of results to return
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async findSimilarEntities(queryVector: number[], limit: number = 10): Promise<any[]> {
    try {
      // Direct vector search implementation using the approach proven to work in our test script
      logger.debug(`Neo4jStorageProvider: Using direct vector search with ${limit} limit`);

      const session = await this.connectionManager.getSession();

      try {
        const result = await session.run(
          `
          CALL db.index.vector.queryNodes(
            'entity_embeddings',
            $limit,
            $embedding
          )
          YIELD node, score
          RETURN node.name AS name, node.entityType AS entityType, score
          ORDER BY score DESC
        `,
          {
            limit: neo4j.int(Math.floor(limit)),
            embedding: queryVector,
          }
        );

        const foundResults = result.records.length;
        logger.debug(`Neo4jStorageProvider: Direct vector search found ${foundResults} results`);

        if (foundResults > 0) {
          // Convert to entity objects
          const entityPromises = result.records.map(async (record) => {
            const entityName = record.get('name');
            const score = record.get('score');
            const entity = await this.getEntity(entityName);
            if (entity) {
              return {
                ...entity,
                score,
              };
            }
            return null;
          });

          const entities = (await Promise.all(entityPromises)).filter(Boolean);

          // Return only valid entities
          return entities.filter((entity) => entity && entity.validTo === null).slice(0, limit);
        }

        logger.debug('Neo4jStorageProvider: No results from vector search');
        return [];
      } finally {
        await session.close();
      }
    } catch (error) {
      logger.error('Error finding similar entities in Neo4j', error);
      return [];
    }
  }

  /**
   * Search for entities using semantic search
   * @param query The search query text
   * @param options Search options including semantic search parameters
   */
  async semanticSearch(
    query: string,
    options: SearchOptions & Neo4jSemanticSearchOptions = {}
  ): Promise<PaginatedKnowledgeGraph> {
    try {
      // Create diagnostics object for debugging
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const diagnostics: Record<string, any> = {
        query,
        startTime: Date.now(),
        stepsTaken: [],
      };

      // Log start of semantic search
      diagnostics.stepsTaken.push({
        step: 'start',
        timestamp: Date.now(),
        options: {
          query,
          hybridSearch: options.hybridSearch,
          hasQueryVector: !!options.queryVector,
          limit: options.limit,
          entityTypes: options.entityTypes,
          minSimilarity: options.minSimilarity,
        },
      });

      // Enhanced logging for semantic search
      logger.debug('Neo4jStorageProvider: Starting semantic search', {
        query,
        hybridSearch: options.hybridSearch,
        hasQueryVector: !!options.queryVector,
        limit: options.limit,
        entityTypes: options.entityTypes,
      });

      // Ensure vector store is initialized
      if (!(this.vectorStore as any).initialized) {
        logger.info('Neo4jStorageProvider: Vector store not initialized, initializing now');
        diagnostics.stepsTaken.push({
          step: 'vectorStoreInitialization',
          timestamp: Date.now(),
          status: 'started',
        });

        try {
          await this.vectorStore.initialize();
          logger.info(
            'Neo4jStorageProvider: Vector store initialized successfully for semantic search'
          );
          diagnostics.stepsTaken.push({
            step: 'vectorStoreInitialization',
            timestamp: Date.now(),
            status: 'success',
          });
        } catch (initError) {
          logger.error(
            'Neo4jStorageProvider: Failed to initialize vector store for semantic search',
            initError
          );
          diagnostics.stepsTaken.push({
            step: 'vectorStoreInitialization',
            timestamp: Date.now(),
            status: 'error',
            error: initError instanceof Error ? initError.message : String(initError),
          });
          // We'll continue but might fail if the vector operations are called
        }
      }

      // If no embedding service, log a warning
      if (!this.embeddingService) {
        logger.warn('Neo4jStorageProvider: No embedding service available for semantic search');
        diagnostics.stepsTaken.push({
          step: 'embeddingServiceCheck',
          timestamp: Date.now(),
          status: 'unavailable',
        });
      } else {
        diagnostics.stepsTaken.push({
          step: 'embeddingServiceCheck',
          timestamp: Date.now(),
          status: 'available',
          model: this.embeddingService.getProviderInfo().model,
          dimensions: this.embeddingService.getProviderInfo().dimensions,
        });
      }

      // Generate query vector if not provided and embedding service is available
      if (!options.queryVector && this.embeddingService) {
        try {
          logger.debug('Neo4jStorageProvider: Generating query vector for semantic search');
          diagnostics.stepsTaken.push({
            step: 'generateQueryEmbedding',
            timestamp: Date.now(),
            status: 'started',
          });

          options.queryVector = await this.embeddingService.generateEmbedding(query);

          diagnostics.stepsTaken.push({
            step: 'generateQueryEmbedding',
            timestamp: Date.now(),
            status: 'success',
            vectorLength: options.queryVector.length,
            sampleValues: options.queryVector.slice(0, 3),
          });

          logger.debug('Neo4jStorageProvider: Query vector generated successfully', {
            vectorLength: options.queryVector.length,
          });
        } catch (embedError) {
          diagnostics.stepsTaken.push({
            step: 'generateQueryEmbedding',
            timestamp: Date.now(),
            status: 'error',
            error: embedError instanceof Error ? embedError.message : String(embedError),
          });

          logger.error(
            'Neo4jStorageProvider: Failed to generate query vector for semantic search',
            embedError
          );
        }
      } else if (options.queryVector) {
        diagnostics.stepsTaken.push({
          step: 'searchMethod',
          timestamp: Date.now(),
          method: 'vectorOnly',
        });

        const searchLimit = Math.floor(options.limit || 10);
        const minSimilarity = options.minSimilarity || 0.6;

        diagnostics.stepsTaken.push({
          step: 'vectorSearch',
          timestamp: Date.now(),
          status: 'started',
          limit: searchLimit,
          minSimilarity,
        });

        // DIRECT VECTOR SEARCH IMPLEMENTATION
        // Instead of using findSimilarEntities - which isn't working in the MCP context
        // we'll directly use the working technique from our test script
        try {
          const session = await this.connectionManager.getSession();

          try {
            const vectorResult = await session.run(
              `
              CALL db.index.vector.queryNodes(
                'entity_embeddings',
                $limit,
                $embedding
              )
              YIELD node, score
              WHERE score >= $minScore
              RETURN node.name AS name, node.entityType AS entityType, score
              ORDER BY score DESC
            `,
              {
                limit: neo4j.int(searchLimit),
                embedding: options.queryVector,
                minScore: minSimilarity,
              }
            );

            const foundResults = vectorResult.records.length;
            logger.debug(
              `Neo4jStorageProvider: Direct vector search found ${foundResults} results`
            );

            if (foundResults > 0) {
              // Convert to EntityData objects
              const entityPromises = vectorResult.records.map(async (record) => {
                const entityName = record.get('name');
                return this.getEntity(entityName);
              });

              const entities = (await Promise.all(entityPromises)).filter(Boolean);

              diagnostics.stepsTaken.push({
                step: 'vectorSearch',
                timestamp: Date.now(),
                status: 'completed',
                resultsCount: entities.length,
              });

              // If no entities found after filtering, return empty result
              if (entities.length === 0) {
                diagnostics.endTime = Date.now();
                diagnostics.totalTimeTaken = diagnostics.endTime - diagnostics.startTime;

                // Create empty graph and convert to paginated
                const emptyGraph: KnowledgeGraph = { entities: [], relations: [] };
                const result = this.toPaginatedKnowledgeGraph(emptyGraph, options);
                
                // Only include diagnostics if DEBUG is enabled
                if (process.env.DEBUG === 'true') {
                  (result as any).diagnostics = diagnostics;
                }

                return result;
              }

              // Get related relations
              const entityNames = entities.map((e) => e.name);
              const finalGraph = await this.openNodes(entityNames);

              diagnostics.endTime = Date.now();
              diagnostics.totalTimeTaken = diagnostics.endTime - diagnostics.startTime;

              // Only include diagnostics if DEBUG is enabled
              if (process.env.DEBUG === 'true') {
                return {
                  entities: finalGraph.entities,
                  relations: finalGraph.relations,
                  total: finalGraph.total,
                  timeTaken: finalGraph.timeTaken,
                  pagination: finalGraph.pagination,
                  diagnostics,
                };
              }

              return finalGraph;
            } else {
              // No results from vector search
              diagnostics.stepsTaken.push({
                step: 'vectorSearch',
                timestamp: Date.now(),
                status: 'completed',
                resultsCount: 0,
              });

              diagnostics.endTime = Date.now();
              diagnostics.totalTimeTaken = diagnostics.endTime - diagnostics.startTime;

              // Create empty graph and convert to paginated
              const emptyGraph: KnowledgeGraph = { entities: [], relations: [] };
              const result = this.toPaginatedKnowledgeGraph(emptyGraph, options);
              
              // Only include diagnostics if DEBUG is enabled
              if (process.env.DEBUG === 'true') {
                (result as any).diagnostics = diagnostics;
              }

              return result;
            }
          } catch (error) {
            logger.error(
              `Neo4jStorageProvider: Direct vector search error: ${error instanceof Error ? error.message : String(error)}`
            );
            diagnostics.stepsTaken.push({
              step: 'vectorSearch',
              timestamp: Date.now(),
              status: 'error',
              error: error instanceof Error ? error.message : String(error),
            });
          } finally {
            await session.close();
          }
        } catch (error) {
          logger.error(
            `Neo4jStorageProvider: Direct vector search session error: ${error instanceof Error ? error.message : String(error)}`
          );
        }

        // If we get here, the direct approach failed, fall back to original implementation
        const results = await this.findSimilarEntities(
          options.queryVector,
          searchLimit * 2 // findSimilarEntities will handle neo4j.int conversion
        );

        // Filter by min similarity and entity types
        const filteredResults = results
          .filter((result) => result.score >= minSimilarity)
          .filter((result) => {
            if (!options.entityTypes || options.entityTypes.length === 0) {
              return true;
            }
            return options.entityTypes.includes(result.entityType);
          })
          .slice(0, searchLimit);

        diagnostics.stepsTaken.push({
          step: 'filterResults',
          timestamp: Date.now(),
          status: 'completed',
          filteredResultsCount: filteredResults.length,
        });

        // If no results, return empty graph
        if (filteredResults.length === 0) {
          diagnostics.stepsTaken.push({
            step: 'finalResult',
            timestamp: Date.now(),
            status: 'empty',
          });

          diagnostics.endTime = Date.now();
          diagnostics.totalTimeTaken = diagnostics.endTime - diagnostics.startTime;

          // Create empty graph and convert to paginated
          const emptyGraph: KnowledgeGraph = { entities: [], relations: [] };
          const result = this.toPaginatedKnowledgeGraph(emptyGraph, options);
          
          // Only include diagnostics if DEBUG is enabled
          if (process.env.DEBUG === 'true') {
            (result as any).diagnostics = diagnostics;
          }

          return result;
        }

        // Get the entities and relations
        const entityNames = filteredResults.map((r) => r.name);

        diagnostics.stepsTaken.push({
          step: 'openNodes',
          timestamp: Date.now(),
          status: 'started',
          entityNames,
        });

        const finalGraph = await this.openNodes(entityNames);

        diagnostics.stepsTaken.push({
          step: 'openNodes',
          timestamp: Date.now(),
          status: 'completed',
          entitiesCount: finalGraph.entities.length,
          relationsCount: finalGraph.relations.length,
        });

        diagnostics.endTime = Date.now();
        diagnostics.totalTimeTaken = diagnostics.endTime - diagnostics.startTime;

        // Only include diagnostics if DEBUG is enabled
        if (process.env.DEBUG === 'true') {
          return {
            entities: finalGraph.entities,
            relations: finalGraph.relations,
            total: finalGraph.total,
            timeTaken: finalGraph.timeTaken,
            pagination: finalGraph.pagination,
            diagnostics,
          };
        }

        return finalGraph;
      }

      // If no query vector provided, fall back to text search
      diagnostics.stepsTaken.push({
        step: 'searchMethod',
        timestamp: Date.now(),
        method: 'textOnly',
        reason: 'No query vector available',
      });

      const textSearchLimit = Math.floor(options.limit || 10);

      diagnostics.stepsTaken.push({
        step: 'textSearch',
        timestamp: Date.now(),
        status: 'started',
        limit: textSearchLimit,
      });

      const searchOptions: SearchOptions = {
        ...(options || {}),
        limit: textSearchLimit
      };
      const textResults = await this.searchNodes(query, searchOptions);

      diagnostics.stepsTaken.push({
        step: 'textSearch',
        timestamp: Date.now(),
        status: 'completed',
        resultsCount: textResults.entities.length,
        timeTaken: textResults.timeTaken,
      });

      diagnostics.endTime = Date.now();
      diagnostics.totalTimeTaken = diagnostics.endTime - diagnostics.startTime;

      // Only include diagnostics if DEBUG is enabled
      if (process.env.DEBUG === 'true') {
        return {
          ...textResults,
          diagnostics,
        };
      }

      return textResults;
    } catch (error) {
      logger.error('Error performing semantic search in Neo4j', error);
      throw error;
    }
  }

  /**
   * Read the entire knowledge graph (MCP compatibility method)
   * This is an alias for loadGraph() to support MCP adapter expectations
   */
  async readGraph(): Promise<KnowledgeGraph> {
    logger.debug('Neo4jStorageProvider: readGraph called (MCP compatibility)');
    return this.loadGraph();
  }

  /**
   * Direct diagnostic method to check Neo4j vector embeddings
   * Bypasses all abstractions to query the database directly
   */
  async diagnoseVectorSearch(): Promise<Record<string, unknown>> {
    try {
      // First, make sure vector store is initialized
      if (!(this.vectorStore as any).initialized) {
        try {
          await this.vectorStore.initialize();
        } catch {
          // Continue even if initialization fails
        }
      }

      // Check if we can access the diagnostic method
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (typeof (this.vectorStore as any).diagnosticGetEntityEmbeddings === 'function') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return await (this.vectorStore as any).diagnosticGetEntityEmbeddings();
      } else {
        return {
          error: 'Diagnostic method not available',
          vectorStoreType: this.vectorStore.constructor.name,
        };
      }
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
