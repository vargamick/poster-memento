/**
 * Embedding Processing Service
 *
 * Handles embedding generation for entities in the knowledge graph.
 * Provides batch processing with rate limiting and progress tracking.
 *
 * This service replaces the script-based approach with direct API calls.
 */

import { logger } from '../../utils/logger.js';
import { processingJobManager } from './ProcessingJobManager.js';
import type {
  ProcessingJob,
  EmbeddingJobOptions,
  BatchResult,
  EntityResult,
  BatchStats
} from './types.js';
import type { EntityService } from '../../core/services/EntityService.js';
import type { IEmbeddingService } from '../../embeddings/EmbeddingService.js';
import type { StorageProvider } from '../../storage/StorageProvider.js';
import type { EntityEmbedding } from '../../types/entity-embedding.js';

/**
 * Configuration for embedding processing
 */
export interface EmbeddingProcessingConfig {
  defaultEntityTypes?: string[];
  batchSize?: number;
  delayBetweenBatches?: number;
  maxRetries?: number;
}

/**
 * Entity with embedding status
 */
export interface EntityWithEmbeddingStatus {
  entityId: string;
  entityType: string;
  hasEmbedding: boolean;
  lastUpdated?: string;
}

/**
 * Service for processing entity embeddings
 */
export class EmbeddingProcessingService {
  private config: EmbeddingProcessingConfig;

  constructor(
    private entityService: EntityService,
    private storageProvider: StorageProvider,
    private embeddingService: IEmbeddingService | null,
    config: Partial<EmbeddingProcessingConfig> = {}
  ) {
    this.config = {
      defaultEntityTypes: config.defaultEntityTypes || ['agar_product', 'document_chunk'],
      batchSize: config.batchSize || 10,
      delayBetweenBatches: config.delayBetweenBatches || 1000,
      maxRetries: config.maxRetries || 3
    };
  }

  /**
   * Initialize a new embedding processing job
   */
  async startJob(options?: EmbeddingJobOptions): Promise<ProcessingJob> {
    const job = processingJobManager.createJob('embeddings', {
      options,
      entityTypes: options?.entityTypes || this.config.defaultEntityTypes,
      batchSize: options?.batchSize || this.config.batchSize
    });

    processingJobManager.updateStatus(job.jobId, 'running');

    logger.info('Embedding processing job started', { jobId: job.jobId, options });

    return job;
  }

  /**
   * List entities that may need embeddings
   *
   * Note: This performs a search to find entities of specified types.
   * Actual embedding status check requires checking the vector store.
   */
  async listEntitiesForEmbedding(
    entityTypes?: string[],
    limit?: number
  ): Promise<EntityWithEmbeddingStatus[]> {
    const types = entityTypes || this.config.defaultEntityTypes || [];
    const entities: EntityWithEmbeddingStatus[] = [];

    for (const entityType of types) {
      try {
        // Search for entities of this type
        const results = await this.storageProvider.searchNodes('', {
          entityTypes: [entityType],
          limit: limit || 1000
        });

        for (const entity of results.entities) {
          entities.push({
            entityId: entity.name,
            entityType: entity.entityType,
            hasEmbedding: false // Would need to check vector store
          });
        }
      } catch (error) {
        logger.warn(`Failed to list entities of type ${entityType}`, { error });
      }
    }

    return entities;
  }

  /**
   * Process a batch of entities for embedding generation
   */
  async processBatch(
    jobId: string,
    entityIds: string[]
  ): Promise<BatchResult> {
    const job = processingJobManager.getJob(jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    if (processingJobManager.isCancelled(jobId)) {
      throw new Error(`Job cancelled: ${jobId}`);
    }

    if (!this.embeddingService) {
      throw new Error('Embedding service not configured');
    }

    const results: EntityResult[] = [];
    const stats: BatchStats = {
      entitiesCreated: 0,
      entitiesUpdated: 0,
      entitiesSkipped: 0,
      relationsCreated: 0,
      relationsSkipped: 0,
      embeddingsGenerated: 0
    };

    for (const entityId of entityIds) {
      if (processingJobManager.isCancelled(jobId)) {
        break;
      }

      try {
        const result = await this.generateEntityEmbedding(entityId);
        results.push(result);

        if (result.status === 'updated') {
          stats.entitiesUpdated++;
          stats.embeddingsGenerated = (stats.embeddingsGenerated || 0) + 1;
        } else if (result.status === 'skipped') {
          stats.entitiesSkipped++;
        }

        processingJobManager.incrementProcessed(jobId);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        results.push({
          entityId,
          entityType: 'unknown',
          status: 'failed',
          error: errorMessage
        });
        processingJobManager.incrementFailed(jobId);
        logger.error('Failed to generate embedding', { entityId, error: errorMessage });
      }

      // Add delay between items to respect rate limits
      if (this.config.delayBetweenBatches && this.config.delayBetweenBatches > 0) {
        await this.delay(this.config.delayBetweenBatches / 10); // Smaller delay per item
      }
    }

    return {
      success: results.filter(r => r.status === 'failed').length === 0,
      processed: results.filter(r => r.status !== 'failed').length,
      failed: results.filter(r => r.status === 'failed').length,
      results,
      stats
    };
  }

  /**
   * Generate embedding for a single entity
   */
  private async generateEntityEmbedding(entityId: string): Promise<EntityResult> {
    if (!this.embeddingService) {
      return {
        entityId,
        entityType: 'unknown',
        status: 'skipped',
        error: 'Embedding service not configured'
      };
    }

    // Get entity
    const entityResult = await this.entityService.getEntity(entityId);
    if (!entityResult.success || !entityResult.data) {
      return {
        entityId,
        entityType: 'unknown',
        status: 'failed',
        error: `Entity not found: ${entityId}`
      };
    }

    const entity = entityResult.data;

    // Prepare text for embedding
    const text = this.prepareEntityText(entity);
    if (!text || text.trim().length === 0) {
      return {
        entityId,
        entityType: entity.entityType,
        status: 'skipped',
        error: 'No content to embed'
      };
    }

    // Generate embedding
    const embedding = await this.embeddingService.generateEmbedding(text);
    const modelInfo = this.embeddingService.getModelInfo();

    // Store embedding
    if (typeof (this.storageProvider as any).storeEntityVector === 'function') {
      const entityEmbedding: EntityEmbedding = {
        vector: embedding,
        model: modelInfo.name,
        lastUpdated: Date.now()
      };

      await (this.storageProvider as any).storeEntityVector(entityId, entityEmbedding);
    } else if (typeof this.storageProvider.updateEntityEmbedding === 'function') {
      const entityEmbedding: EntityEmbedding = {
        vector: embedding,
        model: modelInfo.name,
        lastUpdated: Date.now()
      };

      await this.storageProvider.updateEntityEmbedding(entityId, entityEmbedding);
    } else {
      logger.warn('Storage provider does not support embedding storage', { entityId });
      return {
        entityId,
        entityType: entity.entityType,
        status: 'skipped',
        error: 'Storage provider does not support embeddings'
      };
    }

    logger.debug('Generated embedding for entity', {
      entityId,
      entityType: entity.entityType,
      dimensions: embedding.length,
      model: modelInfo.name
    });

    return {
      entityId,
      entityType: entity.entityType,
      status: 'updated'
    };
  }

  /**
   * Prepare text for embedding from an entity
   */
  private prepareEntityText(entity: { name: string; entityType: string; observations?: string[] }): string {
    const lines = [
      `Name: ${entity.name}`,
      `Type: ${entity.entityType}`,
      'Observations:'
    ];

    if (entity.observations && Array.isArray(entity.observations)) {
      // Filter out observations that are just metadata or very short
      const meaningfulObservations = entity.observations.filter(obs => {
        // Skip empty or very short observations
        if (!obs || obs.length < 5) return false;
        // Include observations that have actual content
        return true;
      });

      if (meaningfulObservations.length > 0) {
        lines.push(...meaningfulObservations.map(obs => `- ${obs}`));
      } else {
        lines.push('  (No meaningful observations)');
      }
    } else {
      lines.push('  (No observations)');
    }

    return lines.join('\n');
  }

  /**
   * Process all entities of specified types
   */
  async processAllEntities(
    jobId: string,
    entityTypes?: string[],
    batchSize?: number
  ): Promise<BatchStats> {
    const job = processingJobManager.getJob(jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    const types = entityTypes || this.config.defaultEntityTypes || [];
    const size = batchSize || this.config.batchSize || 10;

    const totalStats: BatchStats = {
      entitiesCreated: 0,
      entitiesUpdated: 0,
      entitiesSkipped: 0,
      relationsCreated: 0,
      relationsSkipped: 0,
      embeddingsGenerated: 0
    };

    // Get all entities to process
    const entities = await this.listEntitiesForEmbedding(types);
    processingJobManager.setTotal(jobId, entities.length);

    logger.info(`Processing embeddings for ${entities.length} entities`, {
      jobId,
      entityTypes: types,
      batchSize: size
    });

    // Process in batches
    const entityIds = entities.map(e => e.entityId);

    for (let i = 0; i < entityIds.length; i += size) {
      if (processingJobManager.isCancelled(jobId)) {
        logger.info('Embedding job cancelled', { jobId, processedSoFar: i });
        break;
      }

      const batch = entityIds.slice(i, i + size);
      const batchNum = Math.floor(i / size) + 1;
      const totalBatches = Math.ceil(entityIds.length / size);

      logger.info(`Processing batch ${batchNum}/${totalBatches}`, {
        jobId,
        batchSize: batch.length
      });

      const batchResult = await this.processBatch(jobId, batch);

      // Aggregate stats
      if (batchResult.stats) {
        totalStats.entitiesUpdated += batchResult.stats.entitiesUpdated;
        totalStats.entitiesSkipped += batchResult.stats.entitiesSkipped;
        totalStats.embeddingsGenerated = (totalStats.embeddingsGenerated || 0) +
          (batchResult.stats.embeddingsGenerated || 0);
      }

      // Delay between batches
      if (this.config.delayBetweenBatches && i + size < entityIds.length) {
        await this.delay(this.config.delayBetweenBatches);
      }
    }

    return totalStats;
  }

  /**
   * Complete a job
   */
  completeJob(jobId: string, stats?: BatchStats): void {
    processingJobManager.completeJob(jobId, stats);
  }

  /**
   * Fail a job
   */
  failJob(jobId: string, error: string): void {
    processingJobManager.failJob(jobId, error);
  }

  /**
   * Get job status
   */
  getJobStatus(jobId: string): ProcessingJob | null {
    return processingJobManager.getJob(jobId);
  }

  /**
   * Check if embedding service is available
   */
  isEmbeddingServiceAvailable(): boolean {
    return this.embeddingService !== null;
  }

  /**
   * Get embedding service info
   */
  getEmbeddingServiceInfo(): { provider: string; model: string; dimensions: number } | null {
    if (!this.embeddingService) {
      return null;
    }

    const providerInfo = this.embeddingService.getProviderInfo();
    return {
      provider: providerInfo.provider,
      model: providerInfo.model,
      dimensions: providerInfo.dimensions
    };
  }

  /**
   * Helper to add delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default EmbeddingProcessingService;
