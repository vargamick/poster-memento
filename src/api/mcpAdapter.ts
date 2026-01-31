import type { StorageProvider } from '../storage/StorageProvider.js';
import { EntityService } from '../core/services/EntityService.js';
import { RelationService } from '../core/services/RelationService.js';
import { expertiseAreaManager } from '../core/domain/ExpertiseArea.js';
import { logger } from '../utils/logger.js';

/**
 * MCP Adapter that bridges MCP tool calls to API service layer
 * This allows MCP to use the same business logic as the REST API
 */
export class McpAdapter {
  private entityService: EntityService;
  private relationService: RelationService;

  constructor(private storageProvider: StorageProvider) {
    this.entityService = new EntityService(storageProvider, expertiseAreaManager);
    this.relationService = new RelationService(storageProvider, expertiseAreaManager);
  }

  /**
   * Create entities (MCP tool: create_entities)
   */
  async createEntities(args: {
    entities: Array<{
      name: string;
      entityType: string;
      observations: string[];
      [key: string]: any;
    }>;
    expertiseArea?: string;
    context?: any;
    validateOnly?: boolean;
  }) {
    logger.info('MCP: Creating entities', { 
      count: args.entities.length, 
      expertiseArea: args.expertiseArea,
      entityNames: args.entities.map(e => e.name).join(', ')
    });

    const result = await this.entityService.createEntities(args.entities, {
      expertiseArea: args.expertiseArea || 'default',
      context: args.context,
      validateOnly: args.validateOnly || false
    });

    if (!result.success) {
      throw new Error(`Entity creation failed: ${result.errors?.join(', ')}`);
    }

    // Enhanced response with detailed information about processing results
    const response: any = {
      entities: result.data || [],
      warnings: result.warnings,
      suggestions: result.suggestions,
      validation: result.validation
    };

    // Add processing summary for better user feedback
    const requestedCount = args.entities.length;
    const createdCount = result.data?.length || 0;
    const skippedCount = requestedCount - createdCount;

    if (skippedCount > 0) {
      const createdNames = result.data?.map((e: any) => e.name) || [];
      const requestedNames = args.entities.map(e => e.name);
      const skippedNames = requestedNames.filter(name => !createdNames.includes(name));
      
      response.processing_summary = {
        requested: requestedCount,
        created: createdCount,
        skipped: skippedCount,
        skipped_entities: skippedNames,
        reason: 'Entities with these names already exist in the knowledge graph'
      };
      
      logger.info(`MCP: Entity creation summary - ${createdCount} created, ${skippedCount} skipped (duplicates): ${skippedNames.join(', ')}`);
    } else {
      response.processing_summary = {
        requested: requestedCount,
        created: createdCount,
        skipped: 0,
        message: 'All entities created successfully'
      };
      
      logger.info(`MCP: All ${createdCount} entities created successfully`);
    }

    return response;
  }

  /**
   * Create relations (MCP tool: create_relations)
   */
  async createRelations(args: {
    relations: Array<{
      from: string;
      to: string;
      relationType: string;
      strength?: number;
      confidence?: number;
      metadata?: any;
    }>;
    expertiseArea?: string;
    context?: any;
    validateOnly?: boolean;
  }) {
    logger.info('MCP: Creating relations', { count: args.relations.length, expertiseArea: args.expertiseArea });

    const result = await this.relationService.createRelations(args.relations, {
      expertiseArea: args.expertiseArea || 'default',
      context: args.context,
      validateOnly: args.validateOnly || false
    });

    if (!result.success) {
      throw new Error(`Relation creation failed: ${result.errors?.join(', ')}`);
    }

    return {
      relations: result.data,
      warnings: result.warnings,
      suggestions: result.suggestions,
      validation: result.validation
    };
  }

  /**
   * Add observations (MCP tool: add_observations)
   */
  async addObservations(args: {
    observations: Array<{
      entityName: string;
      contents: string[];
      strength?: number;
      confidence?: number;
      metadata?: any;
    }>;
    expertiseArea?: string;
    context?: any;
  }) {
    logger.info('MCP: Adding observations', { count: args.observations.length, expertiseArea: args.expertiseArea });

    const result = await this.entityService.addObservations(args.observations);

    if (!result.success) {
      throw new Error(`Adding observations failed: ${result.errors?.join(', ')}`);
    }

    return {
      observations: result.data,
      warnings: result.warnings,
      suggestions: result.suggestions
    };
  }

  /**
   * Delete entities (MCP tool: delete_entities)
   */
  async deleteEntities(args: { entityNames: string[] }) {
    logger.info('MCP: Deleting entities', { count: args.entityNames.length });

    const result = await this.entityService.deleteEntities(args.entityNames);

    if (!result.success) {
      throw new Error(`Entity deletion failed: ${result.errors?.join(', ')}`);
    }

    return { success: true };
  }

  /**
   * Delete relations (MCP tool: delete_relations)
   */
  async deleteRelations(args: {
    relations: Array<{
      from: string;
      to: string;
      relationType: string;
    }>;
  }) {
    logger.info('MCP: Deleting relations', { count: args.relations.length });

    const result = await this.relationService.deleteRelations(args.relations);

    if (!result.success) {
      throw new Error(`Relation deletion failed: ${result.errors?.join(', ')}`);
    }

    return { success: true };
  }

  /**
   * Search entities (MCP tool: search_nodes, advanced_search, semantic_search)
   */
  async searchEntities(args: {
    query: string;
    limit?: number;
    offset?: number;
    entityTypes?: string[];
    expertiseArea?: string;
    semanticSearch?: boolean;
    threshold?: number;
  }) {
    logger.info('MCP: Searching entities', { query: args.query, expertiseArea: args.expertiseArea });

    const result = await this.entityService.searchEntities(args.query, {
      limit: args.limit || 10,
      offset: args.offset || 0,
      entityTypes: args.entityTypes,
      expertiseArea: args.expertiseArea || 'default'
    });

    if (!result.success) {
      throw new Error(`Entity search failed: ${result.errors?.join(', ')}`);
    }

    return {
      entities: result.data?.entities || [],
      total: result.data?.total || 0,
      warnings: result.warnings,
      suggestions: result.suggestions
    };
  }

  /**
   * Get entity (MCP tool: open_nodes)
   */
  async getEntity(args: { name: string; expertiseArea?: string }) {
    logger.info('MCP: Getting entity', { name: args.name, expertiseArea: args.expertiseArea });

    const result = await this.entityService.getEntity(args.name);

    if (!result.success) {
      throw new Error(`Getting entity failed: ${result.errors?.join(', ')}`);
    }

    return {
      entity: result.data,
      warnings: result.warnings,
      suggestions: result.suggestions
    };
  }

  /**
   * Get relation (MCP tool: get_relation)
   */
  async getRelation(args: {
    from: string;
    to: string;
    relationType: string;
  }) {
    logger.info('MCP: Getting relation', args);

    const result = await this.relationService.getRelation(args.from, args.to, args.relationType);

    if (!result.success) {
      throw new Error(`Getting relation failed: ${result.errors?.join(', ')}`);
    }

    return {
      relation: result.data,
      warnings: result.warnings,
      suggestions: result.suggestions
    };
  }

  /**
   * Update entity (MCP tool: update_entity)
   */
  async updateEntity(args: {
    entityName: string;
    updates: {
      name?: string;
      entityType?: string;
      observations?: string[];
    };
    expertiseArea?: string;
    context?: any;
  }) {
    logger.info('MCP: Updating entity', { name: args.entityName, expertiseArea: args.expertiseArea });

    const result = await this.entityService.updateEntity(args.entityName, args.updates, {
      expertiseArea: args.expertiseArea || 'default',
      context: args.context
    });

    if (!result.success) {
      throw new Error(`Entity update failed: ${result.errors?.join(', ')}`);
    }

    return {
      entity: result.data,
      warnings: result.warnings,
      suggestions: result.suggestions
    };
  }

  /**
   * Get expertise areas (MCP tool: get_expertise_areas)
   */
  getExpertiseAreas() {
    logger.info('MCP: Getting expertise areas');

    const result = this.entityService.getExpertiseAreas();

    if (!result.success) {
      throw new Error(`Getting expertise areas failed: ${result.errors?.join(', ')}`);
    }

    return {
      expertiseAreas: result.data || [],
      total: result.data?.length || 0
    };
  }

  /**
   * Get expertise area details
   */
  getExpertiseAreaDetails(args: { name: string }) {
    logger.info('MCP: Getting expertise area details', { name: args.name });

    const result = this.entityService.getExpertiseAreaDetails(args.name);

    if (!result.success) {
      throw new Error(`Getting expertise area details failed: ${result.errors?.join(', ')}`);
    }

    return {
      expertiseArea: result.data
    };
  }

  /**
   * Get graph statistics (if supported by storage provider)
   */
  async getGraphStatistics() {
    logger.info('MCP: Getting graph statistics');

    if (typeof (this.storageProvider as any).getGraphStatistics === 'function') {
      return await (this.storageProvider as any).getGraphStatistics();
    } else {
      throw new Error('Graph statistics not supported by storage provider');
    }
  }

  /**
   * Semantic search (MCP tool: semantic_search)
   */
  async semanticSearch(args: {
    query: string;
    limit?: number;
    min_similarity?: number;
    entity_types?: string[];
    hybrid_search?: boolean;
    semantic_weight?: number;
  }) {
    logger.info('MCP: Semantic search', { query: args.query, limit: args.limit });

    // Use the storage provider's semanticSearch method (correct method name)
    if (typeof (this.storageProvider as any).semanticSearch === 'function') {
      const searchOptions = {
        limit: args.limit || 10,
        minSimilarity: args.min_similarity || 0.6,
        entityTypes: args.entity_types || [],
        hybridSearch: args.hybrid_search !== undefined ? args.hybrid_search : true,
        semanticWeight: args.semantic_weight || 0.6,
      };

      return await (this.storageProvider as any).semanticSearch(args.query, searchOptions);
    } else {
      throw new Error('Semantic search not supported by storage provider');
    }
  }

  /**
   * Find similar entities (MCP tool: find_similar_entities)
   */
  async findSimilarEntities(args: {
    query: string;
    limit?: number;
    threshold?: number;
  }) {
    logger.info('MCP: Finding similar entities', { query: args.query, limit: args.limit });

    if (typeof (this.storageProvider as any).findSimilarEntities === 'function') {
      return await (this.storageProvider as any).findSimilarEntities(
        args.query,
        args.limit || 10,
        args.threshold || 0.7
      );
    } else {
      throw new Error('Find similar entities not supported by storage provider');
    }
  }

  /**
   * Advanced search (MCP tool: advanced_search)
   */
  async advancedSearch(args: {
    query: string;
    semanticSearch?: boolean;
    hybridSearch?: boolean;
    limit?: number;
    threshold?: number;
    minSimilarity?: number;
    entityTypes?: string[];
    facets?: string[];
    offset?: number;
  }) {
    logger.info('MCP: Advanced search', { query: args.query, semanticSearch: args.semanticSearch });

    const searchOptions = {
      limit: args.limit || 10,
      offset: args.offset || 0,
      entityTypes: args.entityTypes || [],
      semanticSearch: args.semanticSearch || false,
      hybridSearch: args.hybridSearch || false,
      minSimilarity: args.minSimilarity || args.threshold || 0.6,
      facets: args.facets || [],
    };

    if (typeof (this.storageProvider as any).advancedSearch === 'function') {
      return await (this.storageProvider as any).advancedSearch(args.query, searchOptions);
    } else {
      // Fallback to regular search with options
      return await this.searchEntities({
        query: args.query,
        limit: searchOptions.limit,
        offset: searchOptions.offset,
        entityTypes: searchOptions.entityTypes,
        semanticSearch: searchOptions.semanticSearch,
        threshold: searchOptions.minSimilarity,
      });
    }
  }

  /**
   * Get entity embedding (MCP tool: get_entity_embedding)
   */
  async getEntityEmbedding(args: { entity_name: string }) {
    logger.info('MCP: Getting entity embedding', { entity_name: args.entity_name });

    if (typeof (this.storageProvider as any).getEntityEmbedding === 'function') {
      const embedding = await (this.storageProvider as any).getEntityEmbedding(args.entity_name);
      
      if (!embedding) {
        throw new Error(`No embedding found for entity: ${args.entity_name}`);
      }

      return {
        entityName: args.entity_name,
        embedding: embedding.vector,
        model: embedding.model || 'unknown',
        dimensions: embedding.vector ? embedding.vector.length : 0,
        lastUpdated: embedding.lastUpdated || Date.now(),
      };
    } else {
      throw new Error('Entity embedding retrieval not supported by storage provider');
    }
  }

  /**
   * Get node analytics (MCP tool: get_node_analytics)
   */
  async getNodeAnalytics(args: {
    entityName: string;
    includeNeighbors?: boolean;
    neighborDepth?: number;
    includeCentrality?: boolean;
    includePathMetrics?: boolean;
    includeClustering?: boolean;
    maxNeighbors?: number;
  }) {
    logger.info('MCP: Getting node analytics', { entityName: args.entityName });

    if (typeof (this.storageProvider as any).getNodeAnalytics === 'function') {
      return await (this.storageProvider as any).getNodeAnalytics(args.entityName, {
        includeNeighbors: args.includeNeighbors !== undefined ? args.includeNeighbors : true,
        neighborDepth: args.neighborDepth || 1,
        includeCentrality: args.includeCentrality || false,
        includePathMetrics: args.includePathMetrics || false,
        includeClustering: args.includeClustering || false,
        maxNeighbors: args.maxNeighbors || 100,
      });
    } else {
      throw new Error('Node analytics not supported by storage provider');
    }
  }

  /**
   * Find paths (MCP tool: find_paths)
   */
  async findPaths(args: {
    fromEntity: string;
    toEntity: string;
    maxDepth?: number;
    findAllPaths?: boolean;
    maxPaths?: number;
    relationTypes?: string[];
    excludeRelationTypes?: string[];
    bidirectional?: boolean;
    includeWeights?: boolean;
    algorithm?: string;
    includeAnalysis?: boolean;
  }) {
    logger.info('MCP: Finding paths', { from: args.fromEntity, to: args.toEntity });

    if (typeof (this.storageProvider as any).findPaths === 'function') {
      return await (this.storageProvider as any).findPaths(args.fromEntity, args.toEntity, {
        maxDepth: args.maxDepth || 6,
        findAllPaths: args.findAllPaths || false,
        maxPaths: args.maxPaths || 10,
        relationTypes: args.relationTypes,
        excludeRelationTypes: args.excludeRelationTypes,
        bidirectional: args.bidirectional !== undefined ? args.bidirectional : true,
        includeWeights: args.includeWeights || false,
        algorithm: args.algorithm || 'bfs',
        includeAnalysis: args.includeAnalysis !== undefined ? args.includeAnalysis : true,
      });
    } else {
      throw new Error('Path finding not supported by storage provider');
    }
  }

  /**
   * Read entire graph (MCP tool: read_graph)
   */
  async readGraph() {
    logger.info('MCP: Reading entire graph');

    // First try the readGraph method (our new compatibility method)
    if (typeof (this.storageProvider as any).readGraph === 'function') {
      return await (this.storageProvider as any).readGraph();
    } 
    // Fallback to loadGraph method
    else if (typeof (this.storageProvider as any).loadGraph === 'function') {
      return await (this.storageProvider as any).loadGraph();
    } 
    else {
      throw new Error('Read graph not supported by storage provider');
    }
  }

  /**
   * Search nodes (MCP tool: search_nodes)
   */
  async searchNodes(args: { query: string }) {
    logger.info('MCP: Searching nodes', { query: args.query });

    if (typeof (this.storageProvider as any).searchNodes === 'function') {
      return await (this.storageProvider as any).searchNodes(args.query);
    } else {
      // Fallback to entity search
      const result = await this.searchEntities({ query: args.query });
      return {
        entities: result.entities,
        total: result.total,
      };
    }
  }

  /**
   * Open nodes (MCP tool: open_nodes)
   */
  async openNodes(args: { names: string[] }) {
    logger.info('MCP: Opening nodes', { count: args.names.length });

    if (typeof (this.storageProvider as any).openNodes === 'function') {
      return await (this.storageProvider as any).openNodes(args.names);
    } else {
      // Fallback to getting entities individually
      const entities = await Promise.all(
        args.names.map(async (name) => {
          try {
            const result = await this.getEntity({ name });
            return result.entity;
          } catch (error) {
            logger.warn(`Failed to get entity ${name}:`, error);
            return null;
          }
        })
      );

      return {
        entities: entities.filter(Boolean),
      };
    }
  }

  /**
   * Delete observations (MCP tool: delete_observations)
   * Uses soft delete with temporal validity instead of hard deletion
   */
  async deleteObservations(args: {
    deletions: Array<{
      entityName: string;
      observations: string[];
    }>;
  }) {
    logger.info('MCP: Soft deleting observations (temporal validity)', { count: args.deletions.length });

    // Use soft delete directly on storage provider for temporal validity
    if (typeof (this.storageProvider as any).softDeleteObservations === 'function') {
      try {
        const results = await (this.storageProvider as any).softDeleteObservations(args.deletions);
        
        return { 
          success: true, 
          results,
          message: 'Observations soft deleted with temporal validity instead of permanent removal'
        };
      } catch (error) {
        logger.error('Failed to soft delete observations:', error);
        throw new Error(`Soft delete observations failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      // Fallback to deprecated hard delete if soft delete not available
      logger.warn('Soft delete not available, falling back to hard delete');
      
      try {
        await this.storageProvider.deleteObservations(args.deletions);
        return { 
          success: true, 
          message: 'Observations hard deleted (soft delete not available)'
        };
      } catch (error) {
        logger.error('Failed to delete observations:', error);
        throw new Error(`Delete observations failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  /**
   * Soft delete observations (MCP tool: soft_delete_observations)
   * Preferred method that sets temporal validity instead of removing observations
   */
  async softDeleteObservations(args: {
    deletions: Array<{
      entityName: string;
      observations: string[];
    }>;
  }) {
    logger.info('MCP: Soft deleting observations with temporal validity', { count: args.deletions.length });

    if (typeof (this.storageProvider as any).softDeleteObservations === 'function') {
      try {
        const results = await (this.storageProvider as any).softDeleteObservations(args.deletions);
        
        return { 
          success: true, 
          results,
          message: 'Observations marked as invalid with temporal validity timestamps',
          temporal_approach: 'Observations preserved with validTo timestamp for audit trail'
        };
      } catch (error) {
        logger.error('Failed to soft delete observations:', error);
        throw new Error(`Soft delete observations failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      throw new Error('Soft delete observations not supported by storage provider');
    }
  }

  /**
   * Update relation (MCP tool: update_relation)
   */
  async updateRelation(args: {
    relation: {
      from: string;
      to: string;
      relationType: string;
      strength?: number;
      confidence?: number;
      metadata?: any;
      [key: string]: any;
    };
  }) {
    logger.info('MCP: Updating relation', { 
      from: args.relation.from, 
      to: args.relation.to, 
      type: args.relation.relationType 
    });

    // Create a proper Relation object for the service
    const relationToUpdate = {
      ...args.relation,
      metadata: args.relation.metadata || {},
    };

    const result = await this.relationService.updateRelation(relationToUpdate, {
      expertiseArea: 'default'
    });

    if (!result.success) {
      throw new Error(`Relation update failed: ${result.errors?.join(', ')}`);
    }

    return {
      relation: result.data,
      warnings: result.warnings,
      suggestions: result.suggestions
    };
  }

  // Temporal methods
  /**
   * Get entity history (MCP tool: get_entity_history)
   */
  async getEntityHistory(args: { entityName: string }) {
    logger.info('MCP: Getting entity history', { entityName: args.entityName });

    if (typeof (this.storageProvider as any).getEntityHistory === 'function') {
      return await (this.storageProvider as any).getEntityHistory(args.entityName);
    } else {
      throw new Error('Entity history not supported by storage provider');
    }
  }

  /**
   * Get relation history (MCP tool: get_relation_history)
   */
  async getRelationHistory(args: {
    from: string;
    to: string;
    relationType: string;
  }) {
    logger.info('MCP: Getting relation history', args);

    if (typeof (this.storageProvider as any).getRelationHistory === 'function') {
      return await (this.storageProvider as any).getRelationHistory(
        args.from,
        args.to,
        args.relationType
      );
    } else {
      throw new Error('Relation history not supported by storage provider');
    }
  }

  /**
   * Get graph at time (MCP tool: get_graph_at_time)
   */
  async getGraphAtTime(args: { timestamp: number }) {
    logger.info('MCP: Getting graph at time', { timestamp: args.timestamp });

    if (typeof (this.storageProvider as any).getGraphAtTime === 'function') {
      return await (this.storageProvider as any).getGraphAtTime(args.timestamp);
    } else {
      throw new Error('Temporal graph queries not supported by storage provider');
    }
  }

  /**
   * Get decayed graph (MCP tool: get_decayed_graph)
   */
  async getDecayedGraph(args?: {
    reference_time?: number;
    decay_factor?: number;
  }) {
    logger.info('MCP: Getting decayed graph', args);

    if (typeof (this.storageProvider as any).getDecayedGraph === 'function') {
      const options: any = {};
      if (args?.reference_time) options.referenceTime = args.reference_time;
      if (args?.decay_factor) options.decayFactor = args.decay_factor;

      return Object.keys(options).length > 0
        ? await (this.storageProvider as any).getDecayedGraph(options)
        : await (this.storageProvider as any).getDecayedGraph();
    } else {
      throw new Error('Decayed graph not supported by storage provider');
    }
  }

  // Debug methods
  /**
   * Force generate embedding (MCP tool: force_generate_embedding)
   */
  async forceGenerateEmbedding(args: { entity_name: string }) {
    logger.info('MCP: Force generating embedding', { entity_name: args.entity_name });

    if (typeof (this.storageProvider as any).forceGenerateEmbedding === 'function') {
      return await (this.storageProvider as any).forceGenerateEmbedding(args.entity_name);
    } else {
      throw new Error('Force generate embedding not supported by storage provider');
    }
  }

  /**
   * Debug embedding config (MCP tool: debug_embedding_config)
   */
  async debugEmbeddingConfig() {
    logger.info('MCP: Debug embedding config');

    if (typeof (this.storageProvider as any).debugEmbeddingConfig === 'function') {
      return await (this.storageProvider as any).debugEmbeddingConfig();
    } else {
      throw new Error('Debug embedding config not supported by storage provider');
    }
  }

  /**
   * Diagnose vector search (MCP tool: diagnose_vector_search)
   */
  async diagnoseVectorSearch() {
    logger.info('MCP: Diagnose vector search');

    if (typeof (this.storageProvider as any).diagnoseVectorSearch === 'function') {
      return await (this.storageProvider as any).diagnoseVectorSearch();
    } else {
      throw new Error('Diagnose vector search not supported by storage provider');
    }
  }
}
