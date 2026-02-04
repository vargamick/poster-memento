/**
 * QA Validation API Routes
 *
 * REST API endpoints for the QA validation system.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { QAValidationService } from '../../qa-validation/QAValidationService.js';
import { QAValidationConfig } from '../../qa-validation/types.js';

/**
 * Custom error classes
 */
class ValidationError extends Error {
  statusCode = 400;
  code = 'VALIDATION_ERROR';
  constructor(message: string, public details?: unknown) {
    super(message);
    this.name = 'ValidationError';
  }
}

class NotFoundError extends Error {
  statusCode = 404;
  code = 'NOT_FOUND';
  constructor(message: string = 'Not Found') {
    super(message);
    this.name = 'NotFoundError';
  }
}

/**
 * Async handler wrapper for error handling
 */
function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Create QA validation routes
 */
export function createQAValidationRoutes(
  qaService: QAValidationService
): Router {
  const router = Router();

  /**
   * POST /start
   * Start a new validation job
   */
  router.post(
    '/start',
    asyncHandler(async (req: Request, res: Response) => {
      const config: QAValidationConfig = req.body || {};

      // Validate config
      if (config.entityTypes && !Array.isArray(config.entityTypes)) {
        throw new ValidationError('entityTypes must be an array');
      }

      if (config.posterTypes && !Array.isArray(config.posterTypes)) {
        throw new ValidationError('posterTypes must be an array');
      }

      if (config.validators && !Array.isArray(config.validators)) {
        throw new ValidationError('validators must be an array');
      }

      if (
        config.minConfidenceThreshold !== undefined &&
        (config.minConfidenceThreshold < 0 || config.minConfidenceThreshold > 1)
      ) {
        throw new ValidationError('minConfidenceThreshold must be between 0 and 1');
      }

      if (config.batchSize !== undefined && config.batchSize < 1) {
        throw new ValidationError('batchSize must be at least 1');
      }

      const jobId = await qaService.startValidationJob(config);

      res.status(202).json({
        data: {
          jobId,
          status: 'pending',
          message: 'Validation job started',
        },
      });
    })
  );

  /**
   * GET /jobs
   * List all validation jobs
   */
  router.get(
    '/jobs',
    asyncHandler(async (_req: Request, res: Response) => {
      const jobs = qaService.getAllJobs();

      res.json({
        data: jobs,
        count: jobs.length,
      });
    })
  );

  /**
   * GET /jobs/:id
   * Get status of a specific job
   */
  router.get(
    '/jobs/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const jobId = req.params.id;
      const job = qaService.getJobStatus(jobId);

      if (!job) {
        throw new NotFoundError(`Job not found: ${jobId}`);
      }

      res.json({
        data: job,
      });
    })
  );

  /**
   * DELETE /jobs/:id
   * Cancel a running job
   */
  router.delete(
    '/jobs/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const jobId = req.params.id;
      const cancelled = await qaService.cancelJob(jobId);

      if (!cancelled) {
        throw new NotFoundError(`Job not found or not running: ${jobId}`);
      }

      res.json({
        data: {
          jobId,
          cancelled: true,
          message: 'Job cancelled successfully',
        },
      });
    })
  );

  /**
   * GET /reports/:jobId
   * Get the validation report for a completed job
   */
  router.get(
    '/reports/:jobId',
    asyncHandler(async (req: Request, res: Response) => {
      const jobId = req.params.jobId;
      const report = qaService.getReport(jobId);

      if (!report) {
        // Check if job exists
        const job = qaService.getJobStatus(jobId);
        if (!job) {
          throw new NotFoundError(`Job not found: ${jobId}`);
        }

        if (job.phase !== 'completed') {
          throw new ValidationError(
            `Report not available. Job is in phase: ${job.phase}`
          );
        }

        throw new NotFoundError(`Report not found for job: ${jobId}`);
      }

      res.json({
        data: report,
      });
    })
  );

  /**
   * GET /reports/:jobId/summary
   * Get just the summary of a validation report
   */
  router.get(
    '/reports/:jobId/summary',
    asyncHandler(async (req: Request, res: Response) => {
      const jobId = req.params.jobId;
      const report = qaService.getReport(jobId);

      if (!report) {
        throw new NotFoundError(`Report not found for job: ${jobId}`);
      }

      res.json({
        data: {
          reportId: report.reportId,
          jobId: report.jobId,
          generatedAt: report.generatedAt,
          summary: report.summary,
          recommendations: report.recommendations,
        },
      });
    })
  );

  /**
   * POST /validate/entity
   * Validate a single entity (preview mode)
   */
  router.post(
    '/validate/entity',
    asyncHandler(async (req: Request, res: Response) => {
      const { entityName } = req.body;

      if (!entityName || typeof entityName !== 'string') {
        throw new ValidationError('entityName is required and must be a string');
      }

      const result = await qaService.validateSingleEntity(entityName);

      if (!result) {
        throw new NotFoundError(`Entity not found: ${entityName}`);
      }

      res.json({
        data: result,
      });
    })
  );

  /**
   * GET /health
   * Check external API health
   */
  router.get(
    '/health',
    asyncHandler(async (_req: Request, res: Response) => {
      const health = await qaService.checkExternalAPIHealth();

      const allHealthy = Object.values(health).every(v => v);

      res.status(allHealthy ? 200 : 503).json({
        data: {
          status: allHealthy ? 'healthy' : 'degraded',
          apis: health,
          timestamp: new Date().toISOString(),
        },
      });
    })
  );

  /**
   * POST /fix
   * Apply a single fix from QA validation
   */
  router.post(
    '/fix',
    asyncHandler(async (req: Request, res: Response) => {
      const { entityId, field, value } = req.body;

      if (!entityId || typeof entityId !== 'string') {
        throw new ValidationError('entityId is required and must be a string');
      }

      if (!field || typeof field !== 'string') {
        throw new ValidationError('field is required and must be a string');
      }

      if (value === undefined) {
        throw new ValidationError('value is required');
      }

      const result = await qaService.applyFix(entityId, field, value);

      if (!result.success) {
        throw new ValidationError(result.error || 'Failed to apply fix');
      }

      res.json({
        data: {
          success: true,
          entityId,
          field,
          message: 'Fix applied successfully',
        },
      });
    })
  );

  /**
   * POST /fix/batch
   * Apply multiple fixes in batch
   */
  router.post(
    '/fix/batch',
    asyncHandler(async (req: Request, res: Response) => {
      const { fixes } = req.body;

      if (!Array.isArray(fixes)) {
        throw new ValidationError('fixes must be an array');
      }

      if (fixes.length === 0) {
        throw new ValidationError('fixes array cannot be empty');
      }

      // Validate each fix
      for (const fix of fixes) {
        if (!fix.entityId || typeof fix.entityId !== 'string') {
          throw new ValidationError('Each fix must have an entityId string');
        }
        if (!fix.field || typeof fix.field !== 'string') {
          throw new ValidationError('Each fix must have a field string');
        }
        if (fix.value === undefined) {
          throw new ValidationError('Each fix must have a value');
        }
      }

      const results = await qaService.applyFixBatch(fixes);

      const successful = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;

      res.json({
        data: {
          successful,
          failed,
          total: fixes.length,
          results,
        },
      });
    })
  );

  return router;
}
