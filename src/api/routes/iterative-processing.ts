/**
 * Iterative Processing API Routes
 *
 * REST endpoints for the iterative poster processing pipeline.
 * These endpoints support multi-phase processing with validation
 * and manual override capabilities.
 */

import { Router } from 'express';
import { asyncHandler, ValidationError, NotFoundError } from '../middleware/errorHandler.js';
import {
  IterativeProcessor,
  IterativeProcessingOptions,
  IterativeBatchRequest,
  PhaseOverride,
  PhaseRetryRequest,
  IterativeJobStatus,
} from '../../image-processor/iterative/index.js';
import { EntityService } from '../../core/services/EntityService.js';
import { RelationService } from '../../core/services/RelationService.js';
import { SearchService } from '../../core/services/SearchService.js';

/**
 * Store for active jobs (in production, use Redis or database)
 */
const activeJobs: Map<string, {
  status: IterativeJobStatus;
  processor: IterativeProcessor;
}> = new Map();

/**
 * Create iterative processing routes
 *
 * @param entityService - Entity service for knowledge base operations
 * @param relationService - Relation service for relationship operations
 * @param searchServiceOrGetter - SearchService or getter function (for async initialization)
 * @param discogsToken - Optional Discogs API token for artist validation
 */
export function createIterativeProcessingRoutes(
  entityService?: EntityService,
  relationService?: RelationService,
  searchServiceOrGetter?: SearchService | (() => SearchService | undefined),
  discogsToken?: string
): Router {
  const router = Router();

  // Helper to get search service (supports both direct instance and getter function)
  const getSearchService = (): SearchService | undefined => {
    if (typeof searchServiceOrGetter === 'function') {
      return searchServiceOrGetter();
    }
    return searchServiceOrGetter;
  };

  // Factory function to create processor with dependencies
  const createProcessor = () => new IterativeProcessor(undefined, {
    entityService,
    relationService,
    searchService: getSearchService(),
    discogsToken,
  });

  // ============================================
  // Single Image Processing
  // ============================================

  /**
   * POST /iterative/process - Process a single image iteratively
   *
   * Body:
   * - imagePath: Path to the image file
   * - options: Optional processing options
   */
  router.post('/process', asyncHandler(async (req, res) => {
    const { imagePath, options } = req.body as {
      imagePath: string;
      options?: Partial<IterativeProcessingOptions>;
    };

    if (!imagePath) {
      throw new ValidationError('imagePath is required');
    }

    const processor = createProcessor();
    const result = await processor.processImage(imagePath, options);

    res.json({
      data: result,
      message: result.success
        ? 'Processing completed successfully'
        : `Processing failed: ${result.error}`,
    });
  }));

  // ============================================
  // Batch Processing
  // ============================================

  /**
   * POST /iterative/batch/start - Start a batch processing job
   *
   * Body:
   * - imagePaths: Array of image file paths
   * - options: Optional processing options
   */
  router.post('/batch/start', asyncHandler(async (req, res) => {
    const { imagePaths, options } = req.body as IterativeBatchRequest;

    if (!imagePaths || !Array.isArray(imagePaths) || imagePaths.length === 0) {
      throw new ValidationError('imagePaths array is required and must not be empty');
    }

    const processor = createProcessor();
    const jobId = `iter_batch_${Date.now().toString(36)}`;

    // Initialize job status
    const jobStatus: IterativeJobStatus = {
      jobId,
      status: 'running',
      currentPhase: 'type',
      progress: {
        totalImages: imagePaths.length,
        processedImages: 0,
        currentImageIndex: 0,
      },
      phaseProgress: {
        type: { completed: 0, total: imagePaths.length },
        artist: { completed: 0, total: imagePaths.length },
        venue: { completed: 0, total: imagePaths.length },
        event: { completed: 0, total: imagePaths.length },
        assembly: { completed: 0, total: imagePaths.length },
      },
      stats: {
        successCount: 0,
        failureCount: 0,
        lowConfidenceCount: 0,
        needsReviewCount: 0,
        averageConfidence: 0,
      },
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    activeJobs.set(jobId, { status: jobStatus, processor });

    // Start processing in background
    processor.processBatch(
      imagePaths,
      options,
      (completed, total, current) => {
        const job = activeJobs.get(jobId);
        if (job) {
          job.status.progress.processedImages = completed;
          job.status.progress.currentImageIndex = completed;
          job.status.progress.currentImagePath = current;
          job.status.updatedAt = new Date().toISOString();
        }
      }
    ).then(result => {
      const job = activeJobs.get(jobId);
      if (job) {
        job.status.status = 'completed';
        job.status.completedAt = new Date().toISOString();
        job.status.stats = {
          successCount: result.summary.successful,
          failureCount: result.summary.failed,
          lowConfidenceCount: 0,
          needsReviewCount: result.summary.needsReview,
          averageConfidence: result.summary.averageConfidence,
        };
      }
    }).catch(error => {
      const job = activeJobs.get(jobId);
      if (job) {
        job.status.status = 'failed';
        job.status.error = error instanceof Error ? error.message : String(error);
        job.status.completedAt = new Date().toISOString();
      }
    });

    res.status(202).json({
      data: {
        jobId,
        status: 'running',
        totalImages: imagePaths.length,
        message: 'Batch processing started',
      },
    });
  }));

  /**
   * GET /iterative/batch/:jobId - Get batch job status
   */
  router.get('/batch/:jobId', asyncHandler(async (req, res) => {
    const { jobId } = req.params;
    const job = activeJobs.get(jobId);

    if (!job) {
      throw new NotFoundError(`Job not found: ${jobId}`);
    }

    res.json({
      data: job.status,
    });
  }));

  /**
   * DELETE /iterative/batch/:jobId - Cancel a batch job
   */
  router.delete('/batch/:jobId', asyncHandler(async (req, res) => {
    const { jobId } = req.params;
    const job = activeJobs.get(jobId);

    if (!job) {
      throw new NotFoundError(`Job not found: ${jobId}`);
    }

    if (job.status.status !== 'running') {
      throw new ValidationError(`Cannot cancel job in ${job.status.status} state`);
    }

    job.status.status = 'cancelled';
    job.status.completedAt = new Date().toISOString();

    res.json({
      data: {
        jobId,
        cancelled: true,
      },
      message: 'Job cancellation requested',
    });
  }));

  /**
   * GET /iterative/batch/:jobId/results - Get batch job results
   */
  router.get('/batch/:jobId/results', asyncHandler(async (req, res) => {
    const { jobId } = req.params;
    const { offset = '0', limit = '50' } = req.query;

    const job = activeJobs.get(jobId);

    if (!job) {
      throw new NotFoundError(`Job not found: ${jobId}`);
    }

    // Note: In production, results would be stored separately
    // For now, return status info
    res.json({
      data: {
        jobId,
        status: job.status.status,
        stats: job.status.stats,
        phaseProgress: job.status.phaseProgress,
      },
    });
  }));

  // ============================================
  // Phase-Level Operations
  // ============================================

  /**
   * GET /iterative/phase/:posterId/:phase - Get phase result for a poster
   */
  router.get('/phase/:posterId/:phase', asyncHandler(async (req, res) => {
    const { posterId, phase } = req.params;

    // In production, retrieve from database
    // For now, return not found
    throw new NotFoundError(`Phase result not found: ${posterId}/${phase}`);
  }));

  /**
   * POST /iterative/phase/:posterId/:phase/retry - Retry a specific phase
   *
   * Body:
   * - adjustedPrompt: Optional adjusted prompt for retry
   * - adjustedOptions: Optional adjusted processing options
   */
  router.post('/phase/:posterId/:phase/retry', asyncHandler(async (req, res) => {
    const { posterId, phase } = req.params;
    const { adjustedPrompt, adjustedOptions } = req.body as PhaseRetryRequest;

    // Validate phase name
    const validPhases = ['type', 'artist', 'venue', 'event', 'assembly'];
    if (!validPhases.includes(phase)) {
      throw new ValidationError(`Invalid phase: ${phase}. Must be one of: ${validPhases.join(', ')}`);
    }

    // In production, retrieve context and retry specific phase
    throw new ValidationError('Phase retry not yet implemented - requires session persistence');
  }));

  /**
   * POST /iterative/override - Override a field value and continue processing
   *
   * Body:
   * - posterId: Poster entity ID
   * - phase: Phase name
   * - field: Field to override
   * - value: New value
   * - continueProcessing: Whether to continue to next phase
   */
  router.post('/override', asyncHandler(async (req, res) => {
    const override = req.body as PhaseOverride;

    if (!override.posterId) {
      throw new ValidationError('posterId is required');
    }
    if (!override.phase) {
      throw new ValidationError('phase is required');
    }
    if (!override.field) {
      throw new ValidationError('field is required');
    }
    if (override.value === undefined) {
      throw new ValidationError('value is required');
    }

    // Apply override to entity
    if (entityService) {
      const result = await entityService.updateEntity(override.posterId, {
        [override.field]: override.value,
      });

      if (!result.success) {
        throw new ValidationError(`Failed to apply override: ${result.errors?.join(', ')}`);
      }
    }

    res.json({
      data: {
        posterId: override.posterId,
        phase: override.phase,
        field: override.field,
        applied: true,
      },
      message: 'Override applied successfully',
    });
  }));

  // ============================================
  // Health and Info
  // ============================================

  /**
   * GET /iterative/health - Check health of iterative processing services
   */
  router.get('/health', asyncHandler(async (req, res) => {
    const processor = createProcessor();
    const health = await processor.healthCheck();

    res.json({
      data: {
        healthy: health.vision,
        services: {
          vision: health.vision,
          ...health.validators,
        },
      },
    });
  }));

  /**
   * GET /iterative/info - Get iterative processing configuration info
   */
  router.get('/info', asyncHandler(async (req, res) => {
    const processor = createProcessor();
    const visionInfo = processor.getVisionModelInfo();

    res.json({
      data: {
        visionModel: visionInfo,
        phases: ['type', 'artist', 'venue', 'event', 'assembly'],
        supportedPosterTypes: [
          'concert', 'festival', 'comedy', 'theater', 'film',
          'album', 'promo', 'exhibition', 'hybrid', 'unknown',
        ],
        validationSources: ['musicbrainz', 'discogs', 'internal'],
      },
    });
  }));

  /**
   * GET /iterative/jobs - List all active iterative jobs
   */
  router.get('/jobs', asyncHandler(async (req, res) => {
    const { status, limit = '50' } = req.query;

    let jobs = Array.from(activeJobs.values()).map(j => j.status);

    if (status && typeof status === 'string') {
      jobs = jobs.filter(j => j.status === status);
    }

    const maxResults = parseInt(limit as string);
    jobs = jobs.slice(0, maxResults);

    res.json({
      data: jobs,
      count: jobs.length,
    });
  }));

  // ============================================
  // Type Classification Endpoints
  // ============================================

  /**
   * POST /iterative/type/classify - Classify a single image type only
   *
   * Body:
   * - imagePath: Path to the image file
   */
  router.post('/type/classify', asyncHandler(async (req, res) => {
    const { imagePath } = req.body;

    if (!imagePath) {
      throw new ValidationError('imagePath is required');
    }

    const processor = createProcessor();
    const result = await processor.processImage(imagePath, {
      validateArtists: false,
      validateVenues: false,
      validateEvents: false,
    });

    if (!result.phases.type) {
      throw new ValidationError('Type classification failed');
    }

    res.json({
      data: {
        posterId: result.posterId,
        imagePath: result.imagePath,
        type: result.phases.type.primaryType,
        secondaryTypes: result.phases.type.secondaryTypes,
        visualCues: result.phases.type.visualCues,
        confidence: result.phases.type.confidence,
      },
    });
  }));

  /**
   * POST /iterative/type/batch - Classify types for multiple images
   *
   * Body:
   * - imagePaths: Array of image file paths
   */
  router.post('/type/batch', asyncHandler(async (req, res) => {
    const { imagePaths } = req.body;

    if (!imagePaths || !Array.isArray(imagePaths) || imagePaths.length === 0) {
      throw new ValidationError('imagePaths array is required');
    }

    const processor = createProcessor();
    const results = await processor.processBatch(imagePaths, {
      validateArtists: false,
      validateVenues: false,
      validateEvents: false,
    });

    const typeResults = results.results.map(r => ({
      posterId: r.posterId,
      imagePath: r.imagePath,
      type: r.phases.type?.primaryType,
      confidence: r.phases.type?.confidence ?? 0,
      success: r.success,
    }));

    res.json({
      data: {
        results: typeResults,
        summary: results.summary,
      },
    });
  }));

  return router;
}
