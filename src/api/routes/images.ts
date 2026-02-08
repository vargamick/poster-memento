/**
 * Image Routes
 *
 * Endpoints for retrieving image URLs and proxying image content from S3 or MinIO storage.
 * The proxy endpoints allow images to be served through the API server, making them
 * accessible when the app is accessed via ngrok or other reverse proxies.
 */

import { Router } from 'express';
import { Readable } from 'stream';
import { asyncHandler, ValidationError, NotFoundError } from '../middleware/errorHandler.js';
import type { IImageStorageService } from '../../image-processor/imageStorageFactory.js';

/**
 * Convert a public/external MinIO URL to an internal URL for server-side fetching.
 * Maps MINIO_PUBLIC_URL (e.g., http://localhost:9010) to MINIO_ENDPOINT (e.g., minio:9000).
 * S3 URLs are returned unchanged.
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
 * Create image routes
 */
export function createImageRoutes(imageStorage: IImageStorageService): Router {
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
   * GET /images/:hash/file - Proxy image content from storage
   * Streams the image through the API server so it works from any origin (ngrok, etc.)
   * Must be defined before /:hash to avoid route conflicts.
   */
  router.get('/:hash/file', asyncHandler(async (req, res) => {
    const { hash } = req.params;

    if (!hash || hash.length < 8) {
      throw new ValidationError('Valid image hash is required');
    }

    const presignedUrl = await imageStorage.getPresignedUrlByHash(hash, 3600);
    if (!presignedUrl) {
      throw new NotFoundError(`Image not found for hash: ${hash}`);
    }

    const internalUrl = rewriteToInternal(presignedUrl);
    const fetchResponse = await fetch(internalUrl);

    if (!fetchResponse.ok) {
      throw new NotFoundError(`Failed to fetch image: ${fetchResponse.status}`);
    }

    const contentType = fetchResponse.headers.get('content-type') || 'image/jpeg';
    const contentLength = fetchResponse.headers.get('content-length');

    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    if (contentLength) res.set('Content-Length', contentLength);

    if (fetchResponse.body) {
      const nodeStream = Readable.fromWeb(fetchResponse.body as any);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  }));

  /**
   * GET /images/:hash - Get proxy URL for a single image by hash
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
        url: `/api/v1/images/${hash}/file`,
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
        urls[result.hash] = `/api/v1/images/${result.hash}/file`;
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
