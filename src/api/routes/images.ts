/**
 * Image Routes
 *
 * Endpoints for retrieving presigned image URLs from MinIO storage.
 */

import { Router } from 'express';
import { asyncHandler, ValidationError, NotFoundError } from '../middleware/errorHandler.js';
import type { ImageStorageService } from '../../image-processor/ImageStorageService.js';

/**
 * Create image routes
 */
export function createImageRoutes(imageStorage: ImageStorageService): Router {
  const router = Router();

  /**
   * GET /images/health - Check image storage health
   * (Must be before /:hash to avoid matching 'health' as a hash)
   */
  router.get('/health', asyncHandler(async (_req, res) => {
    const healthy = await imageStorage.healthCheck();

    res.json({
      data: {
        healthy,
        service: 'minio'
      }
    });
  }));

  /**
   * GET /images/:hash - Get presigned URL for a single image by hash
   *
   * @param hash - First 16 characters of the SHA-256 hash of the image
   * @query expiry - Optional expiry time in seconds (default: 3600, max: 86400)
   */
  router.get('/:hash', asyncHandler(async (req, res) => {
    const { hash } = req.params;
    const expiry = Math.min(parseInt(req.query.expiry as string) || 3600, 86400);

    if (!hash || hash.length < 8) {
      throw new ValidationError('Valid image hash is required');
    }

    const presignedUrl = await imageStorage.getPresignedUrlByHash(hash, expiry);

    if (!presignedUrl) {
      throw new NotFoundError(`Image not found for hash: ${hash}`);
    }

    res.json({
      data: {
        hash,
        url: presignedUrl,
        expiresIn: expiry
      }
    });
  }));

  /**
   * POST /images/batch - Get presigned URLs for multiple images
   *
   * Body:
   * - hashes: Array of image hashes
   * - expiry: Optional expiry time in seconds (default: 3600, max: 86400)
   */
  router.post('/batch', asyncHandler(async (req, res) => {
    const { hashes, expiry: requestedExpiry } = req.body;

    if (!hashes || !Array.isArray(hashes)) {
      throw new ValidationError('hashes array is required');
    }

    if (hashes.length > 100) {
      throw new ValidationError('Maximum 100 hashes per batch request');
    }

    const expiry = Math.min(requestedExpiry || 3600, 86400);

    // Fetch presigned URLs in parallel
    const results = await Promise.all(
      hashes.map(async (hash: string) => {
        if (!hash || typeof hash !== 'string') {
          return { hash, url: null, error: 'Invalid hash' };
        }
        try {
          const url = await imageStorage.getPresignedUrlByHash(hash, expiry);
          return { hash, url, error: url ? null : 'Not found' };
        } catch (e: any) {
          return { hash, url: null, error: e.message };
        }
      })
    );

    // Separate successful and failed results
    const urls: Record<string, string> = {};
    const errors: Record<string, string> = {};

    for (const result of results) {
      if (result.url) {
        urls[result.hash] = result.url;
      } else if (result.error) {
        errors[result.hash] = result.error;
      }
    }

    res.json({
      data: {
        urls,
        expiresIn: expiry
      },
      errors: Object.keys(errors).length > 0 ? errors : undefined
    });
  }));

  return router;
}
