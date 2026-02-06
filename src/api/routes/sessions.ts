/**
 * Session Routes
 *
 * REST endpoints for managing upload sessions (staging areas for images).
 * Sessions are transient folders where users upload images before processing.
 * After successful processing, images move to the live folder.
 */

import { Router } from 'express';
import * as crypto from 'crypto';
import multer from 'multer';
import { asyncHandler, ValidationError, NotFoundError } from '../middleware/errorHandler.js';
import { createImageStorageFromEnv, ImageStorageService } from '../../image-processor/ImageStorageService.js';
import { createPosterProcessor, PosterProcessor } from '../../image-processor/PosterProcessor.js';
import { KnowledgeGraphManager, type Relation } from '../../KnowledgeGraphManager.js';
import { logger } from '../../utils/logger.js';
import { ensurePosterTypesSeeded } from '../../utils/ensurePosterTypes.js';
import type { SessionProcessingResult, ProcessingResultMetadata, PosterEntity } from '../../image-processor/types.js';

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
 * Create session routes
 */
export function createSessionRoutes(knowledgeGraphManager: KnowledgeGraphManager): Router {
  const router = Router();

  /**
   * GET /sessions - List all sessions
   */
  router.get('/', asyncHandler(async (_req, res) => {
    const storage = await getStorageService();
    const sessions = await storage.listSessions();

    res.json({
      sessions,
      total: sessions.length
    });
  }));

  /**
   * POST /sessions - Create a new session
   */
  router.post('/', asyncHandler(async (req, res) => {
    const { name } = req.body;

    if (!name || typeof name !== 'string') {
      throw new ValidationError('Session name is required');
    }

    const storage = await getStorageService();
    const session = await storage.createSession(name);

    logger.info('Session created', { sessionId: session.sessionId, name: session.name });

    res.status(201).json({ session });
  }));

  /**
   * GET /sessions/:sessionId - Get session details
   */
  router.get('/:sessionId', asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const storage = await getStorageService();

    const session = await storage.getSession(sessionId);
    if (!session) {
      throw new NotFoundError(`Session not found: ${sessionId}`);
    }

    res.json({ session });
  }));

  /**
   * DELETE /sessions/:sessionId - Delete a session (must be empty)
   */
  router.delete('/:sessionId', asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const storage = await getStorageService();

    const session = await storage.getSession(sessionId);
    if (!session) {
      throw new NotFoundError(`Session not found: ${sessionId}`);
    }

    await storage.deleteSession(sessionId);
    logger.info('Session deleted', { sessionId });

    res.json({ success: true, message: `Session ${sessionId} deleted` });
  }));

  /**
   * GET /sessions/:sessionId/images - List images in a session
   */
  router.get('/:sessionId/images', asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const storage = await getStorageService();

    const session = await storage.getSession(sessionId);
    if (!session) {
      throw new NotFoundError(`Session not found: ${sessionId}`);
    }

    const images = await storage.listSessionImages(sessionId);

    res.json({
      sessionId,
      images,
      total: images.length
    });
  }));

  /**
   * POST /sessions/:sessionId/images - Upload image(s) to a session
   */
  router.post('/:sessionId/images', upload.array('images', 100), asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const storage = await getStorageService();

    const session = await storage.getSession(sessionId);
    if (!session) {
      throw new NotFoundError(`Session not found: ${sessionId}`);
    }

    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      throw new ValidationError('No files uploaded');
    }

    const uploadedImages = [];
    for (const file of files) {
      const hash = crypto.createHash('sha256').update(file.buffer).digest('hex').slice(0, 16);
      const uploaded = await storage.uploadToSessionFromBuffer(
        sessionId,
        file.buffer,
        file.originalname,
        hash
      );
      uploadedImages.push(uploaded);
    }

    logger.info('Images uploaded to session', {
      sessionId,
      count: uploadedImages.length
    });

    res.json({
      success: true,
      uploaded: uploadedImages.length,
      images: uploadedImages
    });
  }));

  /**
   * DELETE /sessions/:sessionId/images/:hash - Delete an image from a session
   */
  router.delete('/:sessionId/images/:hash', asyncHandler(async (req, res) => {
    const { sessionId, hash } = req.params;
    const storage = await getStorageService();

    const session = await storage.getSession(sessionId);
    if (!session) {
      throw new NotFoundError(`Session not found: ${sessionId}`);
    }

    await storage.deleteSessionImage(sessionId, hash);

    res.json({ success: true, message: `Image ${hash} deleted from session` });
  }));

  /**
   * POST /sessions/:sessionId/process - Process selected images from a session
   */
  router.post('/:sessionId/process', asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const {
      imageHashes,
      modelKey = 'ollama-minicpm',
      batchSize = 5
    } = req.body;

    const storage = await getStorageService();
    const processor = await getProcessor();

    // Ensure poster types are seeded
    await ensurePosterTypesSeeded(knowledgeGraphManager);

    const session = await storage.getSession(sessionId);
    if (!session) {
      throw new NotFoundError(`Session not found: ${sessionId}`);
    }

    // Get images to process
    let images = await storage.listSessionImages(sessionId);
    if (imageHashes && Array.isArray(imageHashes) && imageHashes.length > 0) {
      images = images.filter(img => imageHashes.includes(img.hash));
    }

    if (images.length === 0) {
      throw new ValidationError('No images to process');
    }

    logger.info('Processing session images', {
      sessionId,
      imageCount: images.length,
      modelKey
    });

    const results: SessionProcessingResult[] = [];

    // Process in batches
    for (let i = 0; i < images.length; i += batchSize) {
      const batch = images.slice(i, i + batchSize);

      const batchResults = await Promise.all(
        batch.map(async (image) => {
          const startTime = Date.now();

          try {
            // Download to temp
            const tempPath = await storage.downloadSessionImageToTemp(sessionId, image.hash);

            try {
              // Process with vision model - skipStorage since we handle storage ourselves
              const processingResult = await processor.processImage(tempPath, { modelKey, skipStorage: true });

              if (!processingResult.success || !processingResult.entity) {
                throw new Error(processingResult.error || 'Processing failed');
              }

              const posterEntity = processingResult.entity;

              // Update entity metadata with S3 info
              posterEntity.metadata = {
                ...posterEntity.metadata,
                source_image_hash: image.hash,
                source_image_key: `live/images/${image.hash}-${image.filename}`,
                original_filename: image.filename,
                file_size_bytes: image.sizeBytes
              };

              // Create entity in knowledge graph (convert PosterEntity to Entity format)
              await knowledgeGraphManager.createEntities([{
                name: posterEntity.name,
                entityType: posterEntity.entityType,
                observations: posterEntity.observations || [`Created from image: ${image.filename}`]
              }]);

              // Add observations for extracted fields
              const additionalObs: string[] = [];
              if (posterEntity.poster_type) additionalObs.push(`Poster type: ${posterEntity.poster_type}`);
              if (posterEntity.title) additionalObs.push(`Title: ${posterEntity.title}`);
              if (posterEntity.headliner) additionalObs.push(`Headliner: ${posterEntity.headliner}`);
              if (posterEntity.venue_name) additionalObs.push(`Venue: ${posterEntity.venue_name}`);
              if (posterEntity.event_date) additionalObs.push(`Event date: ${posterEntity.event_date}`);
              if (posterEntity.year) additionalObs.push(`Year: ${posterEntity.year}`);
              if (image.hash) additionalObs.push(`Image hash: ${image.hash}`);

              if (additionalObs.length > 0) {
                await knowledgeGraphManager.addObservations([{
                  entityName: posterEntity.name,
                  contents: additionalObs
                }]);
              }

              // Create relationships
              await createPosterRelationships(knowledgeGraphManager, posterEntity);

              // Move image to live folder
              await storage.moveToLive(sessionId, image.hash, posterEntity.name);

              // Store processing metadata
              const metadata: ProcessingResultMetadata = {
                hash: image.hash,
                entityName: posterEntity.name,
                title: posterEntity.title,
                extractedData: posterEntity as unknown as Record<string, unknown>,
                modelKey: modelKey,
                processedAt: new Date().toISOString()
              };
              await storage.storeLiveMetadata(image.hash, metadata);

              const processingTimeMs = Date.now() - startTime;

              logger.info('Image processed successfully', {
                hash: image.hash,
                entityName: posterEntity.name,
                processingTimeMs
              });

              return {
                hash: image.hash,
                success: true,
                entityName: posterEntity.name,
                title: posterEntity.title,
                movedToLive: true,
                processingTimeMs
              } as SessionProcessingResult;
            } finally {
              await storage.cleanupTemp(tempPath);
            }
          } catch (error: unknown) {
            const err = error as Error;
            const processingTimeMs = Date.now() - startTime;

            logger.error('Image processing failed', {
              hash: image.hash,
              error: err.message,
              processingTimeMs
            });

            return {
              hash: image.hash,
              success: false,
              error: err.message,
              movedToLive: false,
              processingTimeMs
            } as SessionProcessingResult;
          }
        })
      );

      results.push(...batchResults);
    }

    // Get updated session info
    const updatedSession = await storage.getSession(sessionId);

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    res.json({
      success: true,
      processed: results.length,
      succeeded,
      failed,
      results,
      sessionRemaining: updatedSession?.imageCount || 0
    });
  }));

  return router;
}

/**
 * Create relationships for a poster entity
 */
async function createPosterRelationships(
  knowledgeGraphManager: KnowledgeGraphManager,
  entity: PosterEntity
): Promise<void> {
  const relations: Relation[] = [];
  const now = Date.now();

  // Create headliner relation
  if (entity.headliner) {
    const headlinerName = `artist_${entity.headliner.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
    try {
      await knowledgeGraphManager.createEntities([{
        name: headlinerName,
        entityType: 'Artist',
        observations: [`Artist name: ${entity.headliner}`]
      }]);
    } catch {
      // Entity might already exist
    }
    relations.push({
      from: entity.name,
      to: headlinerName,
      relationType: 'HEADLINED_ON',
      metadata: {
        confidence: 0.8,
        source: 'vision',
        is_primary: true,
        createdAt: now,
        updatedAt: now
      }
    });
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
      } catch {
        // Entity might already exist
      }
      relations.push({
        from: entity.name,
        to: actName,
        relationType: 'PERFORMED_ON',
        metadata: {
          confidence: 0.7,
          source: 'vision',
          is_primary: false,
          createdAt: now,
          updatedAt: now
        }
      });
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
    } catch {
      // Entity might already exist
    }
    relations.push({
      from: entity.name,
      to: venueName,
      relationType: 'ADVERTISES_VENUE',
      metadata: {
        confidence: 0.8,
        source: 'vision',
        is_primary: true,
        createdAt: now,
        updatedAt: now
      }
    });
  }

  // Create HAS_TYPE relations for inferred_types
  if (entity.inferred_types?.length) {
    for (const typeInference of entity.inferred_types) {
      const typeName = `poster_type_${typeInference.type_key}`;
      relations.push({
        from: entity.name,
        to: typeName,
        relationType: 'HAS_TYPE',
        metadata: {
          confidence: typeInference.confidence,
          source: typeInference.source,
          is_primary: typeInference.is_primary || false,
          createdAt: now,
          updatedAt: now
        }
      });
    }
  }

  // Create relations
  if (relations.length > 0) {
    try {
      await knowledgeGraphManager.createRelations(relations);
    } catch (error) {
      logger.warn('Failed to create some relations', { error });
    }
  }
}
