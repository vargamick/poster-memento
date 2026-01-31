/**
 * Processing API Routes
 *
 * REST endpoints for the processing pipeline.
 * These endpoints allow external frontends to trigger and monitor
 * metadata, PDF, and embedding processing operations.
 */

import { Router } from 'express';
import { asyncHandler, ValidationError, NotFoundError } from '../middleware/errorHandler.js';
import type { MetadataProcessingService } from '../../services/processing/MetadataProcessingService.js';
import type { PdfProcessingService } from '../../services/processing/PdfProcessingService.js';
import type { EmbeddingProcessingService } from '../../services/processing/EmbeddingProcessingService.js';
import { processingJobManager } from '../../services/processing/ProcessingJobManager.js';
import type {
  MetadataStartRequest,
  MetadataBatchRequest,
  PdfStartRequest,
  PdfBatchRequest,
  EmbeddingStartRequest,
  EmbeddingBatchRequest
} from '../../services/processing/types.js';

/**
 * Create processing routes
 */
export function createProcessingRoutes(
  metadataService: MetadataProcessingService,
  pdfService: PdfProcessingService,
  embeddingService: EmbeddingProcessingService
): Router {
  const router = Router();

  // ============================================
  // Job Management Endpoints
  // ============================================

  /**
   * GET /processing/jobs - List all processing jobs
   */
  router.get('/jobs', asyncHandler(async (req, res) => {
    const { type, status, limit } = req.query;

    let jobs = processingJobManager.getAllJobs();

    // Filter by type if specified
    if (type && typeof type === 'string') {
      jobs = jobs.filter(job => job.type === type);
    }

    // Filter by status if specified
    if (status && typeof status === 'string') {
      jobs = jobs.filter(job => job.status === status);
    }

    // Limit results
    const maxResults = limit ? parseInt(limit as string) : 50;
    jobs = jobs.slice(0, maxResults);

    res.json({
      data: jobs,
      count: jobs.length
    });
  }));

  /**
   * GET /processing/jobs/:id - Get specific job status
   */
  router.get('/jobs/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const job = processingJobManager.getJob(id);

    if (!job) {
      throw new NotFoundError(`Job not found: ${id}`);
    }

    res.json({
      data: job
    });
  }));

  /**
   * DELETE /processing/jobs/:id - Cancel a running job
   */
  router.delete('/jobs/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const cancelled = processingJobManager.cancelJob(id);

    if (!cancelled) {
      throw new ValidationError(`Cannot cancel job ${id}. It may have completed or doesn't exist.`);
    }

    res.json({
      data: {
        jobId: id,
        cancelled: true
      },
      message: 'Job cancellation requested'
    });
  }));

  // ============================================
  // Metadata Processing Endpoints
  // ============================================

  /**
   * POST /processing/metadata/start - Start a metadata processing job
   */
  router.post('/metadata/start', asyncHandler(async (req, res) => {
    const body = req.body as MetadataStartRequest || {};

    const job = await metadataService.startJob(body.options);

    res.status(202).json({
      data: {
        jobId: job.jobId,
        status: job.status,
        message: 'Metadata processing job started'
      }
    });
  }));

  /**
   * POST /processing/metadata/load - Load metadata from scrape run
   *
   * Body:
   * - scrapeRunPath: Path to scrape run directory
   */
  router.post('/metadata/load', asyncHandler(async (req, res) => {
    const { scrapeRunPath } = req.body;

    if (!scrapeRunPath) {
      throw new ValidationError('scrapeRunPath is required');
    }

    const metadata = await metadataService.loadMetadata(scrapeRunPath);

    res.json({
      data: metadata
    });
  }));

  /**
   * POST /processing/metadata/batch - Process a batch of products
   *
   * Body:
   * - jobId: Job ID from start endpoint
   * - products: Array of product data
   * - categories: Optional array of category data
   * - options: Optional processing options
   */
  router.post('/metadata/batch', asyncHandler(async (req, res) => {
    const body = req.body as MetadataBatchRequest;

    if (!body.jobId) {
      throw new ValidationError('jobId is required');
    }

    if (!body.products || !Array.isArray(body.products)) {
      throw new ValidationError('products array is required');
    }

    const result = await metadataService.processBatch(
      body.jobId,
      body.products,
      body.categories,
      body.options
    );

    res.json({
      data: result
    });
  }));

  /**
   * POST /processing/metadata/sync-catalog - Sync catalog entities to graph
   */
  router.post('/metadata/sync-catalog', asyncHandler(async (req, res) => {
    const { dryRun } = req.body || {};

    const result = await metadataService.syncCatalogEntities(dryRun === true);

    res.json({
      data: result
    });
  }));

  /**
   * GET /processing/metadata/status - Get metadata job status
   */
  router.get('/metadata/status', asyncHandler(async (req, res) => {
    const job = processingJobManager.getCurrentJob('metadata');

    res.json({
      data: job,
      message: job ? undefined : 'No active metadata job'
    });
  }));

  // ============================================
  // PDF Processing Endpoints
  // ============================================

  /**
   * POST /processing/pdf/start - Start a PDF processing job
   *
   * Body:
   * - scrapeRunPath: Path to scrape run directory
   * - options: Optional processing options
   */
  router.post('/pdf/start', asyncHandler(async (req, res) => {
    const body = req.body as PdfStartRequest;

    if (!body.scrapeRunPath) {
      throw new ValidationError('scrapeRunPath is required');
    }

    const job = await pdfService.startJob(body.scrapeRunPath, body.options);

    res.status(202).json({
      data: {
        jobId: job.jobId,
        status: job.status,
        message: 'PDF processing job started'
      }
    });
  }));

  /**
   * POST /processing/pdf/batch - Process a batch of PDFs
   *
   * Body:
   * - jobId: Job ID from start endpoint
   * - pdfs: Array of PDF inputs (productEntityId, pdfPath, pdfType)
   * - options: Optional processing options
   */
  router.post('/pdf/batch', asyncHandler(async (req, res) => {
    const body = req.body as PdfBatchRequest;

    if (!body.jobId) {
      throw new ValidationError('jobId is required');
    }

    if (!body.pdfs || !Array.isArray(body.pdfs)) {
      throw new ValidationError('pdfs array is required');
    }

    const result = await pdfService.processBatch(body.jobId, body.pdfs, body.options);

    res.json({
      data: result
    });
  }));

  /**
   * POST /processing/pdf/extract - Extract content from a single PDF
   *
   * Body:
   * - pdfPath: Path to PDF file
   */
  router.post('/pdf/extract', asyncHandler(async (req, res) => {
    const { pdfPath } = req.body;

    if (!pdfPath) {
      throw new ValidationError('pdfPath is required');
    }

    const content = await pdfService.extractPdfContent(pdfPath);

    res.json({
      data: content
    });
  }));

  /**
   * GET /processing/pdf/status - Get PDF job status
   */
  router.get('/pdf/status', asyncHandler(async (req, res) => {
    const job = processingJobManager.getCurrentJob('pdf');

    res.json({
      data: job,
      message: job ? undefined : 'No active PDF job'
    });
  }));

  // ============================================
  // Embedding Processing Endpoints
  // ============================================

  /**
   * POST /processing/embeddings/start - Start an embedding processing job
   *
   * Body:
   * - options: Optional processing options (entityTypes, batchSize, delayMs)
   */
  router.post('/embeddings/start', asyncHandler(async (req, res) => {
    const body = req.body as EmbeddingStartRequest || {};

    // Check if embedding service is available
    if (!embeddingService.isEmbeddingServiceAvailable()) {
      throw new ValidationError('Embedding service not configured. Set VOYAGE_API_KEY environment variable.');
    }

    const job = await embeddingService.startJob(body.options);

    res.status(202).json({
      data: {
        jobId: job.jobId,
        status: job.status,
        message: 'Embedding processing job started'
      }
    });
  }));

  /**
   * POST /processing/embeddings/batch - Process embeddings for a batch of entities
   *
   * Body:
   * - jobId: Job ID from start endpoint
   * - entityIds: Array of entity IDs to process
   */
  router.post('/embeddings/batch', asyncHandler(async (req, res) => {
    const body = req.body as EmbeddingBatchRequest;

    if (!body.jobId) {
      throw new ValidationError('jobId is required');
    }

    if (!body.entityIds || !Array.isArray(body.entityIds)) {
      throw new ValidationError('entityIds array is required');
    }

    const result = await embeddingService.processBatch(body.jobId, body.entityIds);

    res.json({
      data: result
    });
  }));

  /**
   * GET /processing/embeddings/entities - List entities for embedding generation
   *
   * Query params:
   * - entityTypes: Comma-separated list of entity types
   * - limit: Maximum number of results
   */
  router.get('/embeddings/entities', asyncHandler(async (req, res) => {
    const { entityTypes, limit } = req.query;

    const types = entityTypes
      ? (entityTypes as string).split(',').map(t => t.trim())
      : undefined;

    const maxResults = limit ? parseInt(limit as string) : 100;

    const entities = await embeddingService.listEntitiesForEmbedding(types, maxResults);

    res.json({
      data: entities,
      count: entities.length
    });
  }));

  /**
   * GET /processing/embeddings/status - Get embedding job status
   */
  router.get('/embeddings/status', asyncHandler(async (req, res) => {
    const job = processingJobManager.getCurrentJob('embeddings');

    res.json({
      data: job,
      message: job ? undefined : 'No active embedding job'
    });
  }));

  /**
   * GET /processing/embeddings/info - Get embedding service info
   */
  router.get('/embeddings/info', asyncHandler(async (req, res) => {
    const info = embeddingService.getEmbeddingServiceInfo();

    res.json({
      data: {
        available: embeddingService.isEmbeddingServiceAvailable(),
        ...info
      }
    });
  }));

  // ============================================
  // Complete Job Endpoints
  // ============================================

  /**
   * POST /processing/metadata/complete - Complete a metadata job
   */
  router.post('/metadata/complete', asyncHandler(async (req, res) => {
    const { jobId, stats } = req.body;

    if (!jobId) {
      throw new ValidationError('jobId is required');
    }

    metadataService.completeJob(jobId, stats);

    res.json({
      data: {
        jobId,
        status: 'completed'
      }
    });
  }));

  /**
   * POST /processing/pdf/complete - Complete a PDF job
   */
  router.post('/pdf/complete', asyncHandler(async (req, res) => {
    const { jobId, stats } = req.body;

    if (!jobId) {
      throw new ValidationError('jobId is required');
    }

    pdfService.completeJob(jobId, stats);

    res.json({
      data: {
        jobId,
        status: 'completed'
      }
    });
  }));

  /**
   * POST /processing/embeddings/complete - Complete an embedding job
   */
  router.post('/embeddings/complete', asyncHandler(async (req, res) => {
    const { jobId, stats } = req.body;

    if (!jobId) {
      throw new ValidationError('jobId is required');
    }

    embeddingService.completeJob(jobId, stats);

    res.json({
      data: {
        jobId,
        status: 'completed'
      }
    });
  }));

  return router;
}
