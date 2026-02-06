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
import { asyncHandler, ValidationError, NotFoundError, ConflictError } from '../middleware/errorHandler.js';
import { createImageStorageFromEnv, ImageStorageService } from '../../image-processor/ImageStorageService.js';
import { createPosterProcessor, PosterProcessor } from '../../image-processor/PosterProcessor.js';
import { KnowledgeGraphManager, type Relation } from '../../KnowledgeGraphManager.js';
import { logger } from '../../utils/logger.js';
import { ensurePosterTypesSeeded } from '../../utils/ensurePosterTypes.js';
import { cleanPosterData } from '../../image-processor/utils/posterDataCleaner.js';
import { ArtistSplitter, type ValidatedArtist, splitAndValidateArtists } from '../../image-processor/utils/artistSplitter.js';
import { splitVenueDate } from '../../image-processor/utils/venueDateSplitter.js';
import { MusicBrainzClient } from '../../qa-validation/clients/MusicBrainzClient.js';
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

    try {
      const session = await storage.createSession(name);
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
      modelKey = 'minicpm-v-ollama',
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

              let posterEntity = processingResult.entity;

              // Clean and normalize the entity data
              const { entity: cleanedEntity, extractionNotes } = cleanPosterData(posterEntity);
              posterEntity = { ...posterEntity, ...cleanedEntity } as PosterEntity;

              // Log any extraction notes
              if (extractionNotes.length > 0) {
                logger.info('Extraction notes for image', {
                  hash: image.hash,
                  notes: extractionNotes
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
  const headlinerArtists: ValidatedArtist[] = [];
  const supportingArtists: ValidatedArtist[] = [];

  if (entity.validatedArtists && entity.validatedArtists.length > 0) {
    // First validated artist is headliner
    headlinerArtists.push(entity.validatedArtists[0]);
    // Rest are supporting
    supportingArtists.push(...entity.validatedArtists.slice(1));
  } else {
    // Fall back to original data
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

  // Create headliner entities and relations
  for (const artist of headlinerArtists) {
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
    } catch {
      // Entity might already exist
    }

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

  // Create supporting artist entities and relations
  for (const artist of supportingArtists) {
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
    } catch {
      // Entity might already exist
    }

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

  // Step 3: Create venue and Event→Venue relation
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

    // Poster → ADVERTISES_VENUE → Venue
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

    // Event → HELD_AT → Venue (if event exists)
    if (eventName) {
      relations.push({
        from: eventName,
        to: venueName,
        relationType: 'HELD_AT',
        metadata: {
          confidence: 0.8,
          source: 'vision',
          is_primary: true,
          createdAt: now,
          updatedAt: now
        }
      });
    }
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
