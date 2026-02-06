/**
 * Image Storage Service - MinIO S3-compatible storage for poster images
 */

import { Client } from 'minio';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  StoredImage,
  SessionInfo,
  SessionImage,
  LiveImage,
  LiveStats,
  ProcessingResultMetadata
} from './types.js';

export interface ImageStorageConfig {
  endpoint: string;
  port?: number;
  useSSL?: boolean;
  accessKey: string;
  secretKey: string;
  bucket: string;
  publicUrl?: string; // Public URL for presigned URLs (e.g., http://localhost:9010)
}

export class ImageStorageService {
  private minio: Client;
  private bucket: string;
  private publicUrl?: string;
  private internalUrl: string;

  constructor(config: ImageStorageConfig) {
    const endpoint = config.endpoint.includes(':')
      ? config.endpoint.split(':')[0]
      : config.endpoint;
    const port = config.port || (config.endpoint.includes(':')
      ? parseInt(config.endpoint.split(':')[1], 10)
      : 9000);

    this.minio = new Client({
      endPoint: endpoint,
      port: port,
      useSSL: config.useSSL ?? false,
      accessKey: config.accessKey,
      secretKey: config.secretKey
    });
    this.bucket = config.bucket;
    this.publicUrl = config.publicUrl;
    this.internalUrl = `http://${endpoint}:${port}`;
  }

  /**
   * Initialize the storage service and ensure bucket exists
   */
  async initialize(): Promise<void> {
    try {
      const exists = await this.minio.bucketExists(this.bucket);
      if (!exists) {
        await this.minio.makeBucket(this.bucket);
        console.log(`Created bucket: ${this.bucket}`);
      }
    } catch (error) {
      console.error(`Failed to initialize storage: ${error}`);
      throw error;
    }
  }

  /**
   * Store an image in MinIO and return metadata
   */
  async storeImage(localPath: string): Promise<StoredImage> {
    // Read file and calculate hash
    const fileBuffer = fs.readFileSync(localPath);
    const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex').slice(0, 16);

    const originalFilename = path.basename(localPath);
    const ext = path.extname(originalFilename).toLowerCase();
    const mimeType = this.getMimeType(ext);
    const key = `originals/${hash}-${this.sanitizeFilename(originalFilename)}`;

    // Check if already exists
    try {
      await this.minio.statObject(this.bucket, key);
      // File already exists, return existing metadata
      return {
        bucket: this.bucket,
        key,
        url: `s3://${this.bucket}/${key}`,
        hash,
        originalFilename,
        sizeBytes: fileBuffer.length,
        mimeType
      };
    } catch (e) {
      // File doesn't exist, upload it
    }

    // Upload to MinIO
    await this.minio.putObject(this.bucket, key, fileBuffer, fileBuffer.length, {
      'Content-Type': mimeType,
      'x-amz-meta-original-filename': originalFilename,
      'x-amz-meta-hash': hash
    });

    return {
      bucket: this.bucket,
      key,
      url: `s3://${this.bucket}/${key}`,
      hash,
      originalFilename,
      sizeBytes: fileBuffer.length,
      mimeType
    };
  }

  /**
   * Store extracted OCR/processing results as JSON
   */
  async storeProcessingResult(hash: string, result: object): Promise<string> {
    const key = `processed/${hash}-result.json`;
    const content = JSON.stringify(result, null, 2);
    const buffer = Buffer.from(content, 'utf-8');

    await this.minio.putObject(this.bucket, key, buffer, buffer.length, {
      'Content-Type': 'application/json'
    });

    return `s3://${this.bucket}/${key}`;
  }

  /**
   * Rewrite presigned URL to use public URL if configured
   */
  private rewriteUrl(url: string): string {
    if (this.publicUrl) {
      return url.replace(this.internalUrl, this.publicUrl);
    }
    return url;
  }

  /**
   * Get a presigned URL for temporary access to an image
   */
  async getPresignedUrl(key: string, expirySeconds: number = 3600): Promise<string> {
    const url = await this.minio.presignedGetObject(this.bucket, key, expirySeconds);
    return this.rewriteUrl(url);
  }

  /**
   * Get presigned URL by hash (looks for the original image)
   * If publicUrl is configured, returns a direct public URL (for buckets with anonymous access)
   */
  async getPresignedUrlByHash(hash: string, expirySeconds: number = 3600): Promise<string | null> {
    try {
      // List objects with the hash prefix
      const stream = this.minio.listObjects(this.bucket, `originals/${hash}-`, false);

      return new Promise((resolve, reject) => {
        let found = false;
        stream.on('data', async (obj) => {
          if (!found && obj.name) {
            found = true;
            try {
              // If publicUrl is configured, return direct URL (for public buckets)
              if (this.publicUrl) {
                resolve(`${this.publicUrl}/${this.bucket}/${obj.name}`);
              } else {
                const url = await this.minio.presignedGetObject(this.bucket, obj.name, expirySeconds);
                resolve(url);
              }
            } catch (e) {
              reject(e);
            }
          }
        });
        stream.on('end', () => {
          if (!found) resolve(null);
        });
        stream.on('error', reject);
      });
    } catch {
      return null;
    }
  }

  /**
   * Check if an image with the given hash already exists
   */
  async imageExists(hash: string): Promise<boolean> {
    try {
      const stream = this.minio.listObjects(this.bucket, `originals/${hash}-`, false);

      return new Promise((resolve) => {
        let found = false;
        stream.on('data', () => {
          found = true;
        });
        stream.on('end', () => resolve(found));
        stream.on('error', () => resolve(false));
      });
    } catch {
      return false;
    }
  }

  /**
   * Get file hash without uploading
   */
  getFileHash(localPath: string): string {
    const fileBuffer = fs.readFileSync(localPath);
    return crypto.createHash('sha256').update(fileBuffer).digest('hex').slice(0, 16);
  }

  /**
   * List all images in the originals folder with pagination
   */
  async listImages(options: {
    prefix?: string;
    offset?: number;
    limit?: number;
    processed?: boolean;  // If true, filter to only processed images
  } = {}): Promise<{
    files: Array<{
      key: string;
      filename: string;
      sizeBytes: number;
      lastModified: Date;
      hash: string;
      url: string;
    }>;
    totalFiles: number;
    hasMore: boolean;
  }> {
    const prefix = options.prefix || 'originals/';
    const offset = options.offset || 0;
    const limit = options.limit || 100;

    return new Promise((resolve, reject) => {
      const files: Array<{
        key: string;
        filename: string;
        sizeBytes: number;
        lastModified: Date;
        hash: string;
        url: string;
      }> = [];

      const stream = this.minio.listObjects(this.bucket, prefix, true);
      let totalCount = 0;

      stream.on('data', (obj) => {
        if (obj.name) {
          totalCount++;

          // Apply offset and limit
          if (totalCount > offset && files.length < limit) {
            // Extract hash and filename from key: originals/{hash}-{filename}
            const keyParts = obj.name.replace('originals/', '').split('-');
            const hash = keyParts[0] || '';
            const filename = keyParts.slice(1).join('-') || obj.name;

            // Generate public URL
            const url = this.publicUrl
              ? `${this.publicUrl}/${this.bucket}/${obj.name}`
              : `s3://${this.bucket}/${obj.name}`;

            files.push({
              key: obj.name,
              filename,
              sizeBytes: obj.size || 0,
              lastModified: obj.lastModified || new Date(),
              hash,
              url
            });
          }
        }
      });

      stream.on('end', () => {
        resolve({
          files,
          totalFiles: totalCount,
          hasMore: totalCount > offset + limit
        });
      });

      stream.on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * Download an image from S3 to a local temp file for processing
   * Returns the local file path
   */
  async downloadToTemp(key: string): Promise<string> {
    const os = await import('os');
    const tempDir = os.tmpdir();
    const filename = path.basename(key);
    const tempPath = path.join(tempDir, `minio-download-${Date.now()}-${filename}`);

    await this.minio.fGetObject(this.bucket, key, tempPath);
    return tempPath;
  }

  /**
   * Delete a temp file after processing
   */
  async cleanupTemp(tempPath: string): Promise<void> {
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch (e) {
      console.warn(`Failed to cleanup temp file: ${tempPath}`, e);
    }
  }

  /**
   * Check if a processing result exists for a hash
   */
  async hasProcessingResult(hash: string): Promise<boolean> {
    const key = `processed/${hash}-result.json`;
    try {
      await this.minio.statObject(this.bucket, key);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Health check for MinIO connection
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.minio.bucketExists(this.bucket);
      return true;
    } catch {
      return false;
    }
  }

  private getMimeType(ext: string): string {
    const mimeTypes: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.pdf': 'application/pdf',
      '.tiff': 'image/tiff',
      '.tif': 'image/tiff',
      '.bmp': 'image/bmp'
    };
    return mimeTypes[ext.toLowerCase()] || 'application/octet-stream';
  }

  private sanitizeFilename(filename: string): string {
    return filename
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/__+/g, '_')
      .toLowerCase();
  }

  // ============================================================================
  // Session Management Methods
  // ============================================================================

  /**
   * Generate a session ID from a name
   */
  private generateSessionId(name: string): string {
    const date = new Date().toISOString().split('T')[0]; // 2026-02-05
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50);
    return `${date}_${slug}`;
  }

  /**
   * Create a new upload session
   */
  async createSession(name: string): Promise<SessionInfo> {
    const sessionId = this.generateSessionId(name);
    const sessionKey = `sessions/${sessionId}/session.json`;

    // Check if session already exists
    try {
      await this.minio.statObject(this.bucket, sessionKey);
      throw new Error(`Session already exists: ${sessionId}`);
    } catch (e: unknown) {
      const error = e as { code?: string; message?: string };
      if (error.code !== 'NotFound' && !error.message?.includes('Not Found')) {
        throw e;
      }
    }

    const sessionInfo: SessionInfo = {
      sessionId,
      name,
      created: new Date().toISOString(),
      imageCount: 0,
      totalSizeBytes: 0
    };

    const content = JSON.stringify(sessionInfo, null, 2);
    const buffer = Buffer.from(content, 'utf-8');

    await this.minio.putObject(this.bucket, sessionKey, buffer, buffer.length, {
      'Content-Type': 'application/json'
    });

    return sessionInfo;
  }

  /**
   * List all sessions
   */
  async listSessions(): Promise<SessionInfo[]> {
    const sessions: SessionInfo[] = [];

    return new Promise((resolve, reject) => {
      const stream = this.minio.listObjects(this.bucket, 'sessions/', false);
      const sessionPromises: Promise<void>[] = [];

      stream.on('data', (obj) => {
        if (obj.prefix) {
          // This is a "folder" - extract session ID and load its metadata
          const sessionId = obj.prefix.replace('sessions/', '').replace('/', '');
          if (sessionId) {
            const promise = this.getSession(sessionId)
              .then((info) => {
                if (info) sessions.push(info);
              })
              .catch(() => {
                // Skip sessions without valid metadata
              });
            sessionPromises.push(promise);
          }
        }
      });

      stream.on('end', async () => {
        await Promise.all(sessionPromises);
        // Sort by created date descending (newest first)
        sessions.sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime());
        resolve(sessions);
      });

      stream.on('error', reject);
    });
  }

  /**
   * Get session info by ID
   */
  async getSession(sessionId: string): Promise<SessionInfo | null> {
    const sessionKey = `sessions/${sessionId}/session.json`;

    try {
      const stream = await this.minio.getObject(this.bucket, sessionKey);
      const chunks: Buffer[] = [];

      return new Promise((resolve, reject) => {
        stream.on('data', (chunk) => chunks.push(chunk));
        stream.on('end', async () => {
          try {
            const content = Buffer.concat(chunks).toString('utf-8');
            const baseInfo = JSON.parse(content) as SessionInfo;

            // Update image count and size by scanning the images folder
            const images = await this.listSessionImages(sessionId);
            baseInfo.imageCount = images.length;
            baseInfo.totalSizeBytes = images.reduce((sum, img) => sum + img.sizeBytes, 0);

            resolve(baseInfo);
          } catch (e) {
            reject(e);
          }
        });
        stream.on('error', reject);
      });
    } catch {
      return null;
    }
  }

  /**
   * Delete a session (must be empty)
   */
  async deleteSession(sessionId: string): Promise<void> {
    const images = await this.listSessionImages(sessionId);
    if (images.length > 0) {
      throw new Error(`Session is not empty. Remove ${images.length} images first.`);
    }

    const sessionKey = `sessions/${sessionId}/session.json`;
    await this.minio.removeObject(this.bucket, sessionKey);
  }

  // ============================================================================
  // Session Image Operations
  // ============================================================================

  /**
   * Upload an image to a session from a local file path
   */
  async uploadToSession(sessionId: string, localPath: string): Promise<SessionImage> {
    // Verify session exists
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const fileBuffer = fs.readFileSync(localPath);
    const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex').slice(0, 16);
    const originalFilename = path.basename(localPath);

    return this.uploadToSessionFromBuffer(sessionId, fileBuffer, originalFilename, hash);
  }

  /**
   * Upload an image to a session from a buffer
   */
  async uploadToSessionFromBuffer(
    sessionId: string,
    buffer: Buffer,
    filename: string,
    providedHash?: string
  ): Promise<SessionImage> {
    const hash = providedHash || crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);
    const sanitizedFilename = this.sanitizeFilename(filename);
    const ext = path.extname(filename).toLowerCase();
    const mimeType = this.getMimeType(ext);
    const key = `sessions/${sessionId}/images/${hash}-${sanitizedFilename}`;

    // Check if already exists in this session
    try {
      await this.minio.statObject(this.bucket, key);
      // Already exists, return existing info
      const url = this.publicUrl
        ? `${this.publicUrl}/${this.bucket}/${key}`
        : await this.minio.presignedGetObject(this.bucket, key, 3600);

      return {
        hash,
        filename: sanitizedFilename,
        key,
        sizeBytes: buffer.length,
        uploadedAt: new Date().toISOString(),
        url: this.rewriteUrl(url)
      };
    } catch {
      // Doesn't exist, upload it
    }

    await this.minio.putObject(this.bucket, key, buffer, buffer.length, {
      'Content-Type': mimeType,
      'x-amz-meta-original-filename': filename,
      'x-amz-meta-hash': hash
    });

    const url = this.publicUrl
      ? `${this.publicUrl}/${this.bucket}/${key}`
      : await this.minio.presignedGetObject(this.bucket, key, 3600);

    return {
      hash,
      filename: sanitizedFilename,
      key,
      sizeBytes: buffer.length,
      uploadedAt: new Date().toISOString(),
      url: this.rewriteUrl(url)
    };
  }

  /**
   * List all images in a session
   */
  async listSessionImages(sessionId: string): Promise<SessionImage[]> {
    const prefix = `sessions/${sessionId}/images/`;
    const images: SessionImage[] = [];

    return new Promise((resolve, reject) => {
      const stream = this.minio.listObjects(this.bucket, prefix, true);

      stream.on('data', (obj) => {
        if (obj.name && !obj.name.endsWith('/')) {
          // Extract hash and filename from key
          const keyParts = obj.name.replace(prefix, '').split('-');
          const hash = keyParts[0] || '';
          const filename = keyParts.slice(1).join('-') || obj.name;

          const url = this.publicUrl
            ? `${this.publicUrl}/${this.bucket}/${obj.name}`
            : `s3://${this.bucket}/${obj.name}`;

          images.push({
            hash,
            filename,
            key: obj.name,
            sizeBytes: obj.size || 0,
            uploadedAt: obj.lastModified?.toISOString() || new Date().toISOString(),
            url
          });
        }
      });

      stream.on('end', () => resolve(images));
      stream.on('error', reject);
    });
  }

  /**
   * Delete an image from a session
   */
  async deleteSessionImage(sessionId: string, hash: string): Promise<void> {
    const images = await this.listSessionImages(sessionId);
    const image = images.find((img) => img.hash === hash);

    if (!image) {
      throw new Error(`Image not found in session: ${hash}`);
    }

    await this.minio.removeObject(this.bucket, image.key);
  }

  /**
   * Get a presigned URL for a session image
   */
  async getSessionImageUrl(sessionId: string, hash: string, expirySeconds: number = 3600): Promise<string | null> {
    const images = await this.listSessionImages(sessionId);
    const image = images.find((img) => img.hash === hash);

    if (!image) {
      return null;
    }

    if (this.publicUrl) {
      return `${this.publicUrl}/${this.bucket}/${image.key}`;
    }

    const url = await this.minio.presignedGetObject(this.bucket, image.key, expirySeconds);
    return this.rewriteUrl(url);
  }

  // ============================================================================
  // Live Folder Operations
  // ============================================================================

  /**
   * Move an image from a session to the live folder after successful processing
   */
  async moveToLive(sessionId: string, hash: string, entityName: string): Promise<LiveImage> {
    // Find the image in the session
    const images = await this.listSessionImages(sessionId);
    const sourceImage = images.find((img) => img.hash === hash);

    if (!sourceImage) {
      throw new Error(`Image not found in session: ${hash}`);
    }

    // Download the image
    const tempPath = await this.downloadToTemp(sourceImage.key);

    try {
      const fileBuffer = fs.readFileSync(tempPath);
      const ext = path.extname(sourceImage.filename).toLowerCase();
      const mimeType = this.getMimeType(ext);
      const liveKey = `live/images/${hash}-${sourceImage.filename}`;

      // Upload to live folder
      await this.minio.putObject(this.bucket, liveKey, fileBuffer, fileBuffer.length, {
        'Content-Type': mimeType,
        'x-amz-meta-hash': hash,
        'x-amz-meta-entity-name': entityName
      });

      // Delete from session
      await this.minio.removeObject(this.bucket, sourceImage.key);

      const url = this.publicUrl
        ? `${this.publicUrl}/${this.bucket}/${liveKey}`
        : await this.minio.presignedGetObject(this.bucket, liveKey, 3600);

      return {
        hash,
        filename: sourceImage.filename,
        key: liveKey,
        entityName,
        sizeBytes: fileBuffer.length,
        processedAt: new Date().toISOString(),
        url: this.rewriteUrl(url)
      };
    } finally {
      await this.cleanupTemp(tempPath);
    }
  }

  /**
   * List all images in the live folder
   */
  async listLiveImages(): Promise<LiveImage[]> {
    const prefix = 'live/images/';
    const images: LiveImage[] = [];

    return new Promise((resolve, reject) => {
      const stream = this.minio.listObjects(this.bucket, prefix, true);
      const metadataPromises: Promise<void>[] = [];

      stream.on('data', (obj) => {
        if (obj.name && !obj.name.endsWith('/')) {
          const keyParts = obj.name.replace(prefix, '').split('-');
          const hash = keyParts[0] || '';
          const filename = keyParts.slice(1).join('-') || obj.name;

          const url = this.publicUrl
            ? `${this.publicUrl}/${this.bucket}/${obj.name}`
            : `s3://${this.bucket}/${obj.name}`;

          // Try to get entity name from metadata
          const promise = this.getLiveMetadata(hash)
            .then((metadata) => {
              images.push({
                hash,
                filename,
                key: obj.name!,
                entityName: metadata?.entityName || `poster_${hash}`,
                sizeBytes: obj.size || 0,
                processedAt: metadata?.processedAt || obj.lastModified?.toISOString() || new Date().toISOString(),
                url
              });
            })
            .catch(() => {
              // No metadata, use defaults
              images.push({
                hash,
                filename,
                key: obj.name!,
                entityName: `poster_${hash}`,
                sizeBytes: obj.size || 0,
                processedAt: obj.lastModified?.toISOString() || new Date().toISOString(),
                url
              });
            });

          metadataPromises.push(promise);
        }
      });

      stream.on('end', async () => {
        await Promise.all(metadataPromises);
        // Sort by processedAt descending (newest first)
        images.sort((a, b) => new Date(b.processedAt).getTime() - new Date(a.processedAt).getTime());
        resolve(images);
      });

      stream.on('error', reject);
    });
  }

  /**
   * Get presigned URL for a live image by hash
   */
  async getLiveImageUrl(hash: string, expirySeconds: number = 3600): Promise<string | null> {
    const prefix = `live/images/${hash}-`;

    return new Promise((resolve, reject) => {
      const stream = this.minio.listObjects(this.bucket, prefix, false);
      let found = false;

      stream.on('data', async (obj) => {
        if (!found && obj.name) {
          found = true;
          try {
            if (this.publicUrl) {
              resolve(`${this.publicUrl}/${this.bucket}/${obj.name}`);
            } else {
              const url = await this.minio.presignedGetObject(this.bucket, obj.name, expirySeconds);
              resolve(this.rewriteUrl(url));
            }
          } catch (e) {
            reject(e);
          }
        }
      });

      stream.on('end', () => {
        if (!found) resolve(null);
      });

      stream.on('error', reject);
    });
  }

  /**
   * Check if an image exists in the live folder
   */
  async liveImageExists(hash: string): Promise<boolean> {
    const prefix = `live/images/${hash}-`;

    return new Promise((resolve) => {
      const stream = this.minio.listObjects(this.bucket, prefix, false);
      let found = false;

      stream.on('data', () => {
        found = true;
      });

      stream.on('end', () => resolve(found));
      stream.on('error', () => resolve(false));
    });
  }

  /**
   * Delete a live image
   */
  async deleteLiveImage(hash: string): Promise<void> {
    const images = await this.listLiveImages();
    const image = images.find((img) => img.hash === hash);

    if (!image) {
      throw new Error(`Live image not found: ${hash}`);
    }

    // Delete image
    await this.minio.removeObject(this.bucket, image.key);

    // Delete metadata if exists
    try {
      await this.minio.removeObject(this.bucket, `live/metadata/${hash}.json`);
    } catch {
      // Metadata might not exist
    }
  }

  /**
   * Get statistics for the live folder
   */
  async getLiveStats(): Promise<LiveStats> {
    const images = await this.listLiveImages();

    const stats: LiveStats = {
      totalImages: images.length,
      totalSizeBytes: images.reduce((sum, img) => sum + img.sizeBytes, 0)
    };

    if (images.length > 0) {
      // Images are sorted newest first
      stats.newestImage = images[0].processedAt;
      stats.oldestImage = images[images.length - 1].processedAt;
    }

    return stats;
  }

  // ============================================================================
  // Processing Result Storage (Live Metadata)
  // ============================================================================

  /**
   * Store processing result metadata in the live folder
   */
  async storeLiveMetadata(hash: string, metadata: ProcessingResultMetadata): Promise<void> {
    const key = `live/metadata/${hash}.json`;
    const content = JSON.stringify(metadata, null, 2);
    const buffer = Buffer.from(content, 'utf-8');

    await this.minio.putObject(this.bucket, key, buffer, buffer.length, {
      'Content-Type': 'application/json'
    });
  }

  /**
   * Get processing result metadata from the live folder
   */
  async getLiveMetadata(hash: string): Promise<ProcessingResultMetadata | null> {
    const key = `live/metadata/${hash}.json`;

    try {
      const stream = await this.minio.getObject(this.bucket, key);
      const chunks: Buffer[] = [];

      return new Promise((resolve, reject) => {
        stream.on('data', (chunk) => chunks.push(chunk));
        stream.on('end', () => {
          try {
            const content = Buffer.concat(chunks).toString('utf-8');
            resolve(JSON.parse(content) as ProcessingResultMetadata);
          } catch (e) {
            reject(e);
          }
        });
        stream.on('error', reject);
      });
    } catch {
      return null;
    }
  }

  /**
   * Download a session image to temp for processing
   */
  async downloadSessionImageToTemp(sessionId: string, hash: string): Promise<string> {
    const images = await this.listSessionImages(sessionId);
    const image = images.find((img) => img.hash === hash);

    if (!image) {
      throw new Error(`Image not found in session: ${hash}`);
    }

    return this.downloadToTemp(image.key);
  }
}

/**
 * Create ImageStorageService from environment variables
 */
export function createImageStorageFromEnv(): ImageStorageService {
  return new ImageStorageService({
    endpoint: process.env.MINIO_ENDPOINT || 'localhost:9000',
    accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
    secretKey: process.env.MINIO_SECRET_KEY || process.env.MINIO_PASSWORD || 'poster-memento-minio',
    bucket: process.env.MINIO_BUCKET || 'poster-images',
    publicUrl: process.env.MINIO_PUBLIC_URL // e.g., http://localhost:9010 for Docker
  });
}
