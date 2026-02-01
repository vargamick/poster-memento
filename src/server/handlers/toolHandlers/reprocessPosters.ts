/**
 * Reprocess Posters Tool Handler
 *
 * Orchestrates the full pipeline for reprocessing all posters:
 * 1. Backup existing database (optional)
 * 2. Reset/truncate databases
 * 3. Reprocess all posters from source directory
 */

import { KnowledgeGraphManager } from '../../../KnowledgeGraphManager.js';
import { logger } from '../../../utils/logger.js';
import { handleBackupDatabase } from './backupDatabase.js';
import { handleResetDatabase } from './resetDatabase.js';
import { handleProcessPosterBatch } from './processPosterBatch.js';
import { handleScanPosters } from './scanPosters.js';

export interface ReprocessPostersArgs {
  /**
   * Confirmation token - must be "CONFIRM_REPROCESS" to proceed.
   * This prevents accidental data loss.
   */
  confirmationToken: string;
  /** Skip the backup phase (not recommended) */
  skipBackup?: boolean;
  /** Path to source images directory */
  sourcePath?: string;
  /** Number of images to process per batch */
  batchSize?: number;
  /** Whether to compress backup files */
  compressBackup?: boolean;
}

export interface ReprocessPostersResult {
  success: boolean;
  timestamp: string;
  phases: Array<{
    phase: string;
    success: boolean;
    duration: number;
    details?: Record<string, unknown>;
    error?: string;
  }>;
  summary?: {
    totalFiles: number;
    processed: number;
    succeeded: number;
    failed: number;
    skipped: number;
    backupPath?: string;
  };
  error?: string;
}

/**
 * Handle the reprocess_posters tool request
 */
export async function handleReprocessPosters(
  args: ReprocessPostersArgs,
  knowledgeGraphManager: KnowledgeGraphManager
): Promise<ReprocessPostersResult> {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();
  const sourcePath = args.sourcePath || process.env.SOURCE_IMAGES_PATH || './SourceImages';
  const batchSize = args.batchSize || parseInt(process.env.BATCH_SIZE || '5');

  // Validate confirmation token
  if (args.confirmationToken !== 'CONFIRM_REPROCESS') {
    logger.warn('Reprocess attempted without valid confirmation token');
    return {
      success: false,
      timestamp,
      phases: [],
      error: 'Invalid confirmation token. Must provide confirmationToken: "CONFIRM_REPROCESS" to proceed. This is a safety measure to prevent accidental data loss.'
    };
  }

  logger.info('Starting poster reprocessing pipeline', {
    sourcePath,
    batchSize,
    skipBackup: args.skipBackup
  });

  const result: ReprocessPostersResult = {
    success: true,
    timestamp,
    phases: []
  };

  try {
    // Phase 1: Backup (optional but recommended)
    if (!args.skipBackup) {
      logger.info('Phase 1: Starting database backup');
      const backupStartTime = Date.now();

      const backupResult = await handleBackupDatabase({
        compress: args.compressBackup
      });

      result.phases.push({
        phase: 'backup',
        success: backupResult.success,
        duration: Date.now() - backupStartTime,
        details: backupResult.success ? {
          timestamp: backupResult.timestamp,
          neo4jBackupPath: backupResult.neo4jBackupPath,
          postgresBackupPath: backupResult.postgresBackupPath,
          stats: backupResult.stats
        } : undefined,
        error: backupResult.error
      });

      if (!backupResult.success) {
        logger.error('Backup failed, aborting pipeline');
        result.success = false;
        return result;
      }

      // Store backup path for summary
      if (backupResult.neo4jBackupPath) {
        result.summary = {
          ...result.summary,
          totalFiles: 0,
          processed: 0,
          succeeded: 0,
          failed: 0,
          skipped: 0,
          backupPath: backupResult.neo4jBackupPath.replace(/\/[^/]+$/, '')
        };
      }
    } else {
      logger.info('Phase 1: Skipping backup (--skipBackup)');
      result.phases.push({
        phase: 'backup',
        success: true,
        duration: 0,
        details: { skipped: true }
      });
    }

    // Phase 2: Reset databases
    logger.info('Phase 2: Starting database reset');
    const resetStartTime = Date.now();

    const resetResult = await handleResetDatabase({
      confirmationToken: 'CONFIRM_RESET'
    });

    result.phases.push({
      phase: 'reset',
      success: resetResult.success,
      duration: Date.now() - resetStartTime,
      details: resetResult.success ? {
        beforeStats: resetResult.beforeStats,
        afterStats: resetResult.afterStats
      } : undefined,
      error: resetResult.error
    });

    if (!resetResult.success) {
      logger.error('Reset failed, aborting pipeline');
      result.success = false;
      return result;
    }

    // Phase 3: Reprocess all posters
    logger.info('Phase 3: Starting poster processing');
    const processStartTime = Date.now();

    // First scan to get total file count
    const scanResult = await handleScanPosters({
      sourcePath,
      limit: 10000
    });

    if (!scanResult.success) {
      result.phases.push({
        phase: 'process',
        success: false,
        duration: Date.now() - processStartTime,
        error: scanResult.error || 'Failed to scan source directory'
      });
      result.success = false;
      return result;
    }

    const totalFiles = scanResult.totalFiles;
    logger.info(`Found ${totalFiles} images to process`);

    // Process in batches
    let offset = 0;
    let totalProcessed = 0;
    let totalSucceeded = 0;
    let totalFailed = 0;
    let totalSkipped = 0;
    const batchErrors: string[] = [];

    while (offset < totalFiles) {
      const batchResult = await handleProcessPosterBatch(
        {
          sourcePath,
          batchSize,
          offset,
          skipIfExists: false, // Don't skip since we just reset
          storeImages: true
        },
        knowledgeGraphManager
      );

      totalProcessed += batchResult.processed;
      totalSucceeded += batchResult.succeeded;
      totalFailed += batchResult.failed;
      totalSkipped += batchResult.skipped;

      if (batchResult.errors.length > 0) {
        batchErrors.push(...batchResult.errors.slice(0, 5));
      }

      logger.info(`Batch complete`, {
        offset,
        succeeded: batchResult.succeeded,
        failed: batchResult.failed,
        remaining: totalFiles - offset - batchSize
      });

      offset += batchSize;

      // Small delay between batches
      if (offset < totalFiles) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    result.phases.push({
      phase: 'process',
      success: totalFailed === 0,
      duration: Date.now() - processStartTime,
      details: {
        totalFiles,
        processed: totalProcessed,
        succeeded: totalSucceeded,
        failed: totalFailed,
        skipped: totalSkipped,
        sampleErrors: batchErrors.slice(0, 5)
      }
    });

    // Build summary
    result.summary = {
      ...result.summary,
      totalFiles,
      processed: totalProcessed,
      succeeded: totalSucceeded,
      failed: totalFailed,
      skipped: totalSkipped
    };

    if (totalFailed > 0) {
      logger.warn('Processing completed with some failures', {
        succeeded: totalSucceeded,
        failed: totalFailed
      });
      result.success = false;
    } else {
      logger.info('Processing completed successfully', {
        totalProcessed,
        totalSucceeded
      });
    }

    return result;

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Pipeline failed with error', { error: errorMessage });

    result.success = false;
    result.error = errorMessage;
    return result;
  }
}
