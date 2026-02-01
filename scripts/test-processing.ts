#!/usr/bin/env node

/**
 * Test processing script - processes 50 posters in batches of 5
 */

import { handleScanPosters } from '../src/server/handlers/toolHandlers/scanPosters.js';
import { handleProcessPosterBatch } from '../src/server/handlers/toolHandlers/processPosterBatch.js';
import { KnowledgeGraphManager } from '../src/KnowledgeGraphManager.js';
import { initializeStorageProvider } from '../src/config/storage.js';

async function main() {
  const sourcePath = process.env.SOURCE_IMAGES_PATH || './instances/posters/SourceImages';
  const batchSize = 5;
  const maxPosters = 50;

  console.log('='.repeat(60));
  console.log('POSTER PROCESSING TEST');
  console.log('='.repeat(60));
  console.log(`Source: ${sourcePath}`);
  console.log(`Batch size: ${batchSize}`);
  console.log(`Max posters: ${maxPosters}`);
  console.log('');

  // Initialize storage provider and knowledge graph manager
  console.log('Initializing storage provider...');
  const storageProvider = initializeStorageProvider();
  console.log('Storage provider initialized.');

  console.log('Initializing Knowledge Graph Manager...');
  const knowledgeGraphManager = new KnowledgeGraphManager({
    storageProvider
  });
  console.log('Knowledge Graph Manager initialized.\n');

  // Scan for files
  console.log('Scanning for images...');
  const scanResult = await handleScanPosters({
    sourcePath,
    limit: maxPosters
  });

  if (!scanResult.success) {
    console.error('Scan failed:', scanResult.error);
    process.exit(1);
  }

  console.log(`Found ${scanResult.totalFiles} total images`);
  console.log(`Processing up to ${Math.min(scanResult.files.length, maxPosters)} images\n`);

  // Process in batches
  let offset = 0;
  let totalProcessed = 0;
  let totalSucceeded = 0;
  let totalFailed = 0;
  let totalSkipped = 0;
  let batchNumber = 0;
  const startTime = Date.now();

  const filesToProcess = Math.min(scanResult.files.length, maxPosters);

  while (offset < filesToProcess) {
    batchNumber++;
    console.log(`\n--- Batch ${batchNumber} (offset: ${offset}, limit: ${batchSize}) ---`);

    const batchResult = await handleProcessPosterBatch(
      {
        sourcePath,
        batchSize,
        offset,
        skipIfExists: true,
        storeImages: false // Skip MinIO storage for speed in test
      },
      knowledgeGraphManager
    );

    totalProcessed += batchResult.processed;
    totalSucceeded += batchResult.succeeded;
    totalFailed += batchResult.failed;
    totalSkipped += batchResult.skipped;

    console.log(`  Processed: ${batchResult.processed}`);
    console.log(`  Succeeded: ${batchResult.succeeded}`);
    console.log(`  Failed: ${batchResult.failed}`);
    console.log(`  Skipped: ${batchResult.skipped}`);

    if (batchResult.entities.length > 0) {
      console.log(`  Entities created:`);
      for (const entity of batchResult.entities.slice(0, 3)) {
        if (entity.success) {
          console.log(`    - ${entity.name} (${entity.headliner || 'unknown'} @ ${entity.venue || 'unknown'})`);
        }
      }
      if (batchResult.entities.length > 3) {
        console.log(`    ... and ${batchResult.entities.length - 3} more`);
      }
    }

    if (batchResult.errors.length > 0) {
      console.log(`  Errors:`);
      for (const err of batchResult.errors.slice(0, 2)) {
        console.log(`    - ${err.substring(0, 100)}...`);
      }
    }

    offset += batchSize;

    // Small delay between batches
    if (offset < filesToProcess) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  const duration = (Date.now() - startTime) / 1000;

  console.log('\n' + '='.repeat(60));
  console.log('PROCESSING COMPLETE');
  console.log('='.repeat(60));
  console.log(`Total processed: ${totalProcessed}`);
  console.log(`Total succeeded: ${totalSucceeded}`);
  console.log(`Total failed: ${totalFailed}`);
  console.log(`Total skipped: ${totalSkipped}`);
  console.log(`Duration: ${duration.toFixed(1)}s`);
  console.log(`Average: ${(duration / Math.max(totalProcessed, 1)).toFixed(2)}s per poster`);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
