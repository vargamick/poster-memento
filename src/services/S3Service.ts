/**
 * S3 Service
 *
 * Provides S3 operations for scrape run management.
 * Wraps the S3Connector functionality for API use.
 */

import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { promises as fs } from 'fs';
import path from 'path';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { logger } from '../utils/logger.js';

export interface S3Config {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  prefix: string;
}

export interface ScrapeRunInfo {
  runId: string;
  timestamp: Date;
  type: 'FULL' | 'PARTIAL' | 'UNKNOWN';
  path: string;
  files: {
    allProductsData: boolean;
    categories: boolean;
    pdfCount: number;
    totalFiles: number;
  };
  size: number;
  sizeFormatted: string;
}

export interface DownloadProgress {
  totalFiles: number;
  downloadedFiles: number;
  totalBytes: number;
  downloadedBytes: number;
  percentComplete: number;
  currentFile: string;
}

export interface DownloadResult {
  success: boolean;
  localPath: string;
  filesDownloaded: number;
  totalBytes: number;
  duration: number;
}

export class S3Service {
  private s3Client: S3Client;
  private config: S3Config;
  private downloadTempDir: string;

  constructor(config: S3Config, downloadTempDir: string = '/tmp/agar-scrapes') {
    this.config = config;
    this.downloadTempDir = downloadTempDir;
    this.s3Client = new S3Client({
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      }
    });
  }

  /**
   * Check if S3 is configured and accessible
   */
  async isConfigured(): Promise<boolean> {
    if (!this.config.accessKeyId || !this.config.secretAccessKey) {
      return false;
    }
    try {
      await this.s3Client.send(new ListObjectsV2Command({
        Bucket: this.config.bucket,
        Prefix: this.config.prefix,
        MaxKeys: 1
      }));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List all available scrape runs
   */
  async listScrapeRuns(): Promise<ScrapeRunInfo[]> {
    logger.info('Listing scrape runs from S3', { bucket: this.config.bucket, prefix: this.config.prefix });

    const command = new ListObjectsV2Command({
      Bucket: this.config.bucket,
      Prefix: this.config.prefix,
      Delimiter: '/'
    });

    const response = await this.s3Client.send(command);
    const runs: ScrapeRunInfo[] = [];

    if (!response.CommonPrefixes) {
      return runs;
    }

    // Process each scrape run directory
    for (const prefix of response.CommonPrefixes) {
      if (!prefix.Prefix) continue;

      const info = await this.getScrapeRunInfo(prefix.Prefix);
      if (info) {
        runs.push(info);
      }
    }

    // Sort by timestamp (newest first)
    runs.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    logger.info(`Found ${runs.length} scrape runs`);
    return runs;
  }

  /**
   * Get detailed info about a specific scrape run
   */
  async getScrapeRunInfo(runPath: string): Promise<ScrapeRunInfo | null> {
    try {
      const runId = path.basename(runPath.replace(/\/$/, ''));

      const command = new ListObjectsV2Command({
        Bucket: this.config.bucket,
        Prefix: runPath
      });

      const response = await this.s3Client.send(command);

      if (!response.Contents || response.Contents.length === 0) {
        return null;
      }

      // Analyze files
      let hasAllProductsData = false;
      let hasCategories = false;
      let pdfCount = 0;
      let totalSize = 0;

      for (const obj of response.Contents) {
        const key = obj.Key || '';
        totalSize += obj.Size || 0;

        if (key.endsWith('all_products_data.json')) {
          hasAllProductsData = true;
        } else if (key.endsWith('categories.json')) {
          hasCategories = true;
        } else if (key.includes('/pdfs/') && key.endsWith('.pdf')) {
          pdfCount++;
        }
      }

      // Determine run type
      let type: 'FULL' | 'PARTIAL' | 'UNKNOWN' = 'UNKNOWN';
      if (runId.includes('_FULL')) {
        type = 'FULL';
      } else if (runId.includes('_PARTIAL')) {
        type = 'PARTIAL';
      }

      // Parse timestamp from run ID
      const timestamp = this.parseTimestampFromRunId(runId);

      return {
        runId,
        timestamp,
        type,
        path: runPath,
        files: {
          allProductsData: hasAllProductsData,
          categories: hasCategories,
          pdfCount,
          totalFiles: response.Contents.length
        },
        size: totalSize,
        sizeFormatted: this.formatBytes(totalSize)
      };
    } catch (error: any) {
      logger.error(`Failed to get info for ${runPath}`, { error: error.message });
      return null;
    }
  }

  /**
   * Download a scrape run to local filesystem
   * Returns the local path where files were downloaded
   */
  async downloadScrapeRun(
    runPath: string,
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<DownloadResult> {
    const startTime = Date.now();
    const runId = path.basename(runPath.replace(/\/$/, ''));
    const localPath = path.join(this.downloadTempDir, runId);

    logger.info('Starting scrape run download', { runPath, localPath });

    // Ensure directories exist
    await fs.mkdir(localPath, { recursive: true });

    // List all files
    const command = new ListObjectsV2Command({
      Bucket: this.config.bucket,
      Prefix: runPath
    });

    const response = await this.s3Client.send(command);

    if (!response.Contents || response.Contents.length === 0) {
      throw new Error('Scrape run is empty');
    }

    const totalFiles = response.Contents.length;
    let totalBytes = 0;
    for (const obj of response.Contents) {
      totalBytes += obj.Size || 0;
    }

    let downloadedFiles = 0;
    let downloadedBytes = 0;

    // Download each file
    for (const obj of response.Contents) {
      const key = obj.Key!;
      const fileSize = obj.Size || 0;

      const relativePath = key.replace(runPath, '');
      if (!relativePath) continue;

      const localFilePath = path.join(localPath, relativePath);
      await fs.mkdir(path.dirname(localFilePath), { recursive: true });

      // Download file
      await this.downloadFile(key, localFilePath);

      downloadedFiles++;
      downloadedBytes += fileSize;

      // Report progress
      if (onProgress) {
        onProgress({
          totalFiles,
          downloadedFiles,
          totalBytes,
          downloadedBytes,
          percentComplete: Math.round((downloadedFiles / totalFiles) * 100),
          currentFile: relativePath
        });
      }
    }

    const duration = Date.now() - startTime;
    logger.info('Download complete', { localPath, filesDownloaded: downloadedFiles, duration });

    return {
      success: true,
      localPath,
      filesDownloaded: downloadedFiles,
      totalBytes: downloadedBytes,
      duration
    };
  }

  /**
   * Clean up downloaded scrape run
   */
  async cleanup(localPath: string): Promise<void> {
    logger.info('Cleaning up downloaded files', { localPath });
    try {
      await fs.rm(localPath, { recursive: true, force: true });
    } catch (error: any) {
      logger.warn('Failed to cleanup', { localPath, error: error.message });
    }
  }

  /**
   * Get the temp directory path for a run
   */
  getLocalPath(runId: string): string {
    return path.join(this.downloadTempDir, runId);
  }

  // Private methods

  private async downloadFile(s3Key: string, localPath: string): Promise<void> {
    const command = new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: s3Key
    });

    const response = await this.s3Client.send(command);

    if (!response.Body) {
      throw new Error('No response body');
    }

    const writeStream = createWriteStream(localPath);
    await pipeline(response.Body as any, writeStream);
  }

  private parseTimestampFromRunId(runId: string): Date {
    const timestampMatch = runId.match(/^(\d{8})_(\d{6})/);
    if (timestampMatch) {
      const dateStr = timestampMatch[1];
      const timeStr = timestampMatch[2];
      const year = parseInt(dateStr.substring(0, 4));
      const month = parseInt(dateStr.substring(4, 6)) - 1;
      const day = parseInt(dateStr.substring(6, 8));
      const hour = parseInt(timeStr.substring(0, 2));
      const minute = parseInt(timeStr.substring(2, 4));
      const second = parseInt(timeStr.substring(4, 6));
      return new Date(year, month, day, hour, minute, second);
    }
    return new Date();
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  }
}

/**
 * Create S3Service from environment variables
 */
export function createS3ServiceFromEnv(): S3Service {
  const config: S3Config = {
    region: process.env.AWS_DEFAULT_REGION || process.env.AWS_REGION || 'ap-southeast-2',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    bucket: process.env.AWS_S3_BUCKET || 'agar-documentation',
    prefix: process.env.S3_SCRAPE_PREFIX || 'agar/'
  };

  const tempDir = process.env.TEMP_DIRECTORY || '/tmp/agar-scrapes';
  return new S3Service(config, tempDir);
}
