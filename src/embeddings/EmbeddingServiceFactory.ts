import type { EmbeddingService } from './EmbeddingService.js';
import { DefaultEmbeddingService } from './DefaultEmbeddingService.js';
import { OpenAIEmbeddingService } from './OpenAIEmbeddingService.js';
import { VoyageAIEmbeddingService } from './VoyageAIEmbeddingService.js';
import { logger } from '../utils/logger.js';

/**
 * Configuration options for embedding services
 */
export interface EmbeddingServiceConfig {
  provider?: string;
  model?: string;
  dimensions?: number;
  apiKey?: string;
  [key: string]: unknown;
}

/**
 * Type definition for embedding service provider creation function
 */
type EmbeddingServiceProvider = (config?: EmbeddingServiceConfig) => EmbeddingService;

/**
 * Factory for creating embedding services
 */
export class EmbeddingServiceFactory {
  /**
   * Registry of embedding service providers
   */
  private static providers: Record<string, EmbeddingServiceProvider> = {};

  /**
   * Register a new embedding service provider
   *
   * @param name - Provider name
   * @param provider - Provider factory function
   */
  static registerProvider(name: string, provider: EmbeddingServiceProvider): void {
    EmbeddingServiceFactory.providers[name.toLowerCase()] = provider;
  }

  /**
   * Reset the provider registry - used primarily for testing
   */
  static resetRegistry(): void {
    EmbeddingServiceFactory.providers = {};
  }

  /**
   * Get a list of available provider names
   *
   * @returns Array of provider names
   */
  static getAvailableProviders(): string[] {
    return Object.keys(EmbeddingServiceFactory.providers);
  }

  /**
   * Create a service using a registered provider
   *
   * @param config - Configuration options including provider name and service-specific settings
   * @returns The created embedding service
   * @throws Error if the provider is not registered
   */
  static createService(config: EmbeddingServiceConfig = {}): EmbeddingService {
    const providerName = (config.provider || 'default').toLowerCase();
    logger.debug(`EmbeddingServiceFactory: Creating service with provider "${providerName}"`);

    const providerFn = EmbeddingServiceFactory.providers[providerName];

    if (providerFn) {
      try {
        const service = providerFn(config);
        logger.debug(
          `EmbeddingServiceFactory: Service created successfully with provider "${providerName}"`,
          {
            modelInfo: service.getModelInfo(),
          }
        );
        return service;
      } catch (error) {
        logger.error(
          `EmbeddingServiceFactory: Failed to create service with provider "${providerName}"`,
          error
        );
        throw error;
      }
    }

    // If provider not found, throw an error
    logger.error(`EmbeddingServiceFactory: Provider "${providerName}" is not registered`);
    throw new Error(`Provider "${providerName}" is not registered`);
  }

  /**
   * Create an embedding service from environment variables
   *
   * @returns An embedding service implementation
   */
  static createFromEnvironment(): EmbeddingService {
    // Check if we should use mock embeddings (for testing)
    const useMockEmbeddings = process.env.MOCK_EMBEDDINGS === 'true';

    logger.debug('EmbeddingServiceFactory: Creating service from environment variables', {
      mockEmbeddings: useMockEmbeddings,
      voyageKeyPresent: !!process.env.VOYAGE_API_KEY,
      openaiKeyPresent: !!process.env.OPENAI_API_KEY,
      embeddingProvider: process.env.EMBEDDING_PROVIDER || 'auto',
    });

    if (useMockEmbeddings) {
      logger.info('EmbeddingServiceFactory: Using mock embeddings for testing');
      return new DefaultEmbeddingService();
    }

    // Check for explicit provider preference
    const provider = (process.env.EMBEDDING_PROVIDER || 'auto').toLowerCase();

    // Try Voyage AI first (recommended for Claude/Anthropic applications)
    const voyageApiKey = process.env.VOYAGE_API_KEY;
    if ((provider === 'auto' || provider === 'voyage') && voyageApiKey) {
      try {
        const model = process.env.VOYAGE_EMBEDDING_MODEL || 'voyage-3';
        logger.debug('EmbeddingServiceFactory: Creating Voyage AI embedding service', {
          model,
        });
        const service = new VoyageAIEmbeddingService({
          apiKey: voyageApiKey,
          model,
        });
        logger.info('EmbeddingServiceFactory: Voyage AI embedding service created successfully', {
          model: service.getModelInfo().name,
          dimensions: service.getModelInfo().dimensions,
        });
        return service;
      } catch (error) {
        logger.error('EmbeddingServiceFactory: Failed to create Voyage AI service', error);
        if (provider === 'voyage') {
          throw error; // Don't fallback if explicitly requested
        }
        logger.info('EmbeddingServiceFactory: Falling back to OpenAI');
      }
    }

    // Try OpenAI as fallback or if explicitly requested
    const openaiApiKey = process.env.OPENAI_API_KEY;
    if ((provider === 'auto' || provider === 'openai') && openaiApiKey) {
      try {
        const embeddingModel = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
        logger.debug('EmbeddingServiceFactory: Creating OpenAI embedding service', {
          model: embeddingModel,
        });
        const service = new OpenAIEmbeddingService({
          apiKey: openaiApiKey,
          model: embeddingModel,
        });
        logger.info('EmbeddingServiceFactory: OpenAI embedding service created successfully', {
          model: service.getModelInfo().name,
          dimensions: service.getModelInfo().dimensions,
        });
        return service;
      } catch (error) {
        logger.error('EmbeddingServiceFactory: Failed to create OpenAI service', error);
        if (provider === 'openai') {
          throw error; // Don't fallback if explicitly requested
        }
        logger.info('EmbeddingServiceFactory: Falling back to default embedding service');
      }
    }

    // No API keys found, using default embedding service
    logger.info(
      'EmbeddingServiceFactory: No embedding API keys found, using default embedding service'
    );
    return new DefaultEmbeddingService();
  }

  /**
   * Create an OpenAI embedding service
   *
   * @param apiKey - OpenAI API key
   * @param model - Optional model name
   * @param dimensions - Optional embedding dimensions
   * @returns OpenAI embedding service
   */
  static createOpenAIService(
    apiKey: string,
    model?: string,
    dimensions?: number
  ): EmbeddingService {
    return new OpenAIEmbeddingService({
      apiKey,
      model,
      dimensions,
    });
  }

  /**
   * Create a default embedding service that generates random vectors
   *
   * @param dimensions - Optional embedding dimensions
   * @returns Default embedding service
   */
  static createDefaultService(dimensions?: number): EmbeddingService {
    return new DefaultEmbeddingService(dimensions);
  }
}

// Register built-in providers
EmbeddingServiceFactory.registerProvider('default', (config = {}) => {
  return new DefaultEmbeddingService(config.dimensions);
});

EmbeddingServiceFactory.registerProvider('openai', (config = {}) => {
  if (!config.apiKey) {
    throw new Error('API key is required for OpenAI embedding service');
  }

  return new OpenAIEmbeddingService({
    apiKey: config.apiKey,
    model: config.model,
    dimensions: config.dimensions,
  });
});

EmbeddingServiceFactory.registerProvider('voyage', (config = {}) => {
  if (!config.apiKey) {
    throw new Error('API key is required for Voyage AI embedding service');
  }

  return new VoyageAIEmbeddingService({
    apiKey: config.apiKey,
    model: config.model,
    dimensions: config.dimensions,
  });
});
