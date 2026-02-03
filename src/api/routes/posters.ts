/**
 * Poster Processing Routes
 *
 * REST endpoints for scanning, previewing, and processing poster images.
 * Provides direct REST API access to poster processing functionality.
 */

import { Router } from 'express';
import { asyncHandler, ValidationError, NotFoundError } from '../middleware/errorHandler.js';
import { handleScanPosters, ScanPostersArgs } from '../../server/handlers/toolHandlers/scanPosters.js';
import {
  handleProcessPosterBatch,
  getProcessingStats,
  resetProcessingState,
  ProcessPosterBatchArgs
} from '../../server/handlers/toolHandlers/processPosterBatch.js';
import { createPosterProcessor, PosterProcessor } from '../../image-processor/PosterProcessor.js';
import { VisionModelFactory } from '../../image-processor/VisionModelFactory.js';
import { KnowledgeGraphManager } from '../../KnowledgeGraphManager.js';
import { logger } from '../../utils/logger.js';

// Cache processor instance
let processorInstance: PosterProcessor | null = null;

async function getProcessor(): Promise<PosterProcessor> {
  if (!processorInstance) {
    processorInstance = await createPosterProcessor();
  }
  return processorInstance;
}

/**
 * Create poster processing routes
 */
export function createPosterRoutes(knowledgeGraphManager: KnowledgeGraphManager): Router {
  const router = Router();

  /**
   * GET /posters/scan - Scan source directory for images
   *
   * @query sourcePath - Path to scan (default: SOURCE_IMAGES_PATH env or ./SourceImages)
   * @query extensions - Comma-separated list of extensions (default: jpg,jpeg,png,gif,webp)
   * @query recursive - Whether to scan recursively (default: true)
   * @query offset - Pagination offset (default: 0)
   * @query limit - Number of results to return (default: 100)
   */
  router.get('/scan', asyncHandler(async (req, res) => {
    const args: ScanPostersArgs = {
      sourcePath: req.query.sourcePath as string | undefined,
      recursive: req.query.recursive !== 'false',
      offset: parseInt(req.query.offset as string) || 0,
      limit: parseInt(req.query.limit as string) || 100
    };

    // Parse extensions if provided
    if (req.query.extensions) {
      const extStr = req.query.extensions as string;
      args.extensions = extStr.split(',').map(e => e.trim().startsWith('.') ? e.trim() : `.${e.trim()}`);
    }

    const result = await handleScanPosters(args);

    if (!result.success) {
      throw new NotFoundError(result.error || 'Failed to scan source directory');
    }

    res.json({ data: result });
  }));

  /**
   * GET /posters/models - List available vision models
   */
  router.get('/models', asyncHandler(async (_req, res) => {
    const modelKeys = VisionModelFactory.listAvailableModels();
    const defaultKey = VisionModelFactory.getDefaultModelKey();

    const models = modelKeys.map(key => {
      const config = VisionModelFactory.getModelConfig(key);
      return {
        key,
        provider: config?.provider || 'unknown',
        model: config?.model || key,
        description: config?.description || '',
        parameters: config?.parameters || ''
      };
    });

    res.json({
      data: {
        default: defaultKey,
        current: process.env.VISION_MODEL || defaultKey,
        models
      }
    });
  }));

  /**
   * POST /posters/preview - Preview single image extraction (no DB storage)
   *
   * @body imagePath - Path to the image file
   * @body modelKey - Optional vision model to use
   */
  router.post('/preview', asyncHandler(async (req, res) => {
    const { imagePath, modelKey } = req.body;

    if (!imagePath || typeof imagePath !== 'string') {
      throw new ValidationError('imagePath is required');
    }

    logger.info('Previewing poster extraction', { imagePath, modelKey });

    const processor = await getProcessor();

    // Process with skipStorage to avoid DB writes
    const result = await processor.processImage(imagePath, {
      skipStorage: true,
      modelKey: modelKey || undefined
    });

    const modelInfo = processor.getVisionModelInfo();

    res.json({
      data: {
        success: result.success,
        entity: result.entity || null,
        error: result.error || null,
        processingTimeMs: result.processingTimeMs,
        modelUsed: modelKey || modelInfo.name
      }
    });
  }));

  /**
   * POST /posters/commit - Commit a previewed entity to the database
   *
   * @body entity - The PosterEntity to commit (from preview result)
   */
  router.post('/commit', asyncHandler(async (req, res) => {
    const { entity, storeImage } = req.body;

    if (!entity || !entity.name || !entity.entityType) {
      throw new ValidationError('Valid entity object with name and entityType is required');
    }

    logger.info('Committing poster entity', { name: entity.name });

    try {
      // Create the main poster entity
      await knowledgeGraphManager.createEntities([{
        name: entity.name,
        entityType: entity.entityType,
        observations: entity.observations || [`Created from image: ${entity.metadata?.original_filename || 'unknown'}`]
      }]);

      // Add additional observations
      const additionalObservations: string[] = [];

      if (entity.poster_type) additionalObservations.push(`Poster type: ${entity.poster_type}`);
      if (entity.title) additionalObservations.push(`Title: ${entity.title}`);
      if (entity.headliner) additionalObservations.push(`Headliner: ${entity.headliner}`);
      if (entity.supporting_acts?.length) {
        additionalObservations.push(`Supporting acts: ${entity.supporting_acts.join(', ')}`);
      }
      if (entity.venue_name) additionalObservations.push(`Venue: ${entity.venue_name}`);
      if (entity.city) additionalObservations.push(`City: ${entity.city}`);
      if (entity.state) additionalObservations.push(`State: ${entity.state}`);
      if (entity.event_date) additionalObservations.push(`Event date: ${entity.event_date}`);
      if (entity.year) additionalObservations.push(`Year: ${entity.year}`);
      if (entity.decade) additionalObservations.push(`Decade: ${entity.decade}`);
      if (entity.ticket_price) additionalObservations.push(`Ticket price: ${entity.ticket_price}`);
      if (entity.visual_elements?.style) additionalObservations.push(`Visual style: ${entity.visual_elements.style}`);

      if (additionalObservations.length > 0) {
        await knowledgeGraphManager.addObservations([{
          entityName: entity.name,
          contents: additionalObservations
        }]);
      }

      // Create relations
      const relations: Array<{ from: string; to: string; relationType: string }> = [];

      // Create headliner relation
      if (entity.headliner) {
        const headlinerName = `artist_${entity.headliner.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
        try {
          await knowledgeGraphManager.createEntities([{
            name: headlinerName,
            entityType: 'Artist',
            observations: [`Artist name: ${entity.headliner}`]
          }]);
        } catch (e) { /* Entity might already exist */ }
        relations.push({ from: entity.name, to: headlinerName, relationType: 'HEADLINED_ON' });
      }

      // Create supporting act relations
      if (entity.supporting_acts?.length) {
        for (const act of entity.supporting_acts) {
          const actName = `artist_${act.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
          try {
            await knowledgeGraphManager.createEntities([{
              name: actName,
              entityType: 'Artist',
              observations: [`Artist name: ${act}`]
            }]);
          } catch (e) { /* Entity might already exist */ }
          relations.push({ from: entity.name, to: actName, relationType: 'PERFORMED_ON' });
        }
      }

      // Create venue relation
      if (entity.venue_name) {
        const venueName = `venue_${entity.venue_name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
        try {
          await knowledgeGraphManager.createEntities([{
            name: venueName,
            entityType: 'Venue',
            observations: [
              `Venue name: ${entity.venue_name}`,
              entity.city ? `City: ${entity.city}` : '',
              entity.state ? `State: ${entity.state}` : ''
            ].filter(Boolean)
          }]);
        } catch (e) { /* Entity might already exist */ }
        relations.push({ from: entity.name, to: venueName, relationType: 'ADVERTISES_VENUE' });
      }

      if (relations.length > 0) {
        await knowledgeGraphManager.createRelations(relations);
      }

      // Optionally store the image
      if (storeImage && entity.metadata?.source_image_url) {
        // Image storage is handled by the processor during full processing
        // For commit, we assume the image path is in the entity metadata
        logger.info('Image storage requested but skipped in commit (use process endpoint for full processing)');
      }

      res.json({
        data: {
          success: true,
          entityName: entity.name,
          relationsCreated: relations.length
        }
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to commit entity:', error);
      throw new ValidationError(`Failed to commit entity: ${errorMessage}`);
    }
  }));

  /**
   * POST /posters/process - Process a batch of images
   *
   * @body filePaths - Optional array of specific file paths to process
   * @body sourcePath - Optional source directory to scan
   * @body batchSize - Number of images per batch (default: 10)
   * @body offset - Pagination offset when using sourcePath (default: 0)
   * @body skipIfExists - Skip already processed images (default: true)
   * @body modelKey - Vision model to use
   * @body storeImages - Whether to store images in MinIO (default: true)
   */
  router.post('/process', asyncHandler(async (req, res) => {
    const args: ProcessPosterBatchArgs = {
      filePaths: req.body.filePaths,
      sourcePath: req.body.sourcePath,
      batchSize: req.body.batchSize || 10,
      offset: req.body.offset || 0,
      skipIfExists: req.body.skipIfExists !== false,
      modelKey: req.body.modelKey,
      storeImages: req.body.storeImages !== false
    };

    logger.info('Processing poster batch via API', {
      batchSize: args.batchSize,
      offset: args.offset,
      fileCount: args.filePaths?.length || 'scanning'
    });

    const result = await handleProcessPosterBatch(args, knowledgeGraphManager);

    res.json({ data: result });
  }));

  /**
   * GET /posters/process/status - Get processing status
   *
   * @query sourcePath - Optional source path to get status for
   */
  router.get('/process/status', asyncHandler(async (req, res) => {
    const sourcePath = req.query.sourcePath as string | undefined;
    const stats = getProcessingStats(sourcePath);

    if (!stats) {
      res.json({
        data: {
          sourcePath: sourcePath || process.env.SOURCE_IMAGES_PATH || './SourceImages',
          totalFiles: 0,
          processedCount: 0,
          remainingCount: 0,
          percentComplete: 0,
          startedAt: null,
          message: 'No processing session found. Start processing to see status.'
        }
      });
      return;
    }

    res.json({
      data: {
        ...stats,
        startedAt: stats.startedAt?.toISOString() || null
      }
    });
  }));

  /**
   * POST /posters/process/reset - Reset processing state
   *
   * @body sourcePath - Optional source path to reset
   */
  router.post('/process/reset', asyncHandler(async (req, res) => {
    const sourcePath = req.body.sourcePath as string | undefined;
    resetProcessingState(sourcePath);

    res.json({
      data: {
        success: true,
        message: 'Processing state reset successfully'
      }
    });
  }));

  /**
   * GET /posters/health - Check poster processing health
   */
  router.get('/health', asyncHandler(async (_req, res) => {
    try {
      const processor = await getProcessor();
      const health = await processor.healthCheck();

      res.json({
        data: {
          healthy: health.vision && health.storage,
          vision: health.vision,
          storage: health.storage,
          service: 'poster-processor'
        }
      });
    } catch (error) {
      res.json({
        data: {
          healthy: false,
          vision: false,
          storage: false,
          service: 'poster-processor',
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      });
    }
  }));

  return router;
}
