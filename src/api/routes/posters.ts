/**
 * Poster Processing Routes
 *
 * REST endpoints for scanning, previewing, and processing poster images.
 * Provides direct REST API access to poster processing functionality.
 */

import { Router } from 'express';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import multer from 'multer';
import { asyncHandler, ValidationError, NotFoundError } from '../middleware/errorHandler.js';
import { handleScanPosters, ScanPostersArgs } from '../../server/handlers/toolHandlers/scanPosters.js';
import {
  handleProcessPosterBatch,
  getProcessingStats,
  resetProcessingState,
  ProcessPosterBatchArgs
} from '../../server/handlers/toolHandlers/processPosterBatch.js';
import { DatabaseBackup, getBackupConfigFromEnv } from '../../pipeline/DatabaseBackup.js';
import { DatabaseResetter, getResetConfigFromEnv } from '../../pipeline/DatabaseResetter.js';
import { createPosterProcessor, PosterProcessor } from '../../image-processor/PosterProcessor.js';
import { VisionModelFactory } from '../../image-processor/VisionModelFactory.js';
import { KnowledgeGraphManager, type Relation } from '../../KnowledgeGraphManager.js';
import { logger } from '../../utils/logger.js';
import { ensurePosterTypesSeeded, resetPosterTypeSeedCache } from '../../utils/ensurePosterTypes.js';
import { createImageStorageFromEnv, ImageStorageService } from '../../image-processor/ImageStorageService.js';
import type { StorageProvider } from '../../storage/StorageProvider.js';
import { PosterTypeQueryService } from '../../core/services/PosterTypeQueryService.js';
import type { TypeInference } from '../../image-processor/types.js';

// Configure multer for file uploads (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max file size
  },
  fileFilter: (_req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/tiff'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type: ${file.mimetype}. Allowed types: ${allowedTypes.join(', ')}`));
    }
  }
});

// Cache storage service instance
let storageServiceInstance: ImageStorageService | null = null;

async function getStorageService(): Promise<ImageStorageService> {
  if (!storageServiceInstance) {
    storageServiceInstance = createImageStorageFromEnv();
    await storageServiceInstance.initialize();
  }
  return storageServiceInstance;
}

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
export function createPosterRoutes(knowledgeGraphManager: KnowledgeGraphManager, storageProvider?: StorageProvider): Router {
  const router = Router();

  // Create PosterTypeQueryService for type statistics
  const posterTypeQueryService = storageProvider ? new PosterTypeQueryService(storageProvider) : null;

  /**
   * GET /posters/type-counts - Get poster count per type
   */
  router.get('/type-counts', asyncHandler(async (_req, res) => {
    if (!posterTypeQueryService) {
      res.json({ data: { total: 0, types: [] } });
      return;
    }

    try {
      const types = await posterTypeQueryService.getTypeStatistics();

      // Get total poster count
      const totalCypher = `
        MATCH (p:Entity {entityType: 'Poster'})
        WHERE p.validTo IS NULL
        RETURN count(p) as total
      `;
      const totalResult = await (storageProvider as any).runCypher(totalCypher, {});
      const total = totalResult.records?.[0]?.get('total')?.toInt?.() || totalResult.records?.[0]?.get('total') || 0;

      res.json({
        data: { total, types }
      });
    } catch (error: any) {
      logger.error('Failed to get type counts:', error);
      res.json({ data: { total: 0, types: [] } });
    }
  }));

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
   * POST /posters/upload - Upload an image file to MinIO storage
   *
   * This endpoint receives files from the browser (via File System Access API)
   * and stores them in MinIO for subsequent processing.
   *
   * @body file - The image file (multipart/form-data)
   * @returns The MinIO path for the uploaded file
   */
  router.post('/upload', upload.single('file'), asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new ValidationError('No file uploaded');
    }

    const { originalname, buffer, mimetype, size } = req.file;

    logger.info('Uploading file to MinIO', {
      filename: originalname,
      size,
      mimetype
    });

    try {
      // Get storage service
      const storage = await getStorageService();

      // Calculate hash from buffer
      const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);

      // Sanitize filename
      const sanitizedFilename = originalname
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .replace(/__+/g, '_')
        .toLowerCase();

      const key = `uploads/${hash}-${sanitizedFilename}`;

      // Write to temp file first (storage service expects file path)
      const tempDir = os.tmpdir();
      const tempPath = path.join(tempDir, `upload-${hash}-${Date.now()}`);

      await fs.writeFile(tempPath, buffer);

      try {
        // Store in MinIO
        const result = await storage.storeImage(tempPath);

        logger.info('File uploaded successfully', {
          key: result.key,
          hash: result.hash
        });

        res.json({
          data: {
            success: true,
            path: result.key,  // This is the MinIO key that can be used for processing
            filePath: result.key,
            hash: result.hash,
            originalFilename: originalname,
            sizeBytes: size,
            mimeType: mimetype,
            url: result.url
          }
        });
      } finally {
        // Clean up temp file
        await fs.unlink(tempPath).catch(() => {});
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to upload file:', error);
      throw new ValidationError(`Failed to upload file: ${errorMessage}`);
    }
  }));

  /**
   * GET /posters/directories - List directories for folder browser
   *
   * @query path - Path to list directories from (default: cwd or SOURCE_IMAGES_PATH parent)
   */
  router.get('/directories', asyncHandler(async (req, res) => {
    let requestedPath = req.query.path as string | undefined;

    // Default to parent of SOURCE_IMAGES_PATH or current working directory
    if (!requestedPath) {
      const sourceImagesPath = process.env.SOURCE_IMAGES_PATH || './SourceImages';
      requestedPath = path.dirname(path.resolve(sourceImagesPath));
    }

    // Resolve and normalize the path
    const resolvedPath = path.resolve(requestedPath);

    try {
      const stat = await fs.stat(resolvedPath);
      if (!stat.isDirectory()) {
        throw new ValidationError('Path is not a directory');
      }

      const entries = await fs.readdir(resolvedPath, { withFileTypes: true });

      // Get directories only, sorted alphabetically
      const directories = entries
        .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
        .map(entry => ({
          name: entry.name,
          path: path.join(resolvedPath, entry.name)
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      // Count images in current directory
      const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff'];
      const imageCount = entries.filter(entry =>
        entry.isFile() && imageExtensions.some(ext => entry.name.toLowerCase().endsWith(ext))
      ).length;

      // Get parent directory (if not at root)
      const parentPath = path.dirname(resolvedPath);
      const hasParent = parentPath !== resolvedPath;

      res.json({
        data: {
          success: true,
          currentPath: resolvedPath,
          parentPath: hasParent ? parentPath : null,
          directories,
          imageCount
        }
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new NotFoundError(`Directory not found: ${resolvedPath}`);
      }
      if ((error as NodeJS.ErrnoException).code === 'EACCES') {
        throw new ValidationError(`Permission denied: ${resolvedPath}`);
      }
      throw error;
    }
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
      if (entity.event_dates && entity.event_dates.length > 1) {
        additionalObservations.push(`Event dates: ${entity.event_dates.join(', ')}`);
      } else if (entity.event_date) {
        additionalObservations.push(`Event date: ${entity.event_date}`);
      }
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

      // Create HAS_TYPE relationships for inferred types
      let typeRelationsCreated = 0;
      if (entity.inferred_types && entity.inferred_types.length > 0) {
        // Ensure PosterType entities exist
        await ensurePosterTypesSeeded(knowledgeGraphManager);

        const now = Date.now();
        const typeRelations: Relation[] = entity.inferred_types.map((typeInference: TypeInference) => ({
          from: entity.name,
          to: `PosterType_${typeInference.type_key}`,
          relationType: 'HAS_TYPE',
          confidence: typeInference.confidence,
          metadata: {
            createdAt: now,
            updatedAt: now,
            source: typeInference.source,
            evidence: typeInference.evidence || '',
            inferred_by: 'commit_endpoint',
            inferred_at: new Date().toISOString(),
            is_primary: typeInference.is_primary
          }
        }));

        try {
          await knowledgeGraphManager.createRelations(typeRelations);
          typeRelationsCreated = typeRelations.length;
        } catch (e) {
          logger.warn('Error creating HAS_TYPE relationships:', e);
        }
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
          relationsCreated: relations.length,
          typeRelationsCreated
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

  // ============================================================================
  // S3 BUCKET OPERATIONS - Images must be in S3 before processing
  // ============================================================================

  /**
   * GET /posters/s3/list - List images in the S3 bucket
   *
   * @query offset - Pagination offset (default: 0)
   * @query limit - Number of results to return (default: 100)
   * @query unprocessed - Only return unprocessed images (default: false)
   */
  router.get('/s3/list', asyncHandler(async (req, res) => {
    const offset = parseInt(req.query.offset as string) || 0;
    const limit = parseInt(req.query.limit as string) || 100;
    const unprocessedOnly = req.query.unprocessed === 'true';

    try {
      const storage = await getStorageService();
      const result = await storage.listImages({ offset, limit });

      // If filtering to unprocessed only, check each file
      let files = result.files;
      if (unprocessedOnly) {
        const filteredFiles = [];
        for (const file of files) {
          const hasResult = await storage.hasProcessingResult(file.hash);
          if (!hasResult) {
            filteredFiles.push(file);
          }
        }
        files = filteredFiles;
      }

      // Count unprocessed
      let unprocessedCount = 0;
      for (const file of result.files) {
        const hasResult = await storage.hasProcessingResult(file.hash);
        if (!hasResult) {
          unprocessedCount++;
        }
      }

      res.json({
        data: {
          success: true,
          source: 's3',
          bucket: process.env.MINIO_BUCKET || 'poster-images',
          files,
          totalFiles: result.totalFiles,
          unprocessedCount,
          offset,
          limit,
          hasMore: result.hasMore
        }
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to list S3 images:', error);
      throw new ValidationError(`Failed to list S3 images: ${errorMessage}`);
    }
  }));

  /**
   * POST /posters/s3/upload-batch - Upload files from server filesystem to S3
   *
   * This uploads files from the server's source-images folder to S3.
   * For browser uploads, use the /upload endpoint instead.
   *
   * @body filePaths - Array of file paths to upload (from /scan results)
   * @body limit - Maximum number of files to upload (default: all)
   */
  router.post('/s3/upload-batch', asyncHandler(async (req, res) => {
    const { filePaths, limit } = req.body;

    if (!filePaths || !Array.isArray(filePaths) || filePaths.length === 0) {
      throw new ValidationError('filePaths array is required');
    }

    const maxFiles = limit ? Math.min(limit, filePaths.length) : filePaths.length;
    const pathsToUpload = filePaths.slice(0, maxFiles);

    logger.info('Uploading batch to S3', { count: pathsToUpload.length });

    try {
      const storage = await getStorageService();
      const results: Array<{
        path: string;
        success: boolean;
        key?: string;
        hash?: string;
        error?: string;
      }> = [];

      for (const filePath of pathsToUpload) {
        try {
          // Verify file exists
          if (!fsSync.existsSync(filePath)) {
            results.push({ path: filePath, success: false, error: 'File not found' });
            continue;
          }

          const stored = await storage.storeImage(filePath);
          results.push({
            path: filePath,
            success: true,
            key: stored.key,
            hash: stored.hash
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          results.push({ path: filePath, success: false, error: errorMessage });
        }
      }

      const succeeded = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;

      res.json({
        data: {
          success: true,
          uploaded: succeeded,
          failed,
          total: results.length,
          results
        }
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to upload batch to S3:', error);
      throw new ValidationError(`Failed to upload batch: ${errorMessage}`);
    }
  }));

  /**
   * POST /posters/s3/process - Process images from S3 bucket
   *
   * This downloads images from S3, processes them with the vision model,
   * and stores the results. This is the main processing endpoint.
   *
   * @body s3Keys - Array of S3 keys to process (from /s3/list results)
   * @body batchSize - Number of images to process (default: 10)
   * @body skipIfExists - Skip already processed images (default: true)
   * @body modelKey - Vision model to use
   */
  router.post('/s3/process', asyncHandler(async (req, res) => {
    const { s3Keys, batchSize = 10, skipIfExists = true, modelKey } = req.body;

    if (!s3Keys || !Array.isArray(s3Keys) || s3Keys.length === 0) {
      throw new ValidationError('s3Keys array is required');
    }

    const keysToProcess = s3Keys.slice(0, batchSize);

    logger.info('Processing S3 images', { count: keysToProcess.length, modelKey });

    // Ensure PosterType entities exist
    try {
      await ensurePosterTypesSeeded(knowledgeGraphManager);
    } catch (e) {
      logger.warn('Failed to seed PosterType entities:', e);
    }

    const storage = await getStorageService();
    const processor = await getProcessor();

    const results: Array<{
      key: string;
      success: boolean;
      entityName?: string;
      title?: string;
      error?: string;
      processingTimeMs: number;
    }> = [];

    for (const s3Key of keysToProcess) {
      const startTime = Date.now();
      let tempPath: string | null = null;

      try {
        // Extract hash from key for skip check
        const keyParts = s3Key.replace('originals/', '').split('-');
        const hash = keyParts[0] || '';

        // Check if already processed
        if (skipIfExists) {
          const hasResult = await storage.hasProcessingResult(hash);
          if (hasResult) {
            results.push({
              key: s3Key,
              success: false,
              error: 'Already processed',
              processingTimeMs: Date.now() - startTime
            });
            continue;
          }
        }

        // Download from S3 to temp file
        tempPath = await storage.downloadToTemp(s3Key);

        // Process with vision model
        const processingResult = await processor.processImage(tempPath, {
          skipStorage: true,  // We already have it in S3
          modelKey
        });

        if (processingResult.success && processingResult.entity) {
          const entity = processingResult.entity;

          // Update entity metadata with S3 info
          entity.metadata = {
            ...entity.metadata,
            source_image_key: s3Key,
            source_image_hash: hash
          };

          // Store in knowledge graph
          await knowledgeGraphManager.createEntities([{
            name: entity.name,
            entityType: entity.entityType,
            observations: entity.observations || []
          }]);

          // Add observations
          const additionalObs: string[] = [];
          if (entity.poster_type) additionalObs.push(`Poster type: ${entity.poster_type}`);
          if (entity.title) additionalObs.push(`Title: ${entity.title}`);
          if (entity.headliner) additionalObs.push(`Headliner: ${entity.headliner}`);
          if (entity.venue_name) additionalObs.push(`Venue: ${entity.venue_name}`);
          if (entity.city) additionalObs.push(`City: ${entity.city}`);
          if (entity.event_dates && entity.event_dates.length > 1) {
            additionalObs.push(`Event dates: ${entity.event_dates.join(', ')}`);
          } else if (entity.event_date) {
            additionalObs.push(`Event date: ${entity.event_date}`);
          }
          if (entity.year) additionalObs.push(`Year: ${entity.year}`);

          if (additionalObs.length > 0) {
            await knowledgeGraphManager.addObservations([{
              entityName: entity.name,
              contents: additionalObs
            }]);
          }

          // Store processing result in S3
          await storage.storeProcessingResult(hash, {
            entity,
            processedAt: new Date().toISOString()
          });

          // Create relations (artists, venues)
          const relations: Array<{ from: string; to: string; relationType: string }> = [];

          if (entity.headliner) {
            const headlinerName = `artist_${entity.headliner.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
            try {
              await knowledgeGraphManager.createEntities([{
                name: headlinerName,
                entityType: 'Artist',
                observations: [`Artist name: ${entity.headliner}`]
              }]);
            } catch (e) { /* exists */ }
            relations.push({ from: entity.name, to: headlinerName, relationType: 'HEADLINED_ON' });
          }

          if (entity.venue_name) {
            const venueName = `venue_${entity.venue_name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
            try {
              await knowledgeGraphManager.createEntities([{
                name: venueName,
                entityType: 'Venue',
                observations: [`Venue name: ${entity.venue_name}`]
              }]);
            } catch (e) { /* exists */ }
            relations.push({ from: entity.name, to: venueName, relationType: 'ADVERTISES_VENUE' });
          }

          if (relations.length > 0) {
            try {
              await knowledgeGraphManager.createRelations(relations);
            } catch (e) {
              logger.warn('Error creating relations:', e);
            }
          }

          // Create HAS_TYPE relationships
          if (entity.inferred_types && entity.inferred_types.length > 0) {
            const now = Date.now();
            const typeRelations = entity.inferred_types.map((ti: TypeInference) => ({
              from: entity.name,
              to: `PosterType_${ti.type_key}`,
              relationType: 'HAS_TYPE',
              confidence: ti.confidence,
              metadata: {
                createdAt: now,
                updatedAt: now,
                source: ti.source,
                is_primary: ti.is_primary
              }
            }));

            try {
              await knowledgeGraphManager.createRelations(typeRelations);
            } catch (e) {
              logger.warn('Error creating type relations:', e);
            }
          }

          results.push({
            key: s3Key,
            success: true,
            entityName: entity.name,
            title: entity.title,
            processingTimeMs: Date.now() - startTime
          });
        } else {
          results.push({
            key: s3Key,
            success: false,
            error: processingResult.error || 'Processing failed',
            processingTimeMs: Date.now() - startTime
          });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        results.push({
          key: s3Key,
          success: false,
          error: errorMessage,
          processingTimeMs: Date.now() - startTime
        });
      } finally {
        // Cleanup temp file
        if (tempPath) {
          await storage.cleanupTemp(tempPath);
        }
      }
    }

    const succeeded = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const skipped = results.filter(r => r.error === 'Already processed').length;

    res.json({
      data: {
        success: true,
        processed: results.length,
        succeeded,
        failed: failed - skipped,
        skipped,
        hasMore: s3Keys.length > batchSize,
        results
      }
    });
  }));

  // ============================================================================
  // DATABASE MANAGEMENT - Backup and Reset operations
  // ============================================================================

  /**
   * POST /posters/database/backup-and-reset - Backup then reset databases
   *
   * Creates a backup of Neo4j and PostgreSQL, then truncates all data.
   * This is useful before reprocessing the entire collection.
   *
   * @body confirm - Must be "CONFIRM_RESET" to proceed
   */
  router.post('/database/backup-and-reset', asyncHandler(async (req, res) => {
    const { confirm } = req.body;

    if (confirm !== 'CONFIRM_RESET') {
      throw new ValidationError('Must provide confirm: "CONFIRM_RESET" to proceed. This operation will delete all data after backing up.');
    }

    logger.info('Starting backup and reset operation');

    try {
      // Step 1: Archive live images from MinIO
      logger.info('Step 1: Archiving live images...');
      const storage = await getStorageService();
      const archiveResult = await storage.archiveLiveImages();
      logger.info('Live images archived', {
        archivePath: archiveResult.archivePath,
        imagesCopied: archiveResult.imagesCopied,
        metadataCopied: archiveResult.metadataCopied
      });

      // Step 2: Backup
      logger.info('Step 2: Creating backup...');
      const backupConfig = getBackupConfigFromEnv();
      const backup = new DatabaseBackup(backupConfig);
      const backupResult = await backup.backup();

      logger.info('Backup complete', {
        timestamp: backupResult.timestamp,
        neo4jEntities: backupResult.neo4jStats.entities,
        postgresEmbeddings: backupResult.postgresStats.embeddings
      });

      // Step 3: Reset
      logger.info('Step 3: Resetting databases...');
      const resetConfig = getResetConfigFromEnv(true); // Skip interactive confirmation
      const resetter = new DatabaseResetter(resetConfig);
      const resetResult = await resetter.reset();

      logger.info('Reset complete', {
        entitiesRemoved: resetResult.beforeStats.neo4j.entities,
        embeddingsRemoved: resetResult.beforeStats.postgres.embeddings
      });

      // Clear any cached processing state
      resetProcessingState();

      // Step 4: Reseed PosterType entities
      logger.info('Step 4: Reseeding PosterType entities...');
      resetPosterTypeSeedCache(); // Clear the cache so seeding actually runs
      const seedResult = await ensurePosterTypesSeeded(knowledgeGraphManager, true);
      logger.info('Seeding complete', {
        posterTypesCreated: seedResult.created
      });

      res.json({
        data: {
          success: true,
          archive: {
            archivePath: archiveResult.archivePath,
            imagesCopied: archiveResult.imagesCopied,
            metadataCopied: archiveResult.metadataCopied
          },
          backup: {
            timestamp: backupResult.timestamp,
            neo4jBackupPath: backupResult.neo4jBackupPath,
            postgresBackupPath: backupResult.postgresBackupPath,
            stats: {
              entities: backupResult.neo4jStats.entities,
              relationships: backupResult.neo4jStats.relationships,
              embeddings: backupResult.postgresStats.embeddings
            }
          },
          reset: {
            success: resetResult.success,
            entitiesRemoved: resetResult.beforeStats.neo4j.entities,
            relationshipsRemoved: resetResult.beforeStats.neo4j.relationships,
            embeddingsRemoved: resetResult.beforeStats.postgres.embeddings
          },
          seeded: {
            posterTypesCreated: seedResult.created
          }
        }
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Backup and reset failed:', error);
      throw new ValidationError(`Backup and reset failed: ${errorMessage}`);
    }
  }));

  /**
   * POST /posters/database/backup - Create a backup only (no reset)
   *
   * Creates a backup of Neo4j and PostgreSQL databases.
   *
   * @body compress - Whether to compress backup files (default: false)
   */
  router.post('/database/backup', asyncHandler(async (req, res) => {
    const { compress = false } = req.body;

    logger.info('Creating database backup');

    try {
      const backupConfig = getBackupConfigFromEnv();
      backupConfig.compress = compress;

      const backup = new DatabaseBackup(backupConfig);
      const backupResult = await backup.backup();

      logger.info('Backup complete', {
        timestamp: backupResult.timestamp,
        neo4jEntities: backupResult.neo4jStats.entities,
        postgresEmbeddings: backupResult.postgresStats.embeddings
      });

      res.json({
        data: {
          success: true,
          timestamp: backupResult.timestamp,
          neo4jBackupPath: backupResult.neo4jBackupPath,
          postgresBackupPath: backupResult.postgresBackupPath,
          manifestPath: backupResult.manifestPath,
          stats: {
            entities: backupResult.neo4jStats.entities,
            relationships: backupResult.neo4jStats.relationships,
            embeddings: backupResult.postgresStats.embeddings,
            tableSize: backupResult.postgresStats.tableSize
          }
        }
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Backup failed:', error);
      throw new ValidationError(`Backup failed: ${errorMessage}`);
    }
  }));

  /**
   * GET /posters/database/stats - Get current database statistics
   */
  router.get('/database/stats', asyncHandler(async (_req, res) => {
    try {
      const backupConfig = getBackupConfigFromEnv();
      const backup = new DatabaseBackup(backupConfig);
      const stats = await backup.getDatabaseStats();

      res.json({
        data: {
          success: true,
          neo4j: {
            entities: stats.neo4j.entities,
            relationships: stats.neo4j.relationships,
            labels: stats.neo4j.labels
          },
          postgres: {
            embeddings: stats.postgres.embeddings,
            tableSize: stats.postgres.tableSize
          }
        }
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to get database stats:', error);
      throw new ValidationError(`Failed to get stats: ${errorMessage}`);
    }
  }));

  return router;
}
