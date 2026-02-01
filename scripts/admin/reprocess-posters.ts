#!/usr/bin/env node

/**
 * CLI wrapper for poster reprocessing pipeline
 * Run with: npx tsx scripts/admin/reprocess-posters.ts [options]
 *
 * Options:
 *   --skip-backup     Skip the backup step
 *   --skip-confirm    Skip confirmation prompts (dangerous!)
 *   --source-path     Path to source images directory
 *   --batch-size      Number of images to process per batch
 *   --compress        Compress backup files
 */

import { createInterface } from 'readline';
import path from 'path';
import { DatabaseBackup, DatabaseResetter, getBackupConfigFromEnv, getResetConfigFromEnv } from '../../src/pipeline/index.js';

interface PipelineConfig {
  skipBackup: boolean;
  skipConfirmation: boolean;
  sourcePath: string;
  batchSize: number;
  compress: boolean;
}

interface PipelineResult {
  success: boolean;
  timestamp: string;
  phases: Array<{
    phase: string;
    success: boolean;
    duration: number;
    error?: string;
  }>;
  processResult?: {
    totalFiles: number;
    processed: number;
    succeeded: number;
    failed: number;
    skipped: number;
  };
  totalDuration: number;
}

/**
 * Parse command line arguments
 */
function parseArgs(): PipelineConfig {
  const args = process.argv.slice(2);

  const config: PipelineConfig = {
    skipBackup: args.includes('--skip-backup'),
    skipConfirmation: args.includes('--skip-confirm') || args.includes('-y'),
    sourcePath: process.env.SOURCE_IMAGES_PATH || './SourceImages',
    batchSize: parseInt(process.env.BATCH_SIZE || '5'),
    compress: args.includes('--compress')
  };

  // Parse --source-path argument
  const sourcePathIndex = args.indexOf('--source-path');
  if (sourcePathIndex !== -1 && args[sourcePathIndex + 1]) {
    config.sourcePath = args[sourcePathIndex + 1];
  }

  // Parse --batch-size argument
  const batchSizeIndex = args.indexOf('--batch-size');
  if (batchSizeIndex !== -1 && args[batchSizeIndex + 1]) {
    config.batchSize = parseInt(args[batchSizeIndex + 1]);
  }

  return config;
}

/**
 * Confirm pipeline execution
 */
async function confirmPipeline(config: PipelineConfig): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    console.log('\n' + '!'.repeat(70));
    console.log('WARNING: This will reset the database and reprocess all posters!');
    if (config.skipBackup) {
      console.log('NOTE: Backup is DISABLED - you will lose all existing data!');
    }
    console.log('!'.repeat(70));

    rl.question('\nType "REPROCESS" to confirm: ', (answer) => {
      rl.close();
      resolve(answer.trim() === 'REPROCESS');
    });
  });
}

/**
 * Execute the pipeline
 */
async function executePipeline(config: PipelineConfig): Promise<PipelineResult> {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();

  console.log('='.repeat(70));
  console.log('       POSTER MEMENTO - REPROCESSING PIPELINE');
  console.log('='.repeat(70));
  console.log(`\nTimestamp: ${timestamp}`);
  console.log(`Source Path: ${config.sourcePath}`);
  console.log(`Batch Size: ${config.batchSize}`);
  console.log(`Skip Backup: ${config.skipBackup}`);
  console.log('');

  const result: PipelineResult = {
    success: true,
    timestamp,
    phases: [],
    totalDuration: 0
  };

  try {
    // Confirm before proceeding
    if (!config.skipConfirmation) {
      const confirmed = await confirmPipeline(config);
      if (!confirmed) {
        console.log('\nPipeline cancelled by user.');
        result.success = false;
        result.totalDuration = Date.now() - startTime;
        return result;
      }
    }

    // Phase 1: Backup (optional)
    if (!config.skipBackup) {
      console.log('\n' + '='.repeat(70));
      console.log('PHASE 1: DATABASE BACKUP');
      console.log('='.repeat(70));

      const backupStartTime = Date.now();
      try {
        const backupConfig = getBackupConfigFromEnv();
        backupConfig.compress = config.compress;

        const backup = new DatabaseBackup(backupConfig);
        await backup.backup();

        result.phases.push({
          phase: 'backup',
          success: true,
          duration: Date.now() - backupStartTime
        });
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        result.phases.push({
          phase: 'backup',
          success: false,
          duration: Date.now() - backupStartTime,
          error: errorMessage
        });
        console.error('\nBackup failed. Aborting pipeline.');
        result.success = false;
        result.totalDuration = Date.now() - startTime;
        return result;
      }
    } else {
      console.log('\n[SKIPPED] Phase 1: Database Backup');
    }

    // Phase 2: Reset databases
    console.log('\n' + '='.repeat(70));
    console.log('PHASE 2: DATABASE RESET');
    console.log('='.repeat(70));

    const resetStartTime = Date.now();
    try {
      const resetConfig = getResetConfigFromEnv(true); // Skip confirmation since we already confirmed

      const resetter = new DatabaseResetter(resetConfig);
      await resetter.reset();

      result.phases.push({
        phase: 'reset',
        success: true,
        duration: Date.now() - resetStartTime
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.phases.push({
        phase: 'reset',
        success: false,
        duration: Date.now() - resetStartTime,
        error: errorMessage
      });
      console.error('\nReset failed. Aborting pipeline.');
      result.success = false;
      result.totalDuration = Date.now() - startTime;
      return result;
    }

    // Phase 3: Reprocess posters
    console.log('\n' + '='.repeat(70));
    console.log('PHASE 3: POSTER REPROCESSING');
    console.log('='.repeat(70));

    const processStartTime = Date.now();
    try {
      // Dynamic imports to avoid loading processing dependencies until needed
      const { handleScanPosters } = await import('../../src/server/handlers/toolHandlers/scanPosters.js');
      const { handleProcessPosterBatch } = await import('../../src/server/handlers/toolHandlers/processPosterBatch.js');
      const { KnowledgeGraphManager } = await import('../../src/KnowledgeGraphManager.js');

      // Initialize knowledge graph manager
      const knowledgeGraphManager = new KnowledgeGraphManager();
      await knowledgeGraphManager.initialize();

      // Scan for files
      console.log(`\nScanning source directory: ${config.sourcePath}`);
      const scanResult = await handleScanPosters({
        sourcePath: config.sourcePath,
        limit: 10000
      });

      if (!scanResult.success) {
        throw new Error(scanResult.error || 'Failed to scan source directory');
      }

      const totalFiles = scanResult.totalFiles;
      console.log(`Found ${totalFiles} images to process\n`);

      // Process in batches
      let offset = 0;
      let totalProcessed = 0;
      let totalSucceeded = 0;
      let totalFailed = 0;
      let totalSkipped = 0;
      let batchNumber = 0;

      while (offset < totalFiles) {
        batchNumber++;
        console.log(`\nProcessing batch ${batchNumber} (offset: ${offset}, limit: ${config.batchSize})...`);

        const batchResult = await handleProcessPosterBatch(
          {
            sourcePath: config.sourcePath,
            batchSize: config.batchSize,
            offset,
            skipIfExists: false,
            storeImages: true
          },
          knowledgeGraphManager
        );

        totalProcessed += batchResult.processed;
        totalSucceeded += batchResult.succeeded;
        totalFailed += batchResult.failed;
        totalSkipped += batchResult.skipped;

        console.log(`  Batch ${batchNumber}: ${batchResult.succeeded} succeeded, ${batchResult.failed} failed, ${batchResult.skipped} skipped`);

        if (batchResult.errors.length > 0) {
          console.log(`  Errors:`);
          for (const err of batchResult.errors.slice(0, 3)) {
            console.log(`    - ${err}`);
          }
          if (batchResult.errors.length > 3) {
            console.log(`    ... and ${batchResult.errors.length - 3} more errors`);
          }
        }

        offset += config.batchSize;

        // Small delay between batches
        if (offset < totalFiles) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      result.processResult = {
        totalFiles,
        processed: totalProcessed,
        succeeded: totalSucceeded,
        failed: totalFailed,
        skipped: totalSkipped
      };

      result.phases.push({
        phase: 'process',
        success: totalFailed === 0,
        duration: Date.now() - processStartTime
      });

      if (totalFailed > 0) {
        result.success = false;
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.phases.push({
        phase: 'process',
        success: false,
        duration: Date.now() - processStartTime,
        error: errorMessage
      });
      result.success = false;
    }

    // Summary
    result.totalDuration = Date.now() - startTime;
    printSummary(result);

    return result;

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('\nPipeline failed with error:', errorMessage);

    result.success = false;
    result.totalDuration = Date.now() - startTime;
    return result;
  }
}

/**
 * Print pipeline summary
 */
function printSummary(result: PipelineResult): void {
  console.log('\n' + '='.repeat(70));
  console.log('       PIPELINE SUMMARY');
  console.log('='.repeat(70));

  console.log(`\nOverall Status: ${result.success ? 'SUCCESS' : 'FAILED'}`);
  console.log(`Total Duration: ${(result.totalDuration / 1000).toFixed(1)}s`);

  console.log('\nPhase Results:');
  for (const phase of result.phases) {
    const status = phase.success ? 'OK' : 'FAILED';
    const duration = (phase.duration / 1000).toFixed(1);
    console.log(`  ${phase.phase.padEnd(12)} ${status.padEnd(8)} (${duration}s)`);
    if (phase.error) {
      console.log(`    Error: ${phase.error}`);
    }
  }

  if (result.processResult) {
    console.log('\nProcessing Results:');
    console.log(`  Total Files:  ${result.processResult.totalFiles}`);
    console.log(`  Processed:    ${result.processResult.processed}`);
    console.log(`  Succeeded:    ${result.processResult.succeeded}`);
    console.log(`  Failed:       ${result.processResult.failed}`);
    console.log(`  Skipped:      ${result.processResult.skipped}`);
  }

  console.log('\n' + '='.repeat(70));
}

/**
 * Main execution
 */
async function main() {
  const config = parseArgs();

  // Validate environment
  if (!process.env.NEO4J_PASSWORD) {
    console.error('Error: NEO4J_PASSWORD environment variable is required');
    process.exit(1);
  }

  if (!process.env.POSTGRES_PASSWORD) {
    console.error('Error: POSTGRES_PASSWORD environment variable is required');
    process.exit(1);
  }

  try {
    const result = await executePipeline(config);
    process.exit(result.success ? 0 : 1);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('\nFATAL ERROR:', errorMessage);
    process.exit(1);
  }
}

main();
