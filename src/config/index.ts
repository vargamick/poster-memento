/**
 * Central configuration loader for Memento
 * Integrates all configuration systems including pagination
 */

import { logger } from '../utils/logger.js';
import { 
  PaginationConfig, 
  loadPaginationConfigFromEnvironment,
  DEFAULT_PAGINATION_CONFIG 
} from './PaginationConfig.js';
import { StorageConfig, createStorageConfig } from './storage.js';

/**
 * Complete Memento configuration
 */
export interface MementoConfig {
  /**
   * Storage configuration
   */
  storage: StorageConfig;
  
  /**
   * Pagination configuration
   */
  pagination: PaginationConfig;
  
  /**
   * Server configuration
   */
  server: {
    port: number;
    apiKey?: string;
    nodeEnv: string;
  };
  
  /**
   * Embedding configuration
   */
  embedding: {
    openaiApiKey?: string;
    model: string;
    rateLimitTokens: number;
    rateLimitInterval: number;
    disableJobProcessing: boolean;
  };
  
  /**
   * Date formatting configuration
   */
  dateFormat: {
    locale: string;
    timezone: string;
    dateStyle: string;
    timeStyle: string;
  };
}

/**
 * Load complete Memento configuration from environment variables
 */
export function loadMementoConfig(): MementoConfig {
  logger.debug('Loading Memento configuration from environment variables');

  try {
    // Load storage configuration
    const storage = createStorageConfig(process.env.MEMORY_STORAGE_TYPE);

    // Load pagination configuration
    const pagination = loadPaginationConfigFromEnvironment();

    // Load server configuration
    const server = {
      port: parseInt(process.env.PORT || '3000', 10),
      apiKey: process.env.MEMENTO_API_KEY,
      nodeEnv: process.env.NODE_ENV || 'development',
    };

    // Load embedding configuration
    const embedding = {
      openaiApiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
      rateLimitTokens: parseInt(process.env.EMBEDDING_RATE_LIMIT_TOKENS || '20', 10),
      rateLimitInterval: parseInt(process.env.EMBEDDING_RATE_LIMIT_INTERVAL || '60000', 10),
      disableJobProcessing: process.env.DISABLE_JOB_PROCESSING === 'true',
    };

    // Load date format configuration
    const dateFormat = {
      locale: process.env.DATE_LOCALE || 'en-AU',
      timezone: process.env.DATE_TIMEZONE || 'Australia/Melbourne',
      dateStyle: process.env.DATE_STYLE || 'short',
      timeStyle: process.env.TIME_STYLE || 'short',
    };

    const config: MementoConfig = {
      storage,
      pagination,
      server,
      embedding,
      dateFormat,
    };

    logger.debug('Configuration loaded successfully', {
      storageType: config.storage.type,
      paginationDefaults: {
        limit: config.pagination.defaultLimit,
        pageSize: config.pagination.defaultPageSize,
      },
      serverPort: config.server.port,
      embeddingModel: config.embedding.model,
    });

    return config;
  } catch (error) {
    logger.error('Failed to load configuration', error);
    
    // Return a safe default configuration
    return {
      storage: createStorageConfig('neo4j'),
      pagination: DEFAULT_PAGINATION_CONFIG,
      server: {
        port: 3000,
        nodeEnv: 'development',
      },
      embedding: {
        model: 'text-embedding-3-small',
        rateLimitTokens: 20,
        rateLimitInterval: 60000,
        disableJobProcessing: false,
      },
      dateFormat: {
        locale: 'en-AU',
        timezone: 'Australia/Melbourne',
        dateStyle: 'short',
        timeStyle: 'short',
      },
    };
  }
}

/**
 * Validate the loaded configuration
 */
export function validateMementoConfig(config: MementoConfig): void {
  const errors: string[] = [];

  // Validate server configuration
  if (config.server.port < 1 || config.server.port > 65535) {
    errors.push('Server port must be between 1 and 65535');
  }

  // Validate embedding configuration
  if (config.embedding.rateLimitTokens < 1) {
    errors.push('Embedding rate limit tokens must be at least 1');
  }

  if (config.embedding.rateLimitInterval < 1000) {
    errors.push('Embedding rate limit interval must be at least 1000ms');
  }

  // Pagination validation is handled in PaginationConfig.ts

  if (errors.length > 0) {
    const errorMessage = `Configuration validation failed: ${errors.join(', ')}`;
    logger.error(errorMessage);
    throw new Error(errorMessage);
  }

  logger.debug('Configuration validation passed');
}

/**
 * Load and validate complete Memento configuration
 */
export function loadAndValidateConfig(): MementoConfig {
  const config = loadMementoConfig();
  validateMementoConfig(config);
  return config;
}

// Re-export specific configurations for backward compatibility
export { PaginationConfig, loadPaginationConfigFromEnvironment } from './PaginationConfig.js';
export { StorageConfig, createStorageConfig, initializeStorageProvider } from './storage.js';

// Export individual configuration loaders for compatibility
export const Config = {
  /**
   * Get pagination configuration
   */
  getPaginationConfig(): PaginationConfig {
    return loadPaginationConfigFromEnvironment();
  },

  /**
   * Get storage configuration
   */
  getStorageConfig(): StorageConfig {
    return createStorageConfig(process.env.MEMORY_STORAGE_TYPE);
  },

  /**
   * Get complete configuration
   */
  getFullConfig(): MementoConfig {
    return loadAndValidateConfig();
  },
};
