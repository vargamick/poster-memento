import { StorageProviderFactory } from '../storage/StorageProviderFactory.js';
import type { VectorStoreFactoryOptions } from '../storage/VectorStoreFactory.js';
import { logger } from '../utils/logger.js';

/**
 * Standard embedding dimensions for Voyage AI
 * DO NOT CHANGE without explicit approval from repository maintainers
 */
export const VOYAGE_AI_DIMENSIONS = 1024;

/**
 * Determines the storage type based on the environment variable
 * @param _envType Storage type from environment variable (unused)
 * @returns 'neo4j' storage type
 */
export function determineStorageType(_envType: string | undefined): 'neo4j' {
  // Graph storage always uses Neo4j
  // Vector storage can be configured separately via VECTOR_STORAGE env var
  return 'neo4j';
}

/**
 * Determines the vector storage type based on the environment variable
 * @param envType Vector storage type from environment variable
 * @returns 'neo4j' or 'postgres' vector storage type
 */
export function determineVectorStorageType(envType: string | undefined): 'neo4j' | 'postgres' {
  const type = (envType || 'neo4j').toLowerCase();

  if (type === 'postgres' || type === 'postgresql' || type === 'pgvector') {
    return 'postgres';
  }

  // Default to neo4j
  return 'neo4j';
}

/**
 * Configuration for storage providers
 */
export interface StorageConfig {
  type: 'neo4j';
  options: {
    // Neo4j specific options
    neo4jUri?: string;
    neo4jUsername?: string;
    neo4jPassword?: string;
    neo4jDatabase?: string;
    neo4jVectorIndexName?: string;
    neo4jVectorDimensions?: number;
    neo4jSimilarityFunction?: 'cosine' | 'euclidean';
    // PostgreSQL specific options (for vector storage)
    postgresHost?: string;
    postgresPort?: number;
    postgresUser?: string;
    postgresPassword?: string;
    postgresDatabase?: string;
  };
  vectorStoreOptions?: VectorStoreFactoryOptions;
}

/**
 * Validates and retrieves embedding dimensions with strict enforcement
 * @returns Validated embedding dimensions
 */
function getValidatedEmbeddingDimensions(): number {
  const envDimensions = process.env.EMBEDDING_DIMENSIONS
    ? parseInt(process.env.EMBEDDING_DIMENSIONS, 10)
    : undefined;

  if (envDimensions && envDimensions !== VOYAGE_AI_DIMENSIONS) {
    logger.error(
      `CRITICAL: Embedding dimensions set to ${envDimensions} but must be ${VOYAGE_AI_DIMENSIONS} (Voyage AI standard)`,
      {
        provided: envDimensions,
        required: VOYAGE_AI_DIMENSIONS,
        provider: 'Voyage AI',
      }
    );
    logger.error(
      'Changing embedding dimensions requires explicit approval from repository maintainers'
    );
    logger.error(`Forcing dimensions to ${VOYAGE_AI_DIMENSIONS} to prevent data incompatibility`);
  }

  return VOYAGE_AI_DIMENSIONS;
}

/**
 * Creates a storage configuration object
 * @param storageType Storage type (forced to 'neo4j')
 * @returns Storage provider configuration
 */
export function createStorageConfig(storageType: string | undefined): StorageConfig {
  // Neo4j is always the type for graph storage
  const type = determineStorageType(storageType);

  // Determine vector storage type
  const vectorStorageType = determineVectorStorageType(process.env.VECTOR_STORAGE);

  // Get validated embedding dimensions (enforces Voyage AI standard)
  const embeddingDimensions = getValidatedEmbeddingDimensions();

  logger.info('Configuring storage provider', {
    graphStorage: 'neo4j',
    vectorStorage: vectorStorageType,
    embeddingDimensions,
    embeddingProvider: 'voyage-ai',
    neo4jUri: process.env.NEO4J_URI || 'bolt://localhost:7687',
    neo4jDatabase: process.env.NEO4J_DATABASE || 'neo4j',
    postgresHost: process.env.POSTGRES_HOST,
    postgresDatabase: process.env.POSTGRES_DATABASE,
  });

  // Base configuration with Neo4j properties
  const config: StorageConfig = {
    type,
    options: {
      // Neo4j connection options from environment variables
      neo4jUri: process.env.NEO4J_URI || 'bolt://localhost:7687',
      neo4jUsername: process.env.NEO4J_USERNAME || process.env.NEO4J_USER || 'neo4j',
      neo4jPassword: process.env.NEO4J_PASSWORD || 'memento_password',
      neo4jDatabase: process.env.NEO4J_DATABASE || 'neo4j',
      neo4jVectorIndexName: process.env.NEO4J_VECTOR_INDEX || 'entity_embeddings',
      neo4jVectorDimensions: embeddingDimensions,
      neo4jSimilarityFunction:
        (process.env.NEO4J_SIMILARITY_FUNCTION as 'cosine' | 'euclidean') || 'cosine',
      // PostgreSQL connection options (if using postgres for vectors)
      postgresHost: process.env.POSTGRES_HOST || 'localhost',
      postgresPort: process.env.POSTGRES_PORT ? parseInt(process.env.POSTGRES_PORT, 10) : 5432,
      postgresUser: process.env.POSTGRES_USER || 'postgres',
      postgresPassword: process.env.POSTGRES_PASSWORD || 'postgres',
      postgresDatabase: process.env.POSTGRES_DATABASE || 'memento',
    },
    // Vector store configuration
    vectorStoreOptions: {
      type: vectorStorageType,
      indexName: process.env.VECTOR_INDEX_NAME || 'entity_embeddings',
      dimensions: embeddingDimensions,
      similarityFunction:
        (process.env.VECTOR_SIMILARITY_FUNCTION as 'cosine' | 'euclidean') || 'cosine',
      // Add Neo4j config for vector store
      neo4jConfig: {
        uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
        username: process.env.NEO4J_USERNAME || process.env.NEO4J_USER || 'neo4j',
        password: process.env.NEO4J_PASSWORD || 'memento_password',
        database: process.env.NEO4J_DATABASE || 'neo4j',
        vectorIndexName: process.env.NEO4J_VECTOR_INDEX || 'entity_embeddings',
        vectorDimensions: embeddingDimensions,
        similarityFunction:
          (process.env.NEO4J_SIMILARITY_FUNCTION as 'cosine' | 'euclidean') || 'cosine',
      },
      // Add PostgreSQL config for vector store (if using PostgreSQL)
      postgresConfig:
        vectorStorageType === 'postgres'
          ? {
              host: process.env.POSTGRES_HOST || 'localhost',
              port: process.env.POSTGRES_PORT ? parseInt(process.env.POSTGRES_PORT, 10) : 5432,
              user: process.env.POSTGRES_USER || 'postgres',
              password: process.env.POSTGRES_PASSWORD || 'postgres',
              database: process.env.POSTGRES_DATABASE || 'memento',
            }
          : undefined,
    },
  };

  return config;
}

/**
 * Initializes the storage provider based on environment variables
 * @returns Configured storage provider
 */
export function initializeStorageProvider(): ReturnType<StorageProviderFactory['createProvider']> {
  const factory = new StorageProviderFactory();
  const config = createStorageConfig(process.env.MEMORY_STORAGE_TYPE);

  return factory.createProvider(config);
}
