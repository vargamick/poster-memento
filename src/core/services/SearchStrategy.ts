import type { Entity } from '../../KnowledgeGraphManager.js';
import type { StorageProvider, SearchOptions as StorageSearchOptions } from '../../storage/StorageProvider.js';
import type { VectorStore } from '../../types/vector-store.js';
import type { EmbeddingService } from '../../embeddings/EmbeddingService.js';
import { logger } from '../../utils/logger.js';

/**
 * Search result with scoring
 */
export interface ScoredEntity extends Entity {
  score: number;
  source: 'graph' | 'vector' | 'hybrid';
  metadata?: {
    vectorScore?: number;
    graphScore?: number;
    matchReason?: string;
    rrfScore?: number;
    mergeMethod?: string;
    [key: string]: any;  // Allow additional metadata
  };
}

/**
 * Search options for all strategies
 */
export interface SearchOptions {
  limit?: number;
  offset?: number;
  threshold?: number;
  entityTypes?: string[];
  expertiseArea?: string;
  metadata?: Record<string, any>;
}

/**
 * Search strategy interface
 */
export interface SearchStrategy {
  /**
   * Execute search with this strategy
   */
  search(query: string, options: SearchOptions): Promise<ScoredEntity[]>;

  /**
   * Get strategy name
   */
  getName(): string;
}

/**
 * Graph-only search strategy
 */
export class GraphSearchStrategy implements SearchStrategy {
  constructor(private storageProvider: StorageProvider) {}

  async search(query: string, options: SearchOptions): Promise<ScoredEntity[]> {
    const result = await this.storageProvider.searchNodes(query, {
      limit: options.limit,
      offset: options.offset,
      entityTypes: options.entityTypes
    } as StorageSearchOptions);

    // Convert to scored entities (graph search gets score 1.0)
    return result.entities.map((entity: Entity) => ({
      ...entity,
      score: 1.0,
      source: 'graph' as const,
      metadata: {
        graphScore: 1.0,
        matchReason: 'keyword_match'
      }
    }));
  }

  getName(): string {
    return 'graph';
  }
}

/**
 * Vector-only search strategy
 */
export class VectorSearchStrategy implements SearchStrategy {
  constructor(
    private vectorStore: VectorStore,
    private embeddingService: EmbeddingService
  ) {}

  async search(query: string, options: SearchOptions): Promise<ScoredEntity[]> {
    try {
      // Generate query embedding
      const queryEmbedding = await this.embeddingService.generateEmbedding(query);

      // Search vector store
      const results = await this.vectorStore.search(queryEmbedding, {
        limit: options.limit || 10,
        minSimilarity: options.threshold || 0.7
      });

      // Convert to scored entities
      const scoredEntities: ScoredEntity[] = [];

      for (const result of results) {
        // Get full entity from result metadata
        const entity: Entity = {
          name: (result.id as string) || result.metadata?.name || 'unknown',
          entityType: result.metadata?.entityType || 'unknown',
          observations: result.metadata?.observations || []
        };

        scoredEntities.push({
          ...entity,
          score: result.similarity,
          source: 'vector' as const,
          metadata: {
            vectorScore: result.similarity,
            matchReason: 'semantic_similarity'
          }
        });
      }

      return scoredEntities;
    } catch (error) {
      logger.error('Vector search failed', error);
      // Fallback to empty results
      return [];
    }
  }

  getName(): string {
    return 'vector';
  }
}

/**
 * Hybrid search configuration
 */
export interface HybridSearchConfig {
  graphWeight: number;    // 0.0 - 1.0
  vectorWeight: number;   // 0.0 - 1.0
  deduplication: boolean;
  rerankingEnabled: boolean;
  mergeMethod?: 'weighted' | 'rrf'; // weighted or reciprocal rank fusion
}

export const DEFAULT_HYBRID_CONFIG: HybridSearchConfig = {
  graphWeight: 0.4,
  vectorWeight: 0.6,
  deduplication: true,
  rerankingEnabled: false,
  mergeMethod: 'weighted'
};

/**
 * Hybrid search strategy (combines graph + vector)
 */
export class HybridSearchStrategy implements SearchStrategy {
  constructor(
    private graphStrategy: GraphSearchStrategy,
    private vectorStrategy: VectorSearchStrategy,
    private config: HybridSearchConfig = DEFAULT_HYBRID_CONFIG
  ) {}

  async search(query: string, options: SearchOptions): Promise<ScoredEntity[]> {
    // Execute both searches in parallel
    const [graphResults, vectorResults] = await Promise.all([
      this.graphStrategy.search(query, {
        ...options,
        limit: (options.limit || 10) * 2 // Get more candidates
      }).catch(err => {
        logger.warn('Graph search failed in hybrid search', err);
        return [];
      }),
      this.vectorStrategy.search(query, {
        ...options,
        limit: (options.limit || 10) * 2
      }).catch(err => {
        logger.warn('Vector search failed in hybrid search', err);
        return [];
      })
    ]);

    // Merge results based on configured method
    const mergedResults = this.config.mergeMethod === 'rrf'
      ? this.mergeWithRRF(graphResults, vectorResults)
      : this.mergeWeighted(graphResults, vectorResults);

    // Apply final limit
    return mergedResults.slice(0, options.limit || 10);
  }

  /**
   * Weighted merge strategy
   */
  private mergeWeighted(
    graphResults: ScoredEntity[],
    vectorResults: ScoredEntity[]
  ): ScoredEntity[] {
    const entityMap = new Map<string, ScoredEntity>();

    // Add graph results
    for (const entity of graphResults) {
      entityMap.set(entity.name, {
        ...entity,
        score: entity.score * this.config.graphWeight,
        source: 'graph',
        metadata: {
          ...entity.metadata,
          graphScore: entity.score
        }
      });
    }

    // Add/merge vector results
    for (const entity of vectorResults) {
      const existing = entityMap.get(entity.name);

      if (existing && this.config.deduplication) {
        // Entity found in both: combine scores
        entityMap.set(entity.name, {
          ...existing,
          score: existing.score + (entity.score * this.config.vectorWeight),
          source: 'hybrid',
          metadata: {
            graphScore: existing.metadata?.graphScore,
            vectorScore: entity.score,
            matchReason: 'graph_and_vector'
          }
        });
      } else {
        // New entity from vector search only
        entityMap.set(entity.name, {
          ...entity,
          score: entity.score * this.config.vectorWeight,
          source: 'vector',
          metadata: {
            ...entity.metadata,
            vectorScore: entity.score
          }
        });
      }
    }

    // Convert to array and sort by combined score
    const merged = Array.from(entityMap.values());
    merged.sort((a, b) => b.score - a.score);

    return merged;
  }

  /**
   * Reciprocal Rank Fusion (RRF) merging strategy
   */
  private mergeWithRRF(
    graphResults: ScoredEntity[],
    vectorResults: ScoredEntity[],
    k: number = 60 // RRF constant
  ): ScoredEntity[] {
    const entityScores = new Map<string, number>();
    const entityData = new Map<string, ScoredEntity>();

    // Calculate RRF scores for graph results
    graphResults.forEach((entity, rank) => {
      const rrfScore = 1 / (k + rank + 1);
      entityScores.set(entity.name, rrfScore);
      entityData.set(entity.name, entity);
    });

    // Add RRF scores for vector results
    vectorResults.forEach((entity, rank) => {
      const rrfScore = 1 / (k + rank + 1);
      const existing = entityScores.get(entity.name) || 0;
      entityScores.set(entity.name, existing + rrfScore);

      if (!entityData.has(entity.name)) {
        entityData.set(entity.name, entity);
      }
    });

    // Create scored entities with RRF scores
    const merged: ScoredEntity[] = [];
    entityScores.forEach((score, name) => {
      const entity = entityData.get(name)!;
      const inGraph = graphResults.some(e => e.name === name);
      const inVector = vectorResults.some(e => e.name === name);

      merged.push({
        ...entity,
        score,
        source: (inGraph && inVector) ? 'hybrid' : entity.source,
        metadata: {
          ...entity.metadata,
          rrfScore: score,
          mergeMethod: 'reciprocal_rank_fusion'
        }
      });
    });

    // Sort by RRF score
    merged.sort((a, b) => b.score - a.score);

    return merged;
  }

  getName(): string {
    return 'hybrid';
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<HybridSearchConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): HybridSearchConfig {
    return { ...this.config };
  }
}
