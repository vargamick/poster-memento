import { fs } from '../utils/fs.js';
import path from 'path';
import type { InstanceConfig } from './ConfigSchema.js';
import { DEFAULT_INSTANCE_CONFIG, validateInstanceConfig } from './ConfigSchema.js';
import { logger } from '../utils/logger.js';

/**
 * Configuration loader for Memento instances
 * Supports loading from files and environment variables
 */
export class ConfigLoader {

  /**
   * Load instance configuration from file or environment
   */
  static async loadInstanceConfig(configPath?: string): Promise<InstanceConfig> {

    // Priority order:
    // 1. Explicit config file path
    // 2. CONFIG_PATH environment variable
    // 3. Default: ./config/instance-config.json

    const finalPath = configPath
      || process.env.CONFIG_PATH
      || path.join(process.cwd(), 'config', 'instance-config.json');

    try {
      let config: InstanceConfig;

      try {
        await fs.access(finalPath);
        // File exists
        const configData = await fs.readFile(finalPath, 'utf-8');
        config = JSON.parse(configData) as InstanceConfig;
        logger.info(`Loaded instance config from: ${finalPath}`);
      } catch (accessError) {
        // File doesn't exist
        logger.warn(`Config file not found: ${finalPath}, using defaults`);
        config = this.getDefaultConfig();
      }

      // Merge with defaults
      config = this.mergeWithDefaults(config);

      // Merge with environment variable overrides
      config = this.mergeWithEnv(config);

      // Validate configuration
      const validation = validateInstanceConfig(config);
      if (!validation.valid) {
        logger.error('Invalid configuration:', validation.errors);
        throw new Error(`Configuration validation failed: ${validation.errors.join(', ')}`);
      }

      if (validation.warnings.length > 0) {
        logger.warn('Configuration warnings:', validation.warnings);
      }

      logger.info(`Instance config loaded: ${config.instanceName} (${config.useCase})`);
      return config;

    } catch (error: any) {
      logger.error(`Failed to load config from ${finalPath}`, error);
      throw new Error(`Config load error: ${error.message}`);
    }
  }

  /**
   * Merge config with default values
   */
  private static mergeWithDefaults(config: Partial<InstanceConfig>): InstanceConfig {
    return {
      ...DEFAULT_INSTANCE_CONFIG,
      ...config,
      chunkingConfig: {
        ...DEFAULT_INSTANCE_CONFIG.chunkingConfig!,
        ...config.chunkingConfig,
        options: {
          ...DEFAULT_INSTANCE_CONFIG.chunkingConfig!.options,
          ...config.chunkingConfig?.options
        }
      },
      searchConfig: {
        ...DEFAULT_INSTANCE_CONFIG.searchConfig!,
        ...config.searchConfig,
        hybridWeights: {
          ...DEFAULT_INSTANCE_CONFIG.searchConfig!.hybridWeights!,
          ...config.searchConfig?.hybridWeights
        }
      },
      processingConfig: {
        ...DEFAULT_INSTANCE_CONFIG.processingConfig!,
        ...config.processingConfig
      },
      metadataExtraction: {
        ...DEFAULT_INSTANCE_CONFIG.metadataExtraction!,
        ...config.metadataExtraction,
        fields: {
          ...DEFAULT_INSTANCE_CONFIG.metadataExtraction!.fields,
          ...config.metadataExtraction?.fields
        }
      }
    } as InstanceConfig;
  }

  /**
   * Merge config with environment variable overrides
   */
  private static mergeWithEnv(config: InstanceConfig): InstanceConfig {
    return {
      ...config,
      instanceName: process.env.INSTANCE_NAME || config.instanceName,
      searchConfig: {
        ...config.searchConfig,
        defaultStrategy: (process.env.DEFAULT_SEARCH_STRATEGY as any)
          || config.searchConfig.defaultStrategy,
        hybridWeights: {
          graph: parseFloat(process.env.HYBRID_GRAPH_WEIGHT
            || String(config.searchConfig.hybridWeights?.graph || 0.4)),
          vector: parseFloat(process.env.HYBRID_VECTOR_WEIGHT
            || String(config.searchConfig.hybridWeights?.vector || 0.6))
        },
        vectorThreshold: parseFloat(process.env.VECTOR_THRESHOLD
          || String(config.searchConfig.vectorThreshold || 0.7)),
        mergeMethod: (process.env.HYBRID_MERGE_METHOD as 'weighted' | 'rrf')
          || config.searchConfig.mergeMethod
      },
      chunkingConfig: {
        ...config.chunkingConfig,
        method: (process.env.CHUNK_METHOD as any) || config.chunkingConfig.method,
        options: {
          ...config.chunkingConfig.options,
          targetTokens: parseInt(process.env.TARGET_TOKENS
            || String(config.chunkingConfig.options.targetTokens || 400)),
          maxTokens: parseInt(process.env.MAX_TOKENS
            || String(config.chunkingConfig.options.maxTokens || 600)),
          overlap: parseInt(process.env.CHUNK_OVERLAP
            || String(config.chunkingConfig.options.overlap || 150)),
          createMasterChunk: process.env.CREATE_MASTER_CHUNK === 'true'
            || config.chunkingConfig.options.createMasterChunk || false
        }
      },
      processingConfig: {
        ...config.processingConfig,
        batchSize: parseInt(process.env.BATCH_SIZE
          || String(config.processingConfig.batchSize)),
        maxConcurrent: parseInt(process.env.MAX_CONCURRENT
          || String(config.processingConfig.maxConcurrent)),
        retryAttempts: parseInt(process.env.RETRY_ATTEMPTS
          || String(config.processingConfig.retryAttempts)),
        logLevel: (process.env.LOG_LEVEL as any) || config.processingConfig.logLevel
      },
      dataSources: config.dataSources ? {
        ...config.dataSources,
        pdfs: config.dataSources.pdfs ? {
          ...config.dataSources.pdfs,
          directory: process.env.PDF_DIRECTORY || config.dataSources.pdfs.directory,
          metadataFile: process.env.METADATA_FILE || config.dataSources.pdfs.metadataFile
        } : undefined
      } : undefined
    };
  }

  /**
   * Get default configuration
   */
  private static getDefaultConfig(): InstanceConfig {
    return {
      instanceName: process.env.INSTANCE_NAME || 'memento-default',
      useCase: 'general',
      version: '1.0.0',
      entityTypes: [],
      chunkingConfig: DEFAULT_INSTANCE_CONFIG.chunkingConfig!,
      searchConfig: DEFAULT_INSTANCE_CONFIG.searchConfig!,
      processingConfig: DEFAULT_INSTANCE_CONFIG.processingConfig!,
      metadataExtraction: DEFAULT_INSTANCE_CONFIG.metadataExtraction!
    };
  }

  /**
   * Save configuration to file
   */
  static async saveInstanceConfig(
    config: InstanceConfig,
    outputPath: string
  ): Promise<void> {
    // Validate before saving
    const validation = validateInstanceConfig(config);
    if (!validation.valid) {
      throw new Error(`Cannot save invalid configuration: ${validation.errors.join(', ')}`);
    }

    const configJson = JSON.stringify(config, null, 2);
    await fs.writeFile(outputPath, configJson, 'utf-8');
    logger.info(`Saved instance config to: ${outputPath}`);
  }

  /**
   * Export configuration to environment variables format
   */
  static exportToEnv(config: InstanceConfig): string[] {
    const envVars: string[] = [];

    // Instance settings
    envVars.push(`INSTANCE_NAME=${config.instanceName}`);
    envVars.push(`USE_CASE=${config.useCase}`);

    // Search configuration
    envVars.push(`DEFAULT_SEARCH_STRATEGY=${config.searchConfig.defaultStrategy}`);
    envVars.push(`HYBRID_GRAPH_WEIGHT=${config.searchConfig.hybridWeights?.graph || 0.4}`);
    envVars.push(`HYBRID_VECTOR_WEIGHT=${config.searchConfig.hybridWeights?.vector || 0.6}`);
    envVars.push(`VECTOR_THRESHOLD=${config.searchConfig.vectorThreshold || 0.7}`);
    if (config.searchConfig.mergeMethod) {
      envVars.push(`HYBRID_MERGE_METHOD=${config.searchConfig.mergeMethod}`);
    }

    // Chunking configuration
    envVars.push(`CHUNK_METHOD=${config.chunkingConfig.method}`);
    envVars.push(`TARGET_TOKENS=${config.chunkingConfig.options.targetTokens || 400}`);
    envVars.push(`MAX_TOKENS=${config.chunkingConfig.options.maxTokens || 600}`);
    envVars.push(`CHUNK_OVERLAP=${config.chunkingConfig.options.overlap || 150}`);
    if (config.chunkingConfig.options.createMasterChunk) {
      envVars.push(`CREATE_MASTER_CHUNK=true`);
    }

    // Processing configuration
    envVars.push(`BATCH_SIZE=${config.processingConfig.batchSize}`);
    envVars.push(`MAX_CONCURRENT=${config.processingConfig.maxConcurrent}`);
    envVars.push(`RETRY_ATTEMPTS=${config.processingConfig.retryAttempts}`);
    if (config.processingConfig.logLevel) {
      envVars.push(`LOG_LEVEL=${config.processingConfig.logLevel}`);
    }

    // Data sources
    if (config.dataSources?.pdfs) {
      envVars.push(`PDF_DIRECTORY=${config.dataSources.pdfs.directory}`);
      if (config.dataSources.pdfs.metadataFile) {
        envVars.push(`METADATA_FILE=${config.dataSources.pdfs.metadataFile}`);
      }
    }

    return envVars;
  }

  /**
   * Load configuration and export to .env file
   */
  static async exportConfigToEnvFile(
    configPath: string,
    envFilePath: string
  ): Promise<void> {
    const config = await this.loadInstanceConfig(configPath);
    const envVars = this.exportToEnv(config);

    const envContent = envVars.join('\n') + '\n';
    await fs.writeFile(envFilePath, envContent, 'utf-8');
    logger.info(`Exported config to .env file: ${envFilePath}`);
  }
}
