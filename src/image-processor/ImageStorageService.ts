/**
 * Image Storage Service - MinIO S3-compatible storage for poster images
 */

import { Client } from 'minio';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { StoredImage } from './types.js';

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
