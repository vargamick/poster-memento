#!/usr/bin/env npx tsx
/**
 * Process 50 Posters Script
 *
 * Processes 50 poster images using the updated relationship types:
 * - HEADLINED_ON for headliner artists
 * - PERFORMED_ON for supporting/performing artists
 */

import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

// Load environment from instance .env file BEFORE importing other modules
const envPath = path.resolve('./instances/posters/.env');
if (fs.existsSync(envPath)) {
  console.log(`Loading environment from: ${envPath}`);
  dotenv.config({ path: envPath });
} else {
  console.warn(`Warning: .env file not found at ${envPath}`);
}

// Now import modules that depend on environment variables
import { KnowledgeGraphManager } from '../src/KnowledgeGraphManager.js';
import { initializeStorageProvider } from '../src/config/storage.js';
import { handleProcessPosterBatch, resetProcessingState } from '../src/server/handlers/toolHandlers/processPosterBatch.js';
import { ProcessingRunManager } from '../src/image-processor/ProcessingRunManager.js';

const SOURCE_PATH = path.resolve('./instances/posters/SourceImages');
const RUNS_PATH = path.resolve('./instances/posters/processing-runs');
const BATCH_SIZE = 10;
const TOTAL_TO_PROCESS = 50;

async function main() {
  console.log('='.repeat(60));
  console.log('Poster Processing Script');
  console.log('='.repeat(60));
  console.log(`Source: ${SOURCE_PATH}`);
  console.log(`Runs Directory: ${RUNS_PATH}`);
  console.log(`Total to process: ${TOTAL_TO_PROCESS}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log('='.repeat(60));

  // Verify embedding configuration
  console.log('\n[Environment Configuration]');
  console.log(`  EMBEDDING_PROVIDER: ${process.env.EMBEDDING_PROVIDER || 'not set'}`);
  console.log(`  VOYAGE_API_KEY: ${process.env.VOYAGE_API_KEY ? '***' + process.env.VOYAGE_API_KEY.slice(-8) : 'not set'}`);
  console.log(`  VOYAGE_EMBEDDING_MODEL: ${process.env.VOYAGE_EMBEDDING_MODEL || 'not set'}`);
  console.log(`  EMBEDDING_DIMENSIONS: ${process.env.EMBEDDING_DIMENSIONS || 'not set'}`);
  console.log(`  OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? '***' + process.env.OPENAI_API_KEY.slice(-8) : 'not set'}`);
  console.log('='.repeat(60));

  // Initialize storage provider
  console.log('\n[1/4] Initializing storage provider...');
  const storageProvider = initializeStorageProvider();

  // Create KnowledgeGraphManager
  const knowledgeGraphManager = new KnowledgeGraphManager({
    storageProvider
  });

  // Initialize ProcessingRunManager
  console.log('\n[2/4] Initializing ProcessingRunManager...');
  const runManager = new ProcessingRunManager(RUNS_PATH);

  // Get list of image files
  const files = fs.readdirSync(SOURCE_PATH)
    .filter(f => /\.(jpg|jpeg|png)$/i.test(f))
    .slice(0, TOTAL_TO_PROCESS)
    .map(f => path.join(SOURCE_PATH, f));

  console.log(`Found ${files.length} images to process`);

  // Start a new processing run
  console.log('\n[3/4] Starting processing run...');
  const runMetadata = runManager.startRun({
    sourceDirectory: SOURCE_PATH,
    visionModel: process.env.VISION_MODEL || 'minicpm-v',
    runName: `Test run - ${TOTAL_TO_PROCESS} posters with new relationships`,
    processingOptions: {
      batchSize: BATCH_SIZE,
      skipIfExists: false,
      storeImages: true
    }
  });
  runManager.setTotalFiles(files.length);

  console.log(`Run ID: ${runMetadata.runId}`);

  // Reset processing state to ensure fresh start
  resetProcessingState(SOURCE_PATH);

  // Process in batches
  console.log('\n[4/4] Processing posters...');
  let totalProcessed = 0;
  let totalSucceeded = 0;
  let totalFailed = 0;
  let totalSkipped = 0;

  const batches = Math.ceil(files.length / BATCH_SIZE);

  for (let batch = 0; batch < batches; batch++) {
    const offset = batch * BATCH_SIZE;
    const batchFiles = files.slice(offset, offset + BATCH_SIZE);

    console.log(`\n--- Batch ${batch + 1}/${batches} (${batchFiles.length} files) ---`);

    const startTime = Date.now();

    try {
      const result = await handleProcessPosterBatch({
        filePaths: batchFiles,
        batchSize: BATCH_SIZE,
        skipIfExists: false,
        storeImages: true
      }, knowledgeGraphManager);

      totalProcessed += result.processed;
      totalSucceeded += result.succeeded;
      totalFailed += result.failed;
      totalSkipped += result.skipped;

      const elapsedMs = Date.now() - startTime;

      console.log(`  Processed: ${result.processed}`);
      console.log(`  Succeeded: ${result.succeeded}`);
      console.log(`  Failed: ${result.failed}`);
      console.log(`  Skipped: ${result.skipped}`);
      console.log(`  Time: ${(elapsedMs / 1000).toFixed(1)}s`);

      // Record each file in the run
      for (const entity of result.entities) {
        const filePath = batchFiles.find(f => f.includes(entity.name.replace('poster_', ''))) || entity.name;

        runManager.recordProcessedFile({
          filePath,
          filename: path.basename(filePath),
          fileHash: entity.name.split('_')[1] || 'unknown',
          fileSizeBytes: 0,
          success: entity.success,
          error: entity.error,
          processingTimeMs: entity.processingTimeMs,
          entityName: entity.success ? entity.name : undefined,
          processedAt: new Date().toISOString()
        });
      }

      if (result.errors.length > 0) {
        console.log(`  Errors:`);
        result.errors.forEach(e => console.log(`    - ${e}`));
      }

    } catch (error) {
      console.error(`  Batch ${batch + 1} failed:`, error);
    }
  }

  // Complete the run
  const finalMetadata = runManager.completeRun('completed');

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('PROCESSING COMPLETE');
  console.log('='.repeat(60));
  console.log(`Run ID: ${finalMetadata?.runId}`);
  console.log(`Total Processed: ${totalProcessed}`);
  console.log(`Succeeded: ${totalSucceeded}`);
  console.log(`Failed: ${totalFailed}`);
  console.log(`Skipped: ${totalSkipped}`);
  console.log(`Run directory: ${runManager.getRunsDirectory()}/${finalMetadata?.runId}`);
  console.log('='.repeat(60));

  // Verify graph structure
  console.log('\n[Verification] Checking graph structure...');
  try {
    const graph = await knowledgeGraphManager.readGraph();
    console.log(`  Entities: ${graph.entities.length}`);
    console.log(`  Relations: ${graph.relations.length}`);

    // Count by type
    const entityTypes = new Map<string, number>();
    for (const entity of graph.entities) {
      const count = entityTypes.get(entity.entityType) || 0;
      entityTypes.set(entity.entityType, count + 1);
    }
    console.log('  Entity types:');
    for (const [type, count] of entityTypes) {
      console.log(`    - ${type}: ${count}`);
    }

    // Count relation types
    const relationTypes = new Map<string, number>();
    for (const relation of graph.relations) {
      const count = relationTypes.get(relation.relationType) || 0;
      relationTypes.set(relation.relationType, count + 1);
    }
    console.log('  Relation types:');
    for (const [type, count] of relationTypes) {
      console.log(`    - ${type}: ${count}`);
    }

  } catch (error) {
    console.error('  Error reading graph:', error);
  }

  process.exit(0);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
