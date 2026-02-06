/**
 * Live Folder Routes
 *
 * REST endpoints for managing the live folder (canonical image storage).
 * The live folder contains one image per knowledge graph entity.
 * Images move here after successful processing from sessions.
 */

import { Router } from 'express';
import { asyncHandler, NotFoundError } from '../middleware/errorHandler.js';
import { createImageStorageFromEnv, ImageStorageService } from '../../image-processor/ImageStorageService.js';
import { KnowledgeGraphManager } from '../../KnowledgeGraphManager.js';
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

/**
 * Create live folder routes
 */
export function createLiveRoutes(knowledgeGraphManager: KnowledgeGraphManager): Router {
  const router = Router();

  /**
   * GET /live/images - List all images in the live folder
   *
   * @query limit - Number of results to return (default: 100)
   * @query offset - Pagination offset (default: 0)
   */
  router.get('/images', asyncHandler(async (req, res) => {
    const storage = await getStorageService();
    const limit = parseInt(req.query.limit as string) || 100;
    const offset = parseInt(req.query.offset as string) || 0;

    const allImages = await storage.listLiveImages();

    // Apply pagination
    const paginatedImages = allImages.slice(offset, offset + limit);

    // Generate fresh presigned URLs
    const imagesWithUrls = await Promise.all(
      paginatedImages.map(async (img) => {
        const url = await storage.getLiveImageUrl(img.hash);
        return { ...img, url: url || img.url };
      })
    );

    res.json({
      images: imagesWithUrls,
      totalImages: allImages.length,
      offset,
      limit,
      hasMore: offset + limit < allImages.length
    });
  }));

  /**
   * GET /live/images/:hash - Get presigned URL for a live image
   *
   * @param hash - Image hash
   * @query expiry - URL expiry time in seconds (default: 3600)
   */
  router.get('/images/:hash', asyncHandler(async (req, res) => {
    const { hash } = req.params;
    const expiry = parseInt(req.query.expiry as string) || 3600;

    const storage = await getStorageService();

    const url = await storage.getLiveImageUrl(hash, expiry);
    if (!url) {
      throw new NotFoundError(`Live image not found: ${hash}`);
    }

    // Also get metadata if available
    const metadata = await storage.getLiveMetadata(hash);

    res.json({
      hash,
      url,
      metadata
    });
  }));

  /**
   * DELETE /live/images/:hash - Delete a live image (and its entity)
   *
   * WARNING: This also deletes the corresponding entity from the knowledge graph.
   *
   * @param hash - Image hash
   */
  router.delete('/images/:hash', asyncHandler(async (req, res) => {
    const { hash } = req.params;

    const storage = await getStorageService();

    // Check if image exists
    const exists = await storage.liveImageExists(hash);
    if (!exists) {
      throw new NotFoundError(`Live image not found: ${hash}`);
    }

    // Get metadata to find entity name
    const metadata = await storage.getLiveMetadata(hash);

    // Delete the entity from knowledge graph if we have the entity name
    if (metadata?.entityName) {
      try {
        await knowledgeGraphManager.deleteEntities([metadata.entityName]);
        logger.info('Entity deleted from knowledge graph', { entityName: metadata.entityName });
      } catch (error) {
        logger.warn('Failed to delete entity from knowledge graph', {
          entityName: metadata.entityName,
          error
        });
      }
    }

    // Delete the image and metadata from S3
    await storage.deleteLiveImage(hash);

    logger.info('Live image deleted', { hash, entityName: metadata?.entityName });

    res.json({
      success: true,
      message: `Live image ${hash} deleted`,
      entityDeleted: metadata?.entityName || null
    });
  }));

  /**
   * GET /live/stats - Get statistics about the live folder
   */
  router.get('/stats', asyncHandler(async (_req, res) => {
    const storage = await getStorageService();
    const stats = await storage.getLiveStats();

    // Also get entity count from knowledge graph
    let entityCount = 0;
    try {
      // For accurate count, query for Poster entities specifically
      const posterResult = await knowledgeGraphManager.searchNodes('', {
        entityTypes: ['Poster'],
        limit: 10000 // Get all posters
      });
      entityCount = posterResult.entities?.length || posterResult.pagination?.total || 0;
    } catch (error) {
      logger.warn('Failed to get entity count from knowledge graph', { error });
    }

    res.json({
      ...stats,
      entityCount
    });
  }));

  /**
   * GET /live/images/:hash/metadata - Get processing metadata for a live image
   */
  router.get('/images/:hash/metadata', asyncHandler(async (req, res) => {
    const { hash } = req.params;
    const storage = await getStorageService();

    const metadata = await storage.getLiveMetadata(hash);
    if (!metadata) {
      throw new NotFoundError(`Metadata not found for image: ${hash}`);
    }

    res.json({ metadata });
  }));

  return router;
}
