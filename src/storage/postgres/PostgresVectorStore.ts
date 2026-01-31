import type { VectorStore, VectorSearchResult } from '../../types/vector-store.js';
import type { PostgresConnectionManager } from './PostgresConnectionManager.js';
import { logger } from '../../utils/logger.js';

export interface PostgresVectorStoreOptions {
  connectionManager: PostgresConnectionManager;
  tableName?: string;
  dimensions?: number;
  similarityFunction?: 'cosine' | 'euclidean' | 'inner_product';
}

/**
 * PostgreSQL implementation of VectorStore interface using pgvector extension
 */
export class PostgresVectorStore implements VectorStore {
  private readonly connectionManager: PostgresConnectionManager;
  private readonly tableName: string;
  private readonly dimensions: number;
  private readonly similarityFunction: 'cosine' | 'euclidean' | 'inner_product';
  private initialized = false;

  constructor(options: PostgresVectorStoreOptions) {
    this.connectionManager = options.connectionManager;
    this.tableName = options.tableName || 'entity_embeddings';
    this.dimensions = options.dimensions || 1024; // Default to Voyage AI dimensions
    this.similarityFunction = options.similarityFunction || 'cosine';
  }

  /**
   * Initialize the PostgreSQL vector store by creating necessary tables and indexes
   */
  async initialize(): Promise<void> {
    try {
      logger.info('Initializing PostgreSQL vector store');

      // Enable pgvector extension
      await this.connectionManager.query('CREATE EXTENSION IF NOT EXISTS vector');
      logger.info('pgvector extension enabled');

      // Create embeddings table if it doesn't exist
      await this.connectionManager.query(`
        CREATE TABLE IF NOT EXISTS ${this.tableName} (
          id TEXT PRIMARY KEY,
          entity_id TEXT NOT NULL,
          embedding vector(${this.dimensions}) NOT NULL,
          metadata JSONB DEFAULT '{}'::jsonb,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        )
      `);
      logger.info(`Created table: ${this.tableName}`);

      // Create index on entity_id for faster lookups
      await this.connectionManager.query(`
        CREATE INDEX IF NOT EXISTS ${this.tableName}_entity_id_idx
        ON ${this.tableName}(entity_id)
      `);

      // Create vector index for efficient similarity search
      const indexName = `${this.tableName}_embedding_idx`;

      await this.connectionManager.query(`
        CREATE INDEX IF NOT EXISTS ${indexName}
        ON ${this.tableName}
        USING ivfflat (embedding)
        WITH (lists = 100)
      `);
      logger.info(`Created vector index: ${indexName} with ${this.similarityFunction} distance`);

      this.initialized = true;
      logger.info('PostgreSQL vector store initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize PostgreSQL vector store', error);
      throw error;
    }
  }

  /**
   * Add or update a vector for an entity
   */
  async addVector(
    id: string | number,
    vector: number[],
    metadata?: Record<string, any>
  ): Promise<void> {
    this.ensureInitialized();

    // Validate vector dimensions
    if (vector.length !== this.dimensions) {
      throw new Error(
        `Invalid vector dimensions: expected ${this.dimensions}, got ${vector.length}`
      );
    }

    try {
      const entityId = String(id);
      const metadataJson = metadata ? JSON.stringify(metadata) : '{}';

      // Upsert the vector
      await this.connectionManager.query(
        `
        INSERT INTO ${this.tableName} (id, entity_id, embedding, metadata, created_at, updated_at)
        VALUES ($1, $2, $3::vector, $4::jsonb, NOW(), NOW())
        ON CONFLICT (id)
        DO UPDATE SET
          embedding = $3::vector,
          metadata = $4::jsonb,
          updated_at = NOW()
        `,
        [entityId, entityId, `[${vector.join(',')}]`, metadataJson]
      );

      logger.debug(`Added/updated vector for entity: ${entityId}`);
    } catch (error) {
      logger.error(`Failed to add vector for entity ${id}`, error);
      throw error;
    }
  }

  /**
   * Remove a vector by ID
   */
  async removeVector(id: string | number): Promise<void> {
    this.ensureInitialized();

    try {
      const result = await this.connectionManager.query(
        `DELETE FROM ${this.tableName} WHERE id = $1`,
        [String(id)]
      );

      if (result.rowCount && result.rowCount > 0) {
        logger.debug(`Removed vector for entity: ${id}`);
      } else {
        logger.warn(`No vector found for entity: ${id}`);
      }
    } catch (error) {
      logger.error(`Failed to remove vector for entity ${id}`, error);
      throw error;
    }
  }

  /**
   * Search for similar vectors
   */
  async search(
    queryVector: number[],
    options?: {
      limit?: number;
      filter?: Record<string, any>;
      minSimilarity?: number;
    }
  ): Promise<VectorSearchResult[]> {
    this.ensureInitialized();

    // Validate query vector dimensions
    if (queryVector.length !== this.dimensions) {
      throw new Error(
        `Invalid query vector dimensions: expected ${this.dimensions}, got ${queryVector.length}`
      );
    }

    const limit = options?.limit || 10;
    const minSimilarity = options?.minSimilarity || 0;

    try {
      const distanceOp = this.getDistanceOperator();
      const queryVectorStr = `[${queryVector.join(',')}]`;

      // Build WHERE clause for metadata filtering
      let whereClause = '';
      const params: any[] = [queryVectorStr, limit];

      if (options?.filter) {
        const filterConditions: string[] = [];
        let paramIndex = 3;

        for (const [key, value] of Object.entries(options.filter)) {
          filterConditions.push(`metadata->>'${key}' = $${paramIndex}`);
          params.push(value);
          paramIndex++;
        }

        if (filterConditions.length > 0) {
          whereClause = `WHERE ${filterConditions.join(' AND ')}`;
        }
      }

      // Execute vector similarity search
      const query = `
        SELECT
          entity_id as id,
          1 - (embedding ${distanceOp} $1::vector) as similarity,
          metadata
        FROM ${this.tableName}
        ${whereClause}
        ORDER BY embedding ${distanceOp} $1::vector
        LIMIT $2
      `;

      const result = await this.connectionManager.query(query, params);

      // Filter by minimum similarity and map results
      const results: VectorSearchResult[] = result.rows
        .filter((row: any) => row.similarity >= minSimilarity)
        .map((row: any) => ({
          id: row.id,
          similarity: row.similarity,
          metadata: row.metadata || {},
        }));

      logger.debug(`Vector search returned ${results.length} results`);
      return results;
    } catch (error) {
      logger.error('Vector search failed', error);
      throw error;
    }
  }

  /**
   * Get the distance operator for the configured similarity function
   */
  private getDistanceOperator(): string {
    switch (this.similarityFunction) {
      case 'cosine':
        return '<=>';  // Cosine distance operator
      case 'euclidean':
        return '<->';  // L2/Euclidean distance operator
      case 'inner_product':
        return '<#>';  // Inner product distance operator
      default:
        return '<=>';  // Default to cosine
    }
  }

  /**
   * Ensure the vector store has been initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('PostgreSQL vector store is not initialized. Call initialize() first.');
    }
  }

  /**
   * Get statistics about the vector store
   */
  async getStats(): Promise<{
    totalVectors: number;
    tableName: string;
    dimensions: number;
  }> {
    this.ensureInitialized();

    const result = await this.connectionManager.query(
      `SELECT COUNT(*) as count FROM ${this.tableName}`
    );

    return {
      totalVectors: parseInt(result.rows[0].count),
      tableName: this.tableName,
      dimensions: this.dimensions,
    };
  }
}
