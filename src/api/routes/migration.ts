/**
 * Migration Routes
 *
 * Endpoints for migrating existing flat S3 structure to the new session/live folder structure.
 *
 * Existing structure:
 *   - originals/{hash}-{filename}
 *   - processed/{hash}-result.json
 *
 * New structure:
 *   - live/images/{hash}-{filename}    (one per KG entity)
 *   - live/metadata/{hash}.json        (processing results)
 *   - sessions/{sessionId}/images/     (staging for unprocessed images)
 */

import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { createImageStorageFromEnv, ImageStorageService } from '../../image-processor/ImageStorageService.js';
import { EntityService } from '../../core/services/EntityService.js';
import { logger } from '../../utils/logger.js';

// Cache storage service instance
let storageServiceInstance: ImageStorageService | null = null;

async function getStorageService(): Promise<ImageStorageService> {
  if (!storageServiceInstance) {
    storageServiceInstance = createImageStorageFromEnv();
    await storageServiceInstance.initialize();
  }
  return storageServiceInstance;
}

export interface MigrationResult {
  totalImages: number;
  migratedToLive: number;
  movedToLegacySession: number;
  alreadyInLive: number;
  errors: Array<{ hash: string; error: string }>;
  legacySessionId?: string;
}

/**
 * Create migration routes
 */
export function createMigrationRoutes(entityService: EntityService): Router {
  const router = Router();

  /**
   * GET /migration/status - Check migration status
   *
   * Returns counts of images in old vs new structure
   */
  router.get('/status', asyncHandler(async (_req, res) => {
    const storage = await getStorageService();

    // Count images in old structure
    const oldImages = await storage.listImages({ prefix: 'originals/', limit: 10000 });

    // Count images in live folder
    const liveImages = await storage.listLiveImages();

    // Count images in sessions
    const sessions = await storage.listSessions();
    let sessionImageCount = 0;
    for (const session of sessions) {
      sessionImageCount += session.imageCount;
    }

    // Check for legacy session
    let legacySession = null;
    try {
      legacySession = await storage.getSession('legacy');
    } catch {
      // Legacy session doesn't exist
    }

    res.json({
      status: {
        oldStructure: {
          originalsCount: oldImages.totalFiles,
          needsMigration: oldImages.totalFiles > 0
        },
        newStructure: {
          liveImagesCount: liveImages.length,
          sessionsCount: sessions.length,
          sessionImagesCount: sessionImageCount,
          legacySessionExists: !!legacySession,
          legacySessionImages: legacySession?.imageCount || 0
        }
      },
      message: oldImages.totalFiles > 0
        ? `Found ${oldImages.totalFiles} images in old structure that can be migrated`
        : 'No images in old structure - migration not needed or already complete'
    });
  }));

  /**
   * POST /migration/preview - Preview migration (dry run)
   *
   * Shows what would happen without making changes
   */
  router.post('/preview', asyncHandler(async (_req, res) => {
    const storage = await getStorageService();

    // Get all images in old structure
    const oldImages = await storage.listImages({ prefix: 'originals/', limit: 10000 });

    const preview = {
      wouldMigrateToLive: [] as Array<{ hash: string; filename: string; entityName: string }>,
      wouldMoveToLegacy: [] as Array<{ hash: string; filename: string }>,
      alreadyInLive: [] as Array<{ hash: string; filename: string }>
    };

    for (const img of oldImages.files) {
      // Check if already in live
      const inLive = await storage.liveImageExists(img.hash);
      if (inLive) {
        preview.alreadyInLive.push({ hash: img.hash, filename: img.filename });
        continue;
      }

      // Check if entity exists in knowledge graph
      const entityName = await findEntityByImageHash(entityService, img.hash);

      if (entityName) {
        preview.wouldMigrateToLive.push({ hash: img.hash, filename: img.filename, entityName });
      } else {
        preview.wouldMoveToLegacy.push({ hash: img.hash, filename: img.filename });
      }
    }

    res.json({
      totalImages: oldImages.totalFiles,
      wouldMigrateToLive: preview.wouldMigrateToLive.length,
      wouldMoveToLegacy: preview.wouldMoveToLegacy.length,
      alreadyInLive: preview.alreadyInLive.length,
      details: preview
    });
  }));

  /**
   * POST /migration/execute - Execute migration
   *
   * Migrates all images from old structure to new structure:
   * - Images with entities → live folder
   * - Orphaned images → legacy session
   */
  router.post('/execute', asyncHandler(async (_req, res) => {
    const storage = await getStorageService();

    const result: MigrationResult = {
      totalImages: 0,
      migratedToLive: 0,
      movedToLegacySession: 0,
      alreadyInLive: 0,
      errors: []
    };

    // Get all images in old structure
    const oldImages = await storage.listImages({ prefix: 'originals/', limit: 10000 });
    result.totalImages = oldImages.totalFiles;

    logger.info('Starting migration', { totalImages: result.totalImages });

    // Create legacy session for orphaned images (if needed)
    let legacySessionCreated = false;

    for (const img of oldImages.files) {
      try {
        // Check if already in live
        const inLive = await storage.liveImageExists(img.hash);
        if (inLive) {
          result.alreadyInLive++;
          logger.debug('Image already in live', { hash: img.hash });
          continue;
        }

        // Check if entity exists in knowledge graph
        const entityName = await findEntityByImageHash(entityService, img.hash);

        if (entityName) {
          // Migrate to live folder
          await migrateToLive(storage, img, entityName);
          result.migratedToLive++;
          logger.info('Migrated to live', { hash: img.hash, entityName });
        } else {
          // Move to legacy session
          if (!legacySessionCreated) {
            try {
              await storage.createSession('Legacy Import');
              legacySessionCreated = true;
              result.legacySessionId = 'legacy';
            } catch (e: unknown) {
              const error = e as { message?: string };
              // Session might already exist
              if (!error.message?.includes('already exists')) {
                throw e;
              }
              result.legacySessionId = 'legacy';
            }
          }

          await moveToLegacySession(storage, img);
          result.movedToLegacySession++;
          logger.info('Moved to legacy session', { hash: img.hash });
        }
      } catch (error: unknown) {
        const err = error as { message?: string };
        result.errors.push({ hash: img.hash, error: err.message || 'Unknown error' });
        logger.error('Migration error', { hash: img.hash, error: err.message });
      }
    }

    logger.info('Migration complete', result);

    res.json({
      success: true,
      result,
      message: `Migration complete: ${result.migratedToLive} to live, ${result.movedToLegacySession} to legacy, ${result.alreadyInLive} already migrated, ${result.errors.length} errors`
    });
  }));

  /**
   * POST /migration/cleanup - Clean up old structure after successful migration
   *
   * Removes empty originals/ and processed/ folders
   */
  router.post('/cleanup', asyncHandler(async (_req, res) => {
    const storage = await getStorageService();

    // Check if migration is complete
    const oldImages = await storage.listImages({ prefix: 'originals/', limit: 1 });

    if (oldImages.totalFiles > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot cleanup: ${oldImages.totalFiles} images still in old structure. Run migration first.`
      });
    }

    // Note: We don't actually delete the folders since S3/MinIO doesn't have real folders
    // The "originals/" prefix will just have no objects under it

    res.json({
      success: true,
      message: 'Old structure is empty. No cleanup needed - S3 folders are virtual.'
    });
  }));

  return router;
}

/**
 * Find an entity by its imageHash attribute
 * Observations are stored as strings like "imageHash: abc123" or "image_hash: abc123"
 */
async function findEntityByImageHash(entityService: EntityService, hash: string): Promise<string | null> {
  try {
    // Search for entities with this image hash
    const results = await entityService.searchEntities(hash, {
      entityTypes: ['Poster'],
      limit: 20
    });

    // Look for exact match on imageHash in observations (which are strings)
    const entities = results.data?.entities || [];
    for (const entity of entities) {
      // Check if any observation contains the hash
      const hasHashObservation = entity.observations?.some((obs: string) => {
        // Observations might be stored as "imageHash: xyz" or "image_hash: xyz"
        return obs.includes(`imageHash: ${hash}`) ||
               obs.includes(`image_hash: ${hash}`) ||
               obs.includes(`imageHash:${hash}`) ||
               obs === hash;
      });

      if (hasHashObservation) {
        return entity.name;
      }

      // Also check if entity name contains the hash (common naming pattern)
      if (entity.name.includes(hash)) {
        return entity.name;
      }
    }

    return null;
  } catch (error) {
    logger.warn('Error finding entity by image hash', { hash, error });
    return null;
  }
}

/**
 * Migrate an image from originals/ to live/images/
 */
async function migrateToLive(
  storage: ImageStorageService,
  img: { key: string; hash: string; filename: string },
  entityName: string
): Promise<void> {
  // Download from old location
  const tempPath = await storage.downloadToTemp(img.key);

  try {
    const fs = await import('fs');
    const fileBuffer = fs.readFileSync(tempPath);

    // Get mime type
    const path = await import('path');
    const ext = path.extname(img.filename).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp'
    };
    const mimeType = mimeTypes[ext] || 'application/octet-stream';

    // Upload to live folder
    const liveKey = `live/images/${img.hash}-${img.filename}`;

    // Access the internal minio client through a method we'll use
    const Client = await import('minio');
    const minioConfig = {
      endPoint: process.env.MINIO_ENDPOINT?.split(':')[0] || 'localhost',
      port: parseInt(process.env.MINIO_ENDPOINT?.split(':')[1] || '9000'),
      useSSL: false,
      accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
      secretKey: process.env.MINIO_SECRET_KEY || process.env.MINIO_PASSWORD || 'poster-memento-minio'
    };
    const minio = new Client.Client(minioConfig);
    const bucket = process.env.MINIO_BUCKET || 'poster-images';

    await minio.putObject(bucket, liveKey, fileBuffer, fileBuffer.length, {
      'Content-Type': mimeType,
      'x-amz-meta-hash': img.hash,
      'x-amz-meta-entity-name': entityName,
      'x-amz-meta-migrated-from': img.key
    });

    // Try to copy processing result if it exists
    try {
      const processedKey = `processed/${img.hash}-result.json`;
      const resultStream = await minio.getObject(bucket, processedKey);
      const chunks: Buffer[] = [];

      await new Promise<void>((resolve, reject) => {
        resultStream.on('data', (chunk: Buffer) => chunks.push(chunk));
        resultStream.on('end', async () => {
          try {
            const content = Buffer.concat(chunks).toString('utf-8');
            const result = JSON.parse(content);

            // Store as live metadata
            await storage.storeLiveMetadata(img.hash, {
              hash: img.hash,
              entityName,
              extractedData: result,
              modelKey: result.modelKey || 'unknown',
              processedAt: result.processedAt || new Date().toISOString()
            });
            resolve();
          } catch (e) {
            reject(e);
          }
        });
        resultStream.on('error', reject);
      });
    } catch {
      // No processing result exists, that's fine
    }

    // Delete from old location
    await minio.removeObject(bucket, img.key);

    // Also delete old processing result if it exists
    try {
      await minio.removeObject(bucket, `processed/${img.hash}-result.json`);
    } catch {
      // Processing result might not exist
    }

  } finally {
    await storage.cleanupTemp(tempPath);
  }
}

/**
 * Move an orphaned image to the legacy session
 */
async function moveToLegacySession(
  storage: ImageStorageService,
  img: { key: string; hash: string; filename: string }
): Promise<void> {
  // Download from old location
  const tempPath = await storage.downloadToTemp(img.key);

  try {
    const fs = await import('fs');
    const fileBuffer = fs.readFileSync(tempPath);

    // Upload to legacy session
    // Note: The session ID for "Legacy Import" will be generated as date_legacy-import
    // We need to find or create the legacy session first
    const sessions = await storage.listSessions();
    let legacySessionId = sessions.find(s => s.name === 'Legacy Import')?.sessionId;

    if (!legacySessionId) {
      // Create the legacy session if it doesn't exist
      try {
        const session = await storage.createSession('Legacy Import');
        legacySessionId = session.sessionId;
      } catch {
        // If creation fails, try to find one that starts with a date and ends with legacy-import
        const legacySession = sessions.find(s => s.sessionId.endsWith('_legacy-import'));
        if (legacySession) {
          legacySessionId = legacySession.sessionId;
        } else {
          throw new Error('Could not create or find legacy session');
        }
      }
    }

    await storage.uploadToSessionFromBuffer(legacySessionId, fileBuffer, img.filename, img.hash);

    // Delete from old location
    const Client = await import('minio');
    const minioConfig = {
      endPoint: process.env.MINIO_ENDPOINT?.split(':')[0] || 'localhost',
      port: parseInt(process.env.MINIO_ENDPOINT?.split(':')[1] || '9000'),
      useSSL: false,
      accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
      secretKey: process.env.MINIO_SECRET_KEY || process.env.MINIO_PASSWORD || 'poster-memento-minio'
    };
    const minio = new Client.Client(minioConfig);
    const bucket = process.env.MINIO_BUCKET || 'poster-images';

    await minio.removeObject(bucket, img.key);

  } finally {
    await storage.cleanupTemp(tempPath);
  }
}
