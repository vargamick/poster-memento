/**
 * Image Storage Factory - Creates the appropriate storage service based on configuration
 *
 * Priority:
 * 1. If S3 is configured (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, S3_BUCKET), use S3
 * 2. Otherwise, fall back to MinIO
 */

import { ImageStorageService, createImageStorageFromEnv } from './ImageStorageService.js';
import { S3ImageStorageService, createS3ImageStorageFromEnv, isS3Configured } from './S3ImageStorageService.js';

// Common interface for both storage services
export interface IImageStorageService {
  initialize(): Promise<void>;
  storeImage(localPath: string): Promise<any>;
  storeProcessingResult(hash: string, result: object): Promise<string>;
  getPresignedUrl(key: string, expirySeconds?: number): Promise<string>;
  getPresignedUrlByHash(hash: string, expirySeconds?: number): Promise<string | null>;
  imageExists(hash: string): Promise<boolean>;
  getFileHash(localPath: string): string;
  healthCheck(): Promise<boolean>;
}

/**
 * Create the appropriate image storage service based on environment configuration
 *
 * @returns S3ImageStorageService if S3 is configured, otherwise ImageStorageService (MinIO)
 */
export function createImageStorageService(): IImageStorageService {
  if (isS3Configured()) {
    console.log('Using AWS S3 for image storage');
    return createS3ImageStorageFromEnv();
  } else {
    console.log('Using MinIO for image storage');
    return createImageStorageFromEnv();
  }
}

/**
 * Get the storage type being used
 */
export function getStorageType(): 'S3' | 'MinIO' {
  return isS3Configured() ? 'S3' : 'MinIO';
}
