/**
 * S3 Image Storage Service - AWS S3 storage for poster images with presigned URLs
 */

import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { StoredImage } from './types.js';

export interface S3ImageStorageConfig {
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  presignedUrlExpiry?: number; // Default expiry in seconds (default: 3600)
}

export class S3ImageStorageService {
  private s3: S3Client;
  private bucket: string;
  private region: string;
  private defaultExpiry: number;

  constructor(config: S3ImageStorageConfig) {
    this.s3 = new S3Client({
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      }
    });
    this.bucket = config.bucket;
    this.region = config.region;
    this.defaultExpiry = config.presignedUrlExpiry || 3600;
  }

  /**
   * Initialize the storage service (S3 buckets are pre-created)
   */
  async initialize(): Promise<void> {
    // For S3, we assume the bucket exists (created via AWS console/CLI)
    // Just verify we can access it
    try {
      await this.s3.send(new ListObjectsV2Command({
        Bucket: this.bucket,
        MaxKeys: 1
      }));
      console.log(`S3 bucket verified: ${this.bucket}`);
    } catch (error) {
      console.error(`Failed to access S3 bucket: ${error}`);
      throw error;
    }
  }

  /**
   * Store an image in S3 and return metadata
   */
  async storeImage(localPath: string): Promise<StoredImage> {
    const fileBuffer = fs.readFileSync(localPath);
    const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex').slice(0, 16);

    const originalFilename = path.basename(localPath);
    const ext = path.extname(originalFilename).toLowerCase();
    const mimeType = this.getMimeType(ext);
    const key = `originals/${hash}-${this.sanitizeFilename(originalFilename)}`;

    // Check if already exists
    try {
      await this.s3.send(new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key
      }));
      // File already exists
      return {
        bucket: this.bucket,
        key,
        url: `s3://${this.bucket}/${key}`,
        hash,
        originalFilename,
        sizeBytes: fileBuffer.length,
        mimeType
      };
    } catch (e: any) {
      if (e.name !== 'NotFound' && e.$metadata?.httpStatusCode !== 404) {
        throw e;
      }
      // File doesn't exist, continue to upload
    }

    // Upload to S3
    await this.s3.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: fileBuffer,
      ContentType: mimeType,
      Metadata: {
        'original-filename': originalFilename,
        'hash': hash
      }
    }));

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

    await this.s3.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ContentType: 'application/json'
    }));

    return `s3://${this.bucket}/${key}`;
  }

  /**
   * Get a presigned URL for temporary access to an image
   */
  async getPresignedUrl(key: string, expirySeconds?: number): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key
    });
    return getSignedUrl(this.s3, command, { expiresIn: expirySeconds || this.defaultExpiry });
  }

  /**
   * Get presigned URL by hash (looks in live/images/ and originals/ folders)
   */
  async getPresignedUrlByHash(hash: string, expirySeconds?: number): Promise<string | null> {
    // Try live/images/ first (new session-based workflow), then originals/ (legacy)
    const prefixes = [`live/images/${hash}-`, `originals/${hash}-`];

    for (const prefix of prefixes) {
      try {
        const response = await this.s3.send(new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          MaxKeys: 1
        }));

        if (response.Contents && response.Contents.length > 0) {
          const key = response.Contents[0].Key;
          if (key) {
            return this.getPresignedUrl(key, expirySeconds);
          }
        }
      } catch {
        // Continue to next prefix
      }
    }

    return null;
  }

  /**
   * Check if an image with the given hash already exists
   */
  async imageExists(hash: string): Promise<boolean> {
    try {
      const response = await this.s3.send(new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: `originals/${hash}-`,
        MaxKeys: 1
      }));
      return (response.Contents?.length || 0) > 0;
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
   * Health check for S3 connection
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.s3.send(new ListObjectsV2Command({
        Bucket: this.bucket,
        MaxKeys: 1
      }));
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
 * Create S3ImageStorageService from environment variables
 */
export function createS3ImageStorageFromEnv(): S3ImageStorageService {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  const region = process.env.AWS_REGION;
  const bucket = process.env.S3_BUCKET;

  if (!accessKeyId || !secretAccessKey || !region || !bucket) {
    throw new Error('Missing required S3 environment variables: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, S3_BUCKET');
  }

  return new S3ImageStorageService({
    accessKeyId,
    secretAccessKey,
    region,
    bucket,
    presignedUrlExpiry: parseInt(process.env.S3_PRESIGNED_URL_EXPIRY || '3600', 10)
  });
}

/**
 * Check if S3 storage is configured
 */
export function isS3Configured(): boolean {
  return !!(
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY &&
    process.env.AWS_REGION &&
    process.env.S3_BUCKET
  );
}
