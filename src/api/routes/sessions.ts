/**
 * Session Routes
 *
 * REST endpoints for managing upload sessions (staging areas for images).
 * Sessions are transient folders where users upload images before processing.
 * After successful processing, images move to the live folder.
 */

import { Router } from 'express';
import { Readable } from 'stream';
import * as crypto from 'crypto';
import multer from 'multer';
import { asyncHandler, ValidationError, NotFoundError, ConflictError } from '../middleware/errorHandler.js';
import { createImageStorageFromEnv, ImageStorageService } from '../../image-processor/ImageStorageService.js';
import { createPosterProcessor, PosterProcessor } from '../../image-processor/PosterProcessor.js';
import { KnowledgeGraphManager, type Relation } from '../../KnowledgeGraphManager.js';
import { logger } from '../../utils/logger.js';
import { ensurePosterTypesSeeded } from '../../utils/ensurePosterTypes.js';
import { cleanPosterData, splitMultiDateString, normalizeDate, extractYear } from '../../image-processor/utils/posterDataCleaner.js';
import { ArtistSplitter, type ValidatedArtist, splitAndValidateArtists } from '../../image-processor/utils/artistSplitter.js';
import { splitVenueDate } from '../../image-processor/utils/venueDateSplitter.js';
import { MusicBrainzClient } from '../../qa-validation/clients/MusicBrainzClient.js';
import type { SessionProcessingResult, ProcessingResultMetadata, PosterEntity, SessionInfo } from '../../image-processor/types.js';
import { reviewExtractedData, applyCorrections, shouldProcessEntity, type ReviewResult } from '../../image-processor/ReviewPhase.js';
import { VisionModelFactory } from '../../image-processor/VisionModelFactory.js';
import { ConsensusProcessor } from '../../image-processor/consensus/ConsensusProcessor.js';

// ============================================================================
// Entity Creation Configuration
// ============================================================================

/**
 * Minimum confidence threshold for creating linked entities (Artist, Venue, Event)
 * Entities below this threshold won't be created - their data will remain as
 * observations on the Poster entity only.
 */
const ENTITY_CREATION_CONFIDENCE_THRESHOLD = 0.6;

/**
 * Minimum confidence for creating relationships between entities
 */
const RELATIONSHIP_CONFIDENCE_THRESHOLD = 0.5;

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

// Cache artist splitter instance (with MusicBrainz client)
let artistSplitterInstance: ArtistSplitter | null = null;

function getArtistSplitter(): ArtistSplitter {
  if (!artistSplitterInstance) {
    const musicBrainz = new MusicBrainzClient();
    artistSplitterInstance = new ArtistSplitter(musicBrainz, undefined, {
      matchThreshold: 0.85,
      partialThreshold: 0.7,
      verbose: false,
    });
  }
  return artistSplitterInstance;
}

/**
 * Convert a public/external MinIO URL to an internal URL for server-side fetching.
 */
function rewriteToInternal(url: string): string {
  if (url.includes('.amazonaws.com') || url.includes('.s3.')) {
    return url;
  }
  const publicUrl = process.env.MINIO_PUBLIC_URL;
  const endpoint = process.env.MINIO_ENDPOINT;
  if (!publicUrl || !endpoint) return url;
  const internalBase = endpoint.startsWith('http') ? endpoint : `http://${endpoint}`;
  return url.replace(publicUrl, internalBase);
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
    const { name, description } = req.body;

    if (!name || typeof name !== 'string') {
      throw new ValidationError('Session name is required');
    }

    const storage = await getStorageService();

    try {
      const session = await storage.createSession(name, description);
      logger.info('Session created', { sessionId: session.sessionId, name: session.name });
      res.status(201).json({ success: true, session });
    } catch (error: unknown) {
      const err = error as Error;
      if (err.message?.includes('already exists')) {
        throw new ConflictError(`Session with name "${name}" already exists for today. Use a different name.`);
      }
      throw error;
    }
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
   * GET /sessions/:sessionId/images/:hash/file - Proxy session image content
   * Streams the image through the API server so it works from any origin (ngrok, etc.)
   * Must be defined before /:sessionId/images to avoid route conflicts.
   */
  router.get('/:sessionId/images/:hash/file', asyncHandler(async (req, res) => {
    const { sessionId, hash } = req.params;
    const storage = await getStorageService();

    const session = await storage.getSession(sessionId);
    if (!session) {
      throw new NotFoundError(`Session not found: ${sessionId}`);
    }

    const images = await storage.listSessionImages(sessionId);
    const image = images.find(img => img.hash === hash);
    if (!image || !image.url) {
      throw new NotFoundError(`Image not found: ${hash}`);
    }

    const internalUrl = rewriteToInternal(image.url);
    const fetchResponse = await fetch(internalUrl);

    if (!fetchResponse.ok) {
      throw new NotFoundError(`Failed to fetch image: ${fetchResponse.status}`);
    }

    const contentType = fetchResponse.headers.get('content-type') || 'image/jpeg';
    const contentLength = fetchResponse.headers.get('content-length');

    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=3600');
    if (contentLength) res.set('Content-Length', contentLength);

    if (fetchResponse.body) {
      const nodeStream = Readable.fromWeb(fetchResponse.body as any);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
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

    // Rewrite URLs to use proxy endpoints instead of direct MinIO URLs
    const proxiedImages = images.map(img => ({
      ...img,
      url: `/api/v1/sessions/${sessionId}/images/${img.hash}/file`
    }));

    res.json({
      sessionId,
      images: proxiedImages,
      total: proxiedImages.length
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
   *
   * @body imageHashes - Array of image hashes to process (optional, processes all if not specified)
   * @body modelKey - Vision model to use (default: minicpm-v-ollama)
   * @body batchSize - Number of images to process in parallel (default: 5)
   * @body enableReview - Enable LLM self-review phase for quality control (default: false)
   *                      This adds an extra vision model call per image to verify extraction quality
   */
  router.post('/:sessionId/process', asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const {
      imageHashes,
      modelKey = 'minicpm-v-ollama',
      batchSize = 5,
      enableReview = false,  // Layer 2: LLM self-review (disabled by default for performance)
      consensus                // Consensus mode: { enabled, models, minAgreementRatio, parallel }
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

    const useConsensus = consensus?.enabled && Array.isArray(consensus.models) && consensus.models.length >= 2;

    logger.info('Processing session images', {
      sessionId,
      imageCount: images.length,
      modelKey,
      consensus: useConsensus ? { models: consensus.models, minAgreementRatio: consensus.minAgreementRatio } : false
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
              let posterEntity: PosterEntity;
              let consensusMeta: { modelsUsed: string[]; agreementScore: number } | undefined;

              if (useConsensus) {
                // Consensus mode: run multiple models and merge
                const consensusProcessor = new ConsensusProcessor({
                  models: consensus.models,
                  minAgreementRatio: consensus.minAgreementRatio ?? 0.5,
                  parallel: consensus.parallel ?? true,
                  modelTimeoutMs: consensus.modelTimeoutMs ?? 120000,
                });
                const consensusResult = await consensusProcessor.processWithConsensus(tempPath);

                if (!consensusResult.success || !consensusResult.entity) {
                  throw new Error('Consensus processing failed - no models returned results');
                }

                posterEntity = consensusResult.entity as PosterEntity;

                // ConsensusProcessor merges vision model outputs but doesn't set
                // required entity fields - set them here like PosterProcessor does
                posterEntity.name = posterEntity.name || `poster_${image.hash}`;
                posterEntity.entityType = 'Poster';

                consensusMeta = {
                  modelsUsed: consensusResult.modelsUsed,
                  agreementScore: consensusResult.agreementScore,
                };
                logger.info('Consensus result', {
                  hash: image.hash,
                  modelsUsed: consensusResult.modelsUsed,
                  agreementScore: consensusResult.agreementScore.toFixed(2),
                  overallConfidence: consensusResult.overallConfidence.toFixed(2),
                });
              } else {
                // Single model mode
                const processingResult = await processor.processImage(tempPath, { modelKey, skipStorage: true });

                if (!processingResult.success || !processingResult.entity) {
                  throw new Error(processingResult.error || 'Processing failed');
                }

                posterEntity = processingResult.entity;
              }

              // Clean and normalize the entity data with enhanced validation
              const { entity: cleanedEntity, extractionNotes, fieldConfidences, rejectedFields } = cleanPosterData(posterEntity);
              posterEntity = { ...posterEntity, ...cleanedEntity } as PosterEntity;

              // Log any extraction notes
              if (extractionNotes.length > 0) {
                logger.info('Extraction notes for image', {
                  hash: image.hash,
                  notes: extractionNotes
                });
              }

              // Log rejected fields (garbage data filtered out)
              if (Object.keys(rejectedFields).length > 0) {
                logger.warn('Fields rejected during validation', {
                  hash: image.hash,
                  rejectedFields
                });
              }

              // Log field confidences for debugging
              if (Object.keys(fieldConfidences).length > 0) {
                logger.debug('Field confidence scores', {
                  hash: image.hash,
                  fieldConfidences
                });
              }

              // Enrich with artist splitting and venue/date separation
              const enrichmentResult = await enrichPosterEntity(posterEntity);
              posterEntity = enrichmentResult.entity;

              // Log enrichment notes
              if (enrichmentResult.notes.length > 0) {
                logger.info('Enrichment notes for image', {
                  hash: image.hash,
                  notes: enrichmentResult.notes
                });
              }

              // Layer 2: LLM Self-Review (optional - enabled via request body)
              let reviewResult: ReviewResult | undefined;
              if (enableReview) {
                try {
                  logger.info('Running LLM self-review', { hash: image.hash });

                  const visionProvider = VisionModelFactory.createByName(modelKey);
                  reviewResult = await reviewExtractedData(
                    tempPath,
                    posterEntity,
                    visionProvider,
                    { autoCorrect: true, confidenceThreshold: 0.6 }
                  );

                  logger.info('LLM review complete', {
                    hash: image.hash,
                    passed: reviewResult.passed,
                    confidence: reviewResult.overallConfidence,
                    corrections: reviewResult.corrections.length,
                    flagged: reviewResult.flaggedForReview
                  });

                  // Apply corrections if review found issues
                  if (reviewResult.corrections.length > 0) {
                    posterEntity = applyCorrections(posterEntity, reviewResult) as PosterEntity;
                    logger.info('Applied corrections from review', {
                      hash: image.hash,
                      corrections: reviewResult.corrections.map(c => ({
                        field: c.field,
                        from: c.originalValue,
                        to: c.correctedValue
                      }))
                    });
                  }

                  // Check if we should proceed with entity creation
                  const processDecision = shouldProcessEntity(reviewResult);
                  if (!processDecision.shouldProcess) {
                    throw new Error(`Review rejected: ${processDecision.reason}`);
                  }
                } catch (reviewError) {
                  logger.warn('LLM review failed, continuing with pattern validation only', {
                    hash: image.hash,
                    error: reviewError instanceof Error ? reviewError.message : String(reviewError)
                  });
                  // Continue without review results
                }
              }

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
              if (posterEntity.extraction_notes) additionalObs.push(`Extraction notes: ${posterEntity.extraction_notes}`);

              if (additionalObs.length > 0) {
                await knowledgeGraphManager.addObservations([{
                  entityName: posterEntity.name,
                  contents: additionalObs
                }]);
              }

              // Create relationships (with Event entity support)
              await createPosterRelationshipsWithEvent(knowledgeGraphManager, posterEntity as EnrichedPosterEntity);

              // Move image to live folder
              await storage.moveToLive(sessionId, image.hash, posterEntity.name);

              // Store processing metadata
              const metadata: ProcessingResultMetadata = {
                hash: image.hash,
                entityName: posterEntity.name,
                title: posterEntity.title,
                extractedData: posterEntity as unknown as Record<string, unknown>,
                modelKey: modelKey,
                processedAt: new Date().toISOString(),
                sourceSessionId: sessionId
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
                processingTimeMs,
                ...(consensusMeta && { consensus: consensusMeta })
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

  /**
   * POST /sessions/:sessionId/reprocess - Reprocess images from a completed session
   *
   * Finds all live images that originated from this session, cleans up their
   * graph entities (poster, event, and orphaned artists/venues), copies the
   * images into a new session, and removes the live copies.
   */
  router.post('/:sessionId/reprocess', asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const storage = await getStorageService();

    // Verify session exists
    const session = await storage.getSession(sessionId);
    if (!session) {
      throw new NotFoundError(`Session not found: ${sessionId}`);
    }

    // Find all live images that originated from this session
    const liveImages = await storage.getLiveImagesBySession(sessionId);
    if (liveImages.length === 0) {
      throw new ValidationError('No processed images found for this session. Images may not have sourceSessionId metadata.');
    }

    logger.info('Starting reprocess', {
      sourceSessionId: sessionId,
      imageCount: liveImages.length,
      entityNames: liveImages.map(img => img.entityName)
    });

    // Step 1: Graph cleanup for each poster entity
    const cleanupResults: Array<{ entityName: string; deleted: string[]; errors: string[] }> = [];

    for (const img of liveImages) {
      const result = await cleanupPosterGraph(knowledgeGraphManager, img.entityName);
      cleanupResults.push(result);
    }

    // Step 2: Create a new session for reprocessing
    const newSessionName = `${session.name} (reprocess)`;
    let newSession: SessionInfo;
    try {
      newSession = await storage.createSession(newSessionName, `Reprocessing from session: ${sessionId}`);
    } catch (error: unknown) {
      // If session name already exists, add timestamp
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      newSession = await storage.createSession(
        `${session.name} (reprocess ${ts})`,
        `Reprocessing from session: ${sessionId}`
      );
    }

    // Step 3: Copy live images to the new session
    const hashes = liveImages.map(img => img.hash);
    await storage.copyLiveImagesToSession(hashes, newSession.sessionId);

    // Step 4: Remove the live copies
    await storage.removeLiveImagesByHash(hashes);

    // Refresh session info to get updated image count
    const updatedNewSession = await storage.getSession(newSession.sessionId);

    logger.info('Reprocess complete', {
      sourceSessionId: sessionId,
      newSessionId: newSession.sessionId,
      imagesCloned: hashes.length,
      graphCleanup: cleanupResults
    });

    res.json({
      success: true,
      sourceSessionId: sessionId,
      newSession: updatedNewSession || newSession,
      imagesCloned: hashes.length,
      graphCleanup: cleanupResults
    });
  }));

  /**
   * POST /sessions/:sessionId/repair-dates - Re-parse dates on existing posters
   *
   * Finds all live posters from this session whose extraction_notes contain
   * "Date could not be parsed", re-parses the raw date strings using improved
   * logic (ordinal stripping, multi-date splitting), updates the poster entity,
   * and creates/links missing Show entities. No vision model calls needed.
   */
  router.post('/:sessionId/repair-dates', asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const storage = await getStorageService();

    const session = await storage.getSession(sessionId);
    if (!session) {
      throw new NotFoundError(`Session not found: ${sessionId}`);
    }

    // Find all live images from this session
    const liveImages = await storage.getLiveImagesBySession(sessionId);
    if (liveImages.length === 0) {
      throw new ValidationError('No processed images found for this session');
    }

    logger.info('Starting date repair', { sessionId, imageCount: liveImages.length });

    const details: Array<{
      entityName: string;
      status: 'repaired' | 'skipped' | 'error';
      rawDate?: string;
      parsedDates?: string[];
      showsCreated?: number;
      message?: string;
    }> = [];
    let totalShowsCreated = 0;

    for (const image of liveImages) {
      const entityName = image.entityName;
      if (!entityName) {
        details.push({ entityName: image.hash, status: 'skipped', message: 'No entity name' });
        continue;
      }

      try {
        // Load the poster entity and its relationships
        const graph = await knowledgeGraphManager.openNodes([entityName]);
        const entity = graph.entities.find(e => e.name === entityName);
        if (!entity) {
          details.push({ entityName, status: 'skipped', message: 'Entity not found' });
          continue;
        }

        // Look for "Date could not be parsed" in observations
        const dateNote = entity.observations.find(obs =>
          obs.includes('Date could not be parsed:')
        );
        // Also check for the "Extraction notes:" prefixed variant
        const extractionNote = entity.observations.find(obs =>
          obs.includes('Extraction notes:') && obs.includes('Date could not be parsed:')
        );
        const noteToUse = dateNote || extractionNote;

        if (!noteToUse) {
          details.push({ entityName, status: 'skipped', message: 'No unparsed date found' });
          continue;
        }

        // Extract the raw date string from the note
        const rawDateMatch = noteToUse.match(/Date could not be parsed:\s*"([^"]+)"/);
        if (!rawDateMatch) {
          details.push({ entityName, status: 'skipped', message: 'Could not extract raw date from note' });
          continue;
        }

        const rawDate = rawDateMatch[1];

        // Split multi-date strings and normalize each
        const splitDates = splitMultiDateString(rawDate);
        const parsedDates: string[] = [];

        for (const { dateStr } of splitDates) {
          const normalized = normalizeDate(dateStr);
          if (normalized) {
            parsedDates.push(normalized);
          }
        }

        if (parsedDates.length === 0) {
          details.push({ entityName, status: 'skipped', rawDate, message: 'Still could not parse dates' });
          continue;
        }

        // Extract headliner, venue, year from existing observations
        const headliner = entity.observations.find(o => o.startsWith('Headliner:'))?.replace('Headliner: ', '').trim();
        const venueName = entity.observations.find(o => o.startsWith('Venue:'))?.replace('Venue: ', '').trim();
        const yearObs = entity.observations.find(o => o.startsWith('Year:'));
        const city = entity.observations.find(o => o.startsWith('City:'))?.replace('City: ', '').trim();
        const posterType = entity.observations.find(o => o.startsWith('Poster type:'))?.replace('Poster type: ', '').trim();
        let year = yearObs ? parseInt(yearObs.replace('Year: ', ''), 10) : null;

        // Try extracting year from the parsed dates if we don't have one
        if (!year) {
          for (const d of parsedDates) {
            const y = extractYear(d);
            if (y) { year = y; break; }
          }
        }
        // Try extracting from original raw date
        if (!year) {
          year = extractYear(rawDate);
        }

        // Find existing event entity connected to this poster
        const eventRel = graph.relations.find(r =>
          r.from === entityName && r.relationType === 'ADVERTISES_EVENT'
        );
        const eventName = eventRel?.to;

        // Create Show entities and relationships
        const artistSlug = headliner
          ? headliner.toLowerCase().replace(/[^a-z0-9]/g, '_')
          : 'unknown';
        const venueSlug = venueName
          ? venueName.toLowerCase().replace(/[^a-z0-9]/g, '_')
          : 'none';

        const now = Date.now();
        const relations: Relation[] = [];
        let showsCreated = 0;

        for (let i = 0; i < parsedDates.length; i++) {
          const parsedDate = parsedDates[i];
          const dateSlug = parsedDate.replace(/\//g, '-').replace(/[^a-z0-9-]/gi, '_').toLowerCase();
          const showId = `show_${artistSlug}_${venueSlug}_${dateSlug}`;

          const showObservations: string[] = [
            `Date: ${parsedDate}`,
            year ? `Year: ${year}` : '',
            headliner ? `Headliner: ${headliner}` : '',
            venueName ? `Venue: ${venueName}` : '',
            city ? `City: ${city}` : '',
            posterType ? `Type: ${posterType}` : '',
            parsedDates.length > 1 ? `Show ${i + 1} of ${parsedDates.length}` : '',
          ].filter(o => o);

          try {
            await knowledgeGraphManager.createEntities([{
              name: showId,
              entityType: 'Show',
              observations: showObservations,
            }]);
          } catch {
            // Entity might already exist
          }

          // Poster → ADVERTISES_SHOW → Show
          relations.push({
            from: entityName,
            to: showId,
            relationType: 'ADVERTISES_SHOW',
            metadata: { createdAt: now, updatedAt: now },
          });

          // Show → HELD_AT → Venue
          if (venueName) {
            const venueEntityName = `venue_${venueName.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
            relations.push({
              from: showId,
              to: venueEntityName,
              relationType: 'HELD_AT',
              metadata: { createdAt: now, updatedAt: now },
            });
          }

          // Headliner → PERFORMS_IN → Show
          if (headliner) {
            const headlinerEntityName = `artist_${headliner.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
            relations.push({
              from: headlinerEntityName,
              to: showId,
              relationType: 'PERFORMS_IN',
              metadata: { is_headliner: true, billing_order: 1, createdAt: now, updatedAt: now },
            });
          }

          // Show → PART_OF_EVENT → Event
          if (eventName) {
            relations.push({
              from: showId,
              to: eventName,
              relationType: 'PART_OF_EVENT',
              metadata: { createdAt: now, updatedAt: now },
            });
          }

          showsCreated++;
        }

        // Create all relations
        if (relations.length > 0) {
          try {
            await knowledgeGraphManager.createRelations(relations);
          } catch (error) {
            logger.warn('Failed to create some relations during date repair', { entityName, error });
          }
        }

        // Update poster observations: replace the failed note with repaired dates
        const repairedNote = `Date repaired: ${parsedDates.join(', ')} (from: "${rawDate}")`;
        try {
          // Add the repaired note
          await knowledgeGraphManager.addObservations([{
            entityName,
            contents: [
              repairedNote,
              `Event date: ${parsedDates[0]}`,
              ...(parsedDates.length > 1 ? [`Event dates: ${parsedDates.join(', ')}`] : []),
              ...(year ? [`Year: ${year}`] : []),
            ],
          }]);

          // Remove the old failure note
          await knowledgeGraphManager.deleteObservations([{
            entityName,
            observations: [noteToUse],
          }]);
        } catch (error) {
          logger.warn('Failed to update observations during date repair', { entityName, error });
        }

        totalShowsCreated += showsCreated;
        details.push({
          entityName,
          status: 'repaired',
          rawDate,
          parsedDates,
          showsCreated,
        });

        logger.info('Date repaired', { entityName, rawDate, parsedDates, showsCreated });
      } catch (error) {
        logger.error('Date repair error', { entityName, error });
        details.push({
          entityName,
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const repaired = details.filter(d => d.status === 'repaired').length;
    const skipped = details.filter(d => d.status === 'skipped').length;

    logger.info('Date repair complete', {
      sessionId,
      postersScanned: liveImages.length,
      repaired,
      skipped,
      totalShowsCreated,
    });

    res.json({
      success: true,
      postersScanned: liveImages.length,
      postersRepaired: repaired,
      postersSkipped: skipped,
      showsCreated: totalShowsCreated,
      details,
    });
  }));

  return router;
}

/**
 * Clean up graph entities for a poster being reprocessed.
 * Deletes the poster entity, its event, and any orphaned artists/venues.
 */
async function cleanupPosterGraph(
  knowledgeGraphManager: KnowledgeGraphManager,
  posterEntityName: string
): Promise<{ entityName: string; deleted: string[]; errors: string[] }> {
  const deleted: string[] = [];
  const errors: string[] = [];

  try {
    // Get all relationships for this poster
    const graph = await knowledgeGraphManager.openNodes([posterEntityName]);
    if (graph.entities.length === 0) {
      errors.push(`Poster entity not found: ${posterEntityName}`);
      return { entityName: posterEntityName, deleted, errors };
    }

    // Collect connected entity names by relationship type
    const connectedEntities: Array<{ name: string; relationType: string }> = [];

    for (const rel of graph.relations) {
      if (rel.from === posterEntityName) {
        connectedEntities.push({ name: rel.to, relationType: rel.relationType });
      }
      if (rel.to === posterEntityName) {
        connectedEntities.push({ name: rel.from, relationType: rel.relationType });
      }
    }

    // Find the event entity (connected via ADVERTISES_EVENT)
    const eventEntity = connectedEntities.find(e => e.relationType === 'ADVERTISES_EVENT');

    // Find Show entities (connected via ADVERTISES_SHOW)
    const showEntities = connectedEntities.filter(e => e.relationType === 'ADVERTISES_SHOW');

    // If there's an event, get its relationships too to find connected artists/venues through the event
    let eventRelatedEntities: Array<{ name: string; relationType: string }> = [];
    if (eventEntity) {
      const eventGraph = await knowledgeGraphManager.openNodes([eventEntity.name]);
      for (const rel of eventGraph.relations) {
        if (rel.from === eventEntity.name && rel.from !== posterEntityName) {
          eventRelatedEntities.push({ name: rel.to, relationType: rel.relationType });
        }
        if (rel.to === eventEntity.name && rel.from !== posterEntityName) {
          eventRelatedEntities.push({ name: rel.from, relationType: rel.relationType });
        }
      }
    }

    // Get relationships through Show entities too
    const showRelatedEntities: Array<{ name: string; relationType: string }> = [];
    for (const showEntity of showEntities) {
      try {
        const showGraph = await knowledgeGraphManager.openNodes([showEntity.name]);
        for (const rel of showGraph.relations) {
          if (rel.from === showEntity.name && rel.from !== posterEntityName) {
            showRelatedEntities.push({ name: rel.to, relationType: rel.relationType });
          }
          if (rel.to === showEntity.name && rel.from !== posterEntityName) {
            showRelatedEntities.push({ name: rel.from, relationType: rel.relationType });
          }
        }
      } catch {
        // Show entity may not exist
      }
    }

    // Delete the poster entity first (this also removes its relationships)
    await knowledgeGraphManager.deleteEntities([posterEntityName]);
    deleted.push(posterEntityName);

    // Delete the event entity if it exists
    if (eventEntity) {
      await knowledgeGraphManager.deleteEntities([eventEntity.name]);
      deleted.push(eventEntity.name);
    }

    // Delete Show entities
    for (const showEntity of showEntities) {
      try {
        await knowledgeGraphManager.deleteEntities([showEntity.name]);
        deleted.push(showEntity.name);
      } catch {
        // Already deleted
      }
    }

    // Check artists and venues for orphan status (no remaining relationships)
    // Combine entities connected directly to poster, through event, and through shows
    const deletedNames = new Set([posterEntityName, eventEntity?.name, ...showEntities.map(s => s.name)].filter(Boolean) as string[]);
    const candidateOrphans = new Set<string>();
    for (const e of connectedEntities) {
      if (e.relationType !== 'ADVERTISES_EVENT' && e.relationType !== 'ADVERTISES_SHOW' && e.relationType !== 'HAS_TYPE') {
        candidateOrphans.add(e.name);
      }
    }
    for (const e of eventRelatedEntities) {
      candidateOrphans.add(e.name);
    }
    for (const e of showRelatedEntities) {
      candidateOrphans.add(e.name);
    }

    // Check each candidate for orphan status
    for (const entityName of candidateOrphans) {
      try {
        const entityGraph = await knowledgeGraphManager.openNodes([entityName]);

        if (entityGraph.entities.length === 0) {
          // Already deleted (maybe by cascading delete)
          continue;
        }

        // Count remaining relationships (after poster, event, and shows were deleted)
        const remainingRelations = entityGraph.relations.filter(
          r => !deletedNames.has(r.from) && !deletedNames.has(r.to)
        );

        if (remainingRelations.length === 0) {
          // Orphaned - delete it
          await knowledgeGraphManager.deleteEntities([entityName]);
          deleted.push(entityName);
        }
      } catch (err) {
        errors.push(`Failed to check orphan status of ${entityName}: ${err}`);
      }
    }
  } catch (err) {
    errors.push(`Failed to clean up graph for ${posterEntityName}: ${err}`);
  }

  return { entityName: posterEntityName, deleted, errors };
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
      const typeName = `PosterType_${typeInference.type_key}`;

      // Verify the PosterType entity exists before creating relationship
      try {
        const typeResult = await knowledgeGraphManager.openNodes([typeName]);

        if (typeResult.entities.length === 0) {
          // PosterType doesn't exist - force re-seed
          logger.warn(`PosterType entity ${typeName} not found, triggering re-seed`);
          await ensurePosterTypesSeeded(knowledgeGraphManager, true);
        }
      } catch (e) {
        logger.warn(`Failed to verify PosterType ${typeName} exists`, { error: e });
      }

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

// ============================================================================
// Enrichment Functions
// ============================================================================

interface EnrichedPosterEntity extends PosterEntity {
  /** Validated artists (enriched from splitter) */
  validatedArtists?: ValidatedArtist[];
  /** Whether artists were split from concatenated text */
  artistsWereSplit?: boolean;
  /** Event entity name (if created) */
  eventEntityName?: string;
}

interface EnrichmentResult {
  entity: EnrichedPosterEntity;
  notes: string[];
}

/**
 * Enrich a poster entity with:
 * - Split and validated artists
 * - Separated venue/date fields
 */
async function enrichPosterEntity(entity: PosterEntity): Promise<EnrichmentResult> {
  const notes: string[] = [];
  const enriched: EnrichedPosterEntity = { ...entity };
  const splitter = getArtistSplitter();

  // Step 1: Split and validate headliner
  if (entity.headliner) {
    try {
      const headlinerResult = await splitter.splitAndValidate(entity.headliner);

      if (headlinerResult.wasConcatenated) {
        notes.push(`Headliner was concatenated: "${entity.headliner}" → ${headlinerResult.artists.length} artists`);
        enriched.artistsWereSplit = true;

        // Use first validated artist as headliner, rest become supporting acts
        if (headlinerResult.artists.length > 0) {
          const primary = headlinerResult.artists[0];
          enriched.headliner = primary.canonicalName ?? primary.name;

          // Add remaining to supporting acts
          const additionalActs = headlinerResult.artists.slice(1).map(a => a.canonicalName ?? a.name);
          enriched.supporting_acts = [
            ...additionalActs,
            ...(enriched.supporting_acts || [])
          ];
        }

        enriched.validatedArtists = headlinerResult.artists;
      } else if (headlinerResult.artists.length > 0 && headlinerResult.artists[0].canonicalName) {
        // Single artist validated - use canonical name
        const validated = headlinerResult.artists[0];
        if (validated.canonicalName !== entity.headliner) {
          notes.push(`Headliner validated: "${entity.headliner}" → "${validated.canonicalName}"`);
          enriched.headliner = validated.canonicalName;
        }
        enriched.validatedArtists = [validated];
      }
    } catch (error) {
      logger.warn('Failed to split/validate headliner', { headliner: entity.headliner, error });
    }
  }

  // Step 2: Split and validate supporting acts
  if (entity.supporting_acts?.length) {
    try {
      const actsResult = await splitAndValidateArtists(entity.supporting_acts, splitter);

      if (actsResult.anyConcatenated) {
        notes.push(`Supporting acts were concatenated, split into ${actsResult.artists.length} artists`);
        enriched.artistsWereSplit = true;
      }

      // Update supporting_acts with validated/split names
      enriched.supporting_acts = actsResult.artists.map(a => a.canonicalName ?? a.name);

      // Merge validated artists
      enriched.validatedArtists = [
        ...(enriched.validatedArtists || []),
        ...actsResult.artists
      ];

      // Deduplicate by name
      const seen = new Set<string>();
      enriched.validatedArtists = enriched.validatedArtists.filter(a => {
        const key = (a.canonicalName ?? a.name).toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    } catch (error) {
      logger.warn('Failed to split/validate supporting acts', { error });
    }
  }

  // Step 3: Split venue/date if venue contains date information
  if (entity.venue_name) {
    const venueDateResult = splitVenueDate(entity.venue_name);

    if (venueDateResult.wasMixed) {
      notes.push(`Venue contained date: "${entity.venue_name}" → venue="${venueDateResult.venue}", date="${venueDateResult.date}"`);

      enriched.venue_name = venueDateResult.venue;

      // Merge date into event_date if not already set
      if (venueDateResult.date && !enriched.event_date) {
        enriched.event_date = venueDateResult.date;
      }

      // Merge year if extracted
      if (venueDateResult.year && !enriched.year) {
        enriched.year = venueDateResult.year;
        enriched.decade = `${Math.floor(venueDateResult.year / 10) * 10}s`;
      }
    }
  }

  // Step 4: Generate event entity name for event-based posters
  const eventTypes = ['concert', 'festival', 'comedy', 'theater'];
  if (enriched.poster_type && eventTypes.includes(enriched.poster_type)) {
    enriched.eventEntityName = generateEventName(enriched);
  }

  return { entity: enriched, notes };
}

/**
 * Generate a unique event entity name from poster data
 */
function generateEventName(entity: PosterEntity): string {
  const parts: string[] = [];

  // Use tour name if available, otherwise headliner
  if (entity.tour_name) {
    parts.push(entity.tour_name);
  } else if (entity.headliner) {
    parts.push(entity.headliner);
  }

  // Add venue if available
  if (entity.venue_name) {
    parts.push('at');
    parts.push(entity.venue_name);
  }

  // Add date if available
  if (entity.event_date) {
    parts.push(entity.event_date.replace(/\//g, '-'));
  } else if (entity.year) {
    parts.push(String(entity.year));
  }

  // Generate slug
  const slug = parts
    .join('_')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');

  return `event_${slug || 'unknown'}`;
}

/**
 * Create relationships for a poster entity (extended version with Event support)
 */
async function createPosterRelationshipsWithEvent(
  knowledgeGraphManager: KnowledgeGraphManager,
  entity: EnrichedPosterEntity
): Promise<void> {
  const relations: Relation[] = [];
  const now = Date.now();

  // Step 1: Create Event entity if applicable
  let eventName: string | null = null;
  const eventTypes = ['concert', 'festival', 'comedy', 'theater'];

  if (entity.poster_type && eventTypes.includes(entity.poster_type)) {
    eventName = entity.eventEntityName ?? generateEventName(entity);

    try {
      const eventObservations: string[] = [];
      if (entity.tour_name) eventObservations.push(`Tour: ${entity.tour_name}`);
      if (entity.event_date) eventObservations.push(`Date: ${entity.event_date}`);
      if (entity.door_time) eventObservations.push(`Doors: ${entity.door_time}`);
      if (entity.show_time) eventObservations.push(`Show: ${entity.show_time}`);
      if (entity.ticket_price) eventObservations.push(`Tickets: ${entity.ticket_price}`);
      if (entity.age_restriction) eventObservations.push(`Age: ${entity.age_restriction}`);

      await knowledgeGraphManager.createEntities([{
        name: eventName,
        entityType: 'Event',
        observations: eventObservations.length > 0 ? eventObservations : ['Event created from poster']
      }]);

      logger.info('Created Event entity', { eventName, posterType: entity.poster_type });
    } catch {
      // Entity might already exist
    }

    // Poster → ADVERTISES_EVENT → Event
    relations.push({
      from: entity.name,
      to: eventName,
      relationType: 'ADVERTISES_EVENT',
      metadata: {
        confidence: 0.9,
        source: 'vision',
        is_primary: true,
        createdAt: now,
        updatedAt: now
      }
    });
  }

  // Step 2: Create Artist entities and relationships
  // Use validated artists if available, otherwise fall back to original data
  // ONLY create entities if confidence is above threshold
  const headlinerArtists: ValidatedArtist[] = [];
  const supportingArtists: ValidatedArtist[] = [];

  if (entity.validatedArtists && entity.validatedArtists.length > 0) {
    // First validated artist is headliner
    headlinerArtists.push(entity.validatedArtists[0]);
    // Rest are supporting
    supportingArtists.push(...entity.validatedArtists.slice(1));
  } else {
    // Fall back to original data - but only if headliner is not null/empty
    // (cleanPosterData will have set it to null if it was invalid)
    if (entity.headliner) {
      headlinerArtists.push({
        name: entity.headliner,
        confidence: 0.5,
        source: 'internal'
      });
    }
    if (entity.supporting_acts) {
      for (const act of entity.supporting_acts) {
        supportingArtists.push({
          name: act,
          confidence: 0.5,
          source: 'internal'
        });
      }
    }
  }

  // Create headliner entities and relations - ONLY if confidence meets threshold
  for (const artist of headlinerArtists) {
    // GATE: Skip entity creation if confidence is too low
    if (artist.confidence < ENTITY_CREATION_CONFIDENCE_THRESHOLD) {
      logger.info('Skipping Artist entity creation - low confidence', {
        posterName: entity.name,
        artistName: artist.name,
        confidence: artist.confidence,
        threshold: ENTITY_CREATION_CONFIDENCE_THRESHOLD
      });
      continue;
    }

    const artistEntityName = `artist_${(artist.canonicalName ?? artist.name).toLowerCase().replace(/[^a-z0-9]/g, '_')}`;

    try {
      const artistObs: string[] = [`Artist name: ${artist.canonicalName ?? artist.name}`];
      if (artist.externalId) artistObs.push(`MusicBrainz ID: ${artist.externalId}`);
      if (artist.externalUrl) artistObs.push(`External URL: ${artist.externalUrl}`);

      await knowledgeGraphManager.createEntities([{
        name: artistEntityName,
        entityType: 'Artist',
        observations: artistObs
      }]);

      logger.debug('Created Artist entity', { artistEntityName, confidence: artist.confidence });
    } catch {
      // Entity might already exist
    }

    // Only create relationships if confidence meets relationship threshold
    if (artist.confidence >= RELATIONSHIP_CONFIDENCE_THRESHOLD) {
      // Poster → HEADLINED_ON → Artist
      relations.push({
        from: entity.name,
        to: artistEntityName,
        relationType: 'HEADLINED_ON',
        metadata: {
          confidence: artist.confidence,
          source: artist.source,
          is_primary: true,
          createdAt: now,
          updatedAt: now
        }
      });

      // Artist → HEADLINED → Event (if event exists)
      if (eventName) {
        relations.push({
          from: artistEntityName,
          to: eventName,
          relationType: 'HEADLINED',
          metadata: {
            confidence: artist.confidence,
            source: artist.source,
            is_primary: true,
            createdAt: now,
            updatedAt: now
          }
        });
      }
    }
  }

  // Create supporting artist entities and relations - ONLY if confidence meets threshold
  for (const artist of supportingArtists) {
    // GATE: Skip entity creation if confidence is too low
    if (artist.confidence < ENTITY_CREATION_CONFIDENCE_THRESHOLD) {
      logger.info('Skipping supporting Artist entity creation - low confidence', {
        posterName: entity.name,
        artistName: artist.name,
        confidence: artist.confidence,
        threshold: ENTITY_CREATION_CONFIDENCE_THRESHOLD
      });
      continue;
    }

    const artistEntityName = `artist_${(artist.canonicalName ?? artist.name).toLowerCase().replace(/[^a-z0-9]/g, '_')}`;

    try {
      const artistObs: string[] = [`Artist name: ${artist.canonicalName ?? artist.name}`];
      if (artist.externalId) artistObs.push(`MusicBrainz ID: ${artist.externalId}`);
      if (artist.externalUrl) artistObs.push(`External URL: ${artist.externalUrl}`);

      await knowledgeGraphManager.createEntities([{
        name: artistEntityName,
        entityType: 'Artist',
        observations: artistObs
      }]);

      logger.debug('Created supporting Artist entity', { artistEntityName, confidence: artist.confidence });
    } catch {
      // Entity might already exist
    }

    // Only create relationships if confidence meets relationship threshold
    if (artist.confidence >= RELATIONSHIP_CONFIDENCE_THRESHOLD) {
      // Poster → PERFORMED_ON → Artist
      relations.push({
        from: entity.name,
        to: artistEntityName,
        relationType: 'PERFORMED_ON',
        metadata: {
          confidence: artist.confidence,
          source: artist.source,
          is_primary: false,
          createdAt: now,
          updatedAt: now
        }
      });

      // Artist → PERFORMED_AT → Event (if event exists)
      if (eventName) {
        relations.push({
          from: artistEntityName,
          to: eventName,
          relationType: 'PERFORMED_AT',
          metadata: {
            confidence: artist.confidence,
            source: artist.source,
            is_primary: false,
            createdAt: now,
            updatedAt: now
          }
        });
      }
    }
  }

  // Step 3: Create venue and Event→Venue relation
  // NOTE: entity.venue_name will be null if cleanPosterData rejected it as invalid
  // This means we only reach here if the venue passed validation
  if (entity.venue_name) {
    const venueName = `venue_${entity.venue_name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;

    // Use default venue confidence (could be enhanced with validation result)
    const venueConfidence = 0.8;

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

      logger.debug('Created Venue entity', { venueName, confidence: venueConfidence });
    } catch {
      // Entity might already exist
    }

    // Poster → ADVERTISES_VENUE → Venue
    relations.push({
      from: entity.name,
      to: venueName,
      relationType: 'ADVERTISES_VENUE',
      metadata: {
        confidence: venueConfidence,
        source: 'vision',
        is_primary: true,
        createdAt: now,
        updatedAt: now
      }
    });

    // Event → HELD_AT → Venue (if event exists)
    if (eventName) {
      relations.push({
        from: eventName,
        to: venueName,
        relationType: 'HELD_AT',
        metadata: {
          confidence: venueConfidence,
          source: 'vision',
          is_primary: true,
          createdAt: now,
          updatedAt: now
        }
      });
    }
  } else {
    // Venue was either not extracted or rejected during validation
    logger.debug('No valid venue to create entity for', { posterName: entity.name });
  }

  // Step 4: Create HAS_TYPE relations for inferred_types
  if (entity.inferred_types?.length) {
    for (const typeInference of entity.inferred_types) {
      const typeName = `PosterType_${typeInference.type_key}`;

      // Verify the PosterType entity exists before creating relationship
      try {
        const typeResult = await knowledgeGraphManager.openNodes([typeName]);

        if (typeResult.entities.length === 0) {
          // PosterType doesn't exist - force re-seed
          logger.warn(`PosterType entity ${typeName} not found, triggering re-seed`);
          await ensurePosterTypesSeeded(knowledgeGraphManager, true);
        }
      } catch (e) {
        logger.warn(`Failed to verify PosterType ${typeName} exists`, { error: e });
      }

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

  // Step 5: Create Show entities for temporal searchability
  const year = entity.year;
  if (year || entity.event_date) {
    const artistSlug = entity.headliner
      ? entity.headliner.toLowerCase().replace(/[^a-z0-9]/g, '_')
      : 'unknown';
    const venueSlug = entity.venue_name
      ? entity.venue_name.toLowerCase().replace(/[^a-z0-9]/g, '_')
      : 'none';

    // Parse multiple dates from event_dates or fall back to event_date
    const dateSlugs: Array<{ slug: string; rawDate: string; dayOfWeek?: string }> = [];

    if (entity.event_dates && entity.event_dates.length > 0) {
      for (const d of entity.event_dates) {
        const slug = d.replace(/\//g, '-').replace(/[^a-z0-9-]/gi, '_').toLowerCase();
        dateSlugs.push({ slug, rawDate: d });
      }
    } else if (entity.event_date) {
      const slug = entity.event_date.replace(/\//g, '-').replace(/[^a-z0-9-]/gi, '_').toLowerCase();
      dateSlugs.push({ slug, rawDate: entity.event_date });
    } else if (year) {
      dateSlugs.push({ slug: String(year), rawDate: String(year) });
    }

    for (let i = 0; i < dateSlugs.length; i++) {
      const { slug: dateSlug, rawDate } = dateSlugs[i];
      const showId = `show_${artistSlug}_${venueSlug}_${dateSlug}`;

      const showObservations: string[] = [
        `Date: ${rawDate}`,
        year ? `Year: ${year}` : '',
        entity.headliner ? `Headliner: ${entity.headliner}` : '',
        entity.venue_name ? `Venue: ${entity.venue_name}` : '',
        entity.city ? `City: ${entity.city}` : '',
        entity.poster_type ? `Type: ${entity.poster_type}` : '',
        dateSlugs.length > 1 ? `Show ${i + 1} of ${dateSlugs.length}` : '',
      ].filter(o => o);

      try {
        await knowledgeGraphManager.createEntities([{
          name: showId,
          entityType: 'Show',
          observations: showObservations,
        }]);
      } catch {
        // Entity might already exist
      }

      // Poster → ADVERTISES_SHOW → Show
      relations.push({
        from: entity.name,
        to: showId,
        relationType: 'ADVERTISES_SHOW',
        metadata: { createdAt: now, updatedAt: now },
      });

      // Show → HELD_AT → Venue
      if (entity.venue_name) {
        const venueEntityName = `venue_${entity.venue_name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
        relations.push({
          from: showId,
          to: venueEntityName,
          relationType: 'HELD_AT',
          metadata: { createdAt: now, updatedAt: now },
        });
      }

      // Headliner → PERFORMS_IN → Show
      if (entity.headliner) {
        const headlinerEntityName = `artist_${entity.headliner.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
        relations.push({
          from: headlinerEntityName,
          to: showId,
          relationType: 'PERFORMS_IN',
          metadata: { is_headliner: true, billing_order: 1, createdAt: now, updatedAt: now },
        });
      }

      // Show → PART_OF_EVENT → Event
      if (eventName) {
        relations.push({
          from: showId,
          to: eventName,
          relationType: 'PART_OF_EVENT',
          metadata: { createdAt: now, updatedAt: now },
        });
      }
    }
  }

  // Create all relations
  if (relations.length > 0) {
    try {
      await knowledgeGraphManager.createRelations(relations);
      logger.info('Created relationships', {
        posterName: entity.name,
        eventName,
        relationCount: relations.length
      });
    } catch (error) {
      logger.warn('Failed to create some relations', { error });
    }
  }
}
