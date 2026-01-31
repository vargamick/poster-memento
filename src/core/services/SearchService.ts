import type { StorageProvider } from '../../storage/StorageProvider.js';
import type { VectorStore } from '../../types/vector-store.js';
import type { EmbeddingService } from '../../embeddings/EmbeddingService.js';
import {
  SearchStrategy,
  GraphSearchStrategy,
  VectorSearchStrategy,
  HybridSearchStrategy,
  SearchOptions,
  ScoredEntity,
  HybridSearchConfig,
  DEFAULT_HYBRID_CONFIG
} from './SearchStrategy.js';
import { logger } from '../../utils/logger.js';

/**
 * Search service configuration
 */
export interface SearchServiceConfig {
  defaultStrategy: 'graph' | 'vector' | 'hybrid';
  hybridConfig?: HybridSearchConfig;
  enableMetadataFiltering?: boolean;
  enableQueryAnalysis?: boolean;
}

/**
 * Search service - orchestrates all search strategies
 */
export class SearchService {
  private strategies: Map<string, SearchStrategy>;
  private defaultStrategy: SearchStrategy;
  private config: SearchServiceConfig;

  constructor(
    storageProvider: StorageProvider,
    vectorStore: VectorStore | null,
    embeddingService: EmbeddingService | null,
    config?: Partial<SearchServiceConfig>
  ) {
    this.config = {
      defaultStrategy: 'hybrid',
      hybridConfig: DEFAULT_HYBRID_CONFIG,
      enableMetadataFiltering: true,
      enableQueryAnalysis: true,
      ...config
    };

    this.strategies = new Map();

    // Always create graph strategy
    const graphStrategy = new GraphSearchStrategy(storageProvider);
    this.strategies.set('graph', graphStrategy);

    // Create vector strategy if available
    if (vectorStore && embeddingService) {
      const vectorStrategy = new VectorSearchStrategy(vectorStore, embeddingService);
      this.strategies.set('vector', vectorStrategy);

      // Create hybrid strategy
      const hybridStrategy = new HybridSearchStrategy(
        graphStrategy,
        vectorStrategy,
        this.config.hybridConfig
      );
      this.strategies.set('hybrid', hybridStrategy);
    } else {
      logger.warn('Vector store or embedding service not available. Vector and hybrid search disabled.');
    }

    // Set default strategy
    const defaultStrategyName = this.config.defaultStrategy;
    this.defaultStrategy = this.strategies.get(defaultStrategyName) || graphStrategy;

    if (!this.strategies.has(defaultStrategyName)) {
      logger.warn(`Default strategy '${defaultStrategyName}' not available, falling back to 'graph'`);
    }

    logger.info(`SearchService initialized with default strategy: ${this.defaultStrategy.getName()}`);
    logger.info(`Available strategies: ${Array.from(this.strategies.keys()).join(', ')}`);
  }

  /**
   * Execute search with default strategy
   */
  async search(query: string, options: SearchOptions = {}): Promise<ScoredEntity[]> {
    return this.searchWithStrategy(query, this.defaultStrategy.getName(), options);
  }

  /**
   * Execute search with specific strategy
   */
  async searchWithStrategy(
    query: string,
    strategyName: string,
    options: SearchOptions = {}
  ): Promise<ScoredEntity[]> {

    const strategy = this.strategies.get(strategyName);

    if (!strategy) {
      logger.warn(`Strategy '${strategyName}' not available, falling back to default (${this.defaultStrategy.getName()})`);
      return this.defaultStrategy.search(query, options);
    }

    const startTime = Date.now();

    try {
      // Apply metadata filtering if enabled
      const filteredOptions = this.config.enableMetadataFiltering
        ? this.applyMetadataFiltering(options)
        : options;

      // Execute search
      const results = await strategy.search(query, filteredOptions);

      const timeTaken = Date.now() - startTime;
      logger.info(`Search completed: strategy=${strategyName}, query="${query}", results=${results.length}, time=${timeTaken}ms`);

      return results;

    } catch (error) {
      logger.error(`Search failed: strategy=${strategyName}, query="${query}"`, error);
      throw error;
    }
  }

  /**
   * Get available search strategies
   */
  getAvailableStrategies(): string[] {
    return Array.from(this.strategies.keys());
  }

  /**
   * Check if a strategy is available
   */
  isStrategyAvailable(strategyName: string): boolean {
    return this.strategies.has(strategyName);
  }

  /**
   * Get default strategy name
   */
  getDefaultStrategy(): string {
    return this.defaultStrategy.getName();
  }

  /**
   * Update hybrid search configuration
   */
  updateHybridConfig(config: Partial<HybridSearchConfig>): void {
    if (!this.config.hybridConfig) {
      logger.warn('Hybrid config not initialized, creating new config');
      this.config.hybridConfig = { ...DEFAULT_HYBRID_CONFIG, ...config };
    } else {
      this.config.hybridConfig = {
        ...this.config.hybridConfig,
        ...config
      };
    }

    // Update the hybrid strategy if it exists
    const hybridStrategy = this.strategies.get('hybrid');
    if (hybridStrategy instanceof HybridSearchStrategy) {
      hybridStrategy.updateConfig(this.config.hybridConfig);
      logger.info('Hybrid search config updated', this.config.hybridConfig);
    } else {
      logger.warn('Hybrid strategy not available, config updated but not applied');
    }
  }

  /**
   * Get current hybrid configuration
   */
  getHybridConfig(): HybridSearchConfig | null {
    const hybridStrategy = this.strategies.get('hybrid');
    if (hybridStrategy instanceof HybridSearchStrategy) {
      return hybridStrategy.getConfig();
    }
    return this.config.hybridConfig || null;
  }

  /**
   * Apply metadata filtering to search options
   * Can be extended for domain-specific filtering
   */
  private applyMetadataFiltering(options: SearchOptions): SearchOptions {
    // Example: Filter by custom metadata properties
    // This can be extended based on specific use cases

    if (options.metadata) {
      // Apply any metadata-based transformations or validations
      logger.debug('Applying metadata filtering', options.metadata);
    }

    return options;
  }

  /**
   * Get search service statistics
   */
  getStatistics(): {
    defaultStrategy: string;
    availableStrategies: string[];
    hybridConfig: HybridSearchConfig | null;
    features: {
      metadataFiltering: boolean;
      queryAnalysis: boolean;
    };
  } {
    return {
      defaultStrategy: this.defaultStrategy.getName(),
      availableStrategies: this.getAvailableStrategies(),
      hybridConfig: this.getHybridConfig(),
      features: {
        metadataFiltering: this.config.enableMetadataFiltering || false,
        queryAnalysis: this.config.enableQueryAnalysis || false
      }
    };
  }
}
