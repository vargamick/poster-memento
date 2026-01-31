#!/usr/bin/env tsx
/**
 * Main Poster Processing Script - Process all posters and populate knowledge graph
 */

import * as fs from 'fs';
import * as path from 'path';
import 'dotenv/config';

import { createPosterProcessor, PosterProcessor, PosterEntity } from '../../src/image-processor/index.js';
import { VisionModelFactory } from '../../src/image-processor/VisionModelFactory.js';

const SUPPORTED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf', '.tiff', '.tif', '.bmp'];

interface ProcessingStats {
  total: number;
  processed: number;
  successful: number;
  failed: number;
  skipped: number;
  startTime: Date;
  endTime?: Date;
}

/**
 * Discover files in directory
 */
function discoverFiles(dir: string): string[] {
  const files: string[] = [];

  if (!fs.existsSync(dir)) {
    console.error(`Directory not found: ${dir}`);
    return files;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...discoverFiles(fullPath));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (SUPPORTED_EXTENSIONS.includes(ext)) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

/**
 * Delay helper
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Format duration
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/**
 * Print progress bar
 */
function printProgress(current: number, total: number, filename: string, stats: ProcessingStats) {
  const percent = Math.round((current / total) * 100);
  const barLength = 30;
  const filled = Math.round((current / total) * barLength);
  const bar = '█'.repeat(filled) + '░'.repeat(barLength - filled);

  const elapsed = Date.now() - stats.startTime.getTime();
  const avgTime = current > 0 ? elapsed / current : 0;
  const remaining = avgTime * (total - current);

  process.stdout.write(
    `\r[${bar}] ${percent}% (${current}/${total}) ` +
    `✓${stats.successful} ✗${stats.failed} ` +
    `ETA: ${formatDuration(remaining)} | ${path.basename(filename).slice(0, 30)}`
  );
}

/**
 * Main processing function
 */
async function main() {
  console.log('='.repeat(70));
  console.log('Poster Memento - Batch Processing');
  console.log('='.repeat(70));

  // Configuration
  const sourceDir = process.env.SOURCE_IMAGES_PATH || './source-images';
  const batchSize = parseInt(process.env.BATCH_SIZE || '10', 10);
  const delayMs = parseInt(process.env.PROCESSING_DELAY_MS || '1000', 10);
  const skipExisting = process.argv.includes('--skip-existing');
  const dryRun = process.argv.includes('--dry-run');
  const limitArg = process.argv.find(a => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : undefined;

  // Show configuration
  console.log('\nConfiguration:');
  console.log('-'.repeat(40));
  console.log(`  Source Directory: ${sourceDir}`);
  console.log(`  Batch Size: ${batchSize}`);
  console.log(`  Delay Between Images: ${delayMs}ms`);
  console.log(`  Skip Existing: ${skipExisting}`);
  console.log(`  Dry Run: ${dryRun}`);
  if (limit) console.log(`  Limit: ${limit} files`);

  // Check vision model
  const modelKey = VisionModelFactory.getDefaultModelKey();
  const modelConfig = VisionModelFactory.getModelConfig(modelKey);
  console.log(`  Vision Model: ${modelKey}`);
  console.log(`  Model Provider: ${modelConfig?.provider || 'unknown'}`);

  // Discover files
  console.log('\nDiscovering files...');
  let files = discoverFiles(sourceDir);

  if (limit && limit < files.length) {
    files = files.slice(0, limit);
  }

  console.log(`Found ${files.length} files to process`);

  if (files.length === 0) {
    console.log('No files found. Exiting.');
    return;
  }

  if (dryRun) {
    console.log('\n[DRY RUN] Would process the following files:');
    for (const file of files.slice(0, 20)) {
      console.log(`  - ${path.basename(file)}`);
    }
    if (files.length > 20) {
      console.log(`  ... and ${files.length - 20} more files`);
    }
    return;
  }

  // Initialize processor
  console.log('\nInitializing processor...');
  let processor: PosterProcessor;

  try {
    processor = await createPosterProcessor();
  } catch (error) {
    console.error('Failed to initialize processor:', error);
    console.log('\nTroubleshooting:');
    console.log('  1. Make sure Docker services are running: npm run docker:up');
    console.log('  2. Check that Ollama has the model: docker exec poster-ollama ollama list');
    console.log('  3. Pull the model if needed: npm run ollama:pull');
    return;
  }

  // Health check
  const health = await processor.healthCheck();
  console.log(`  Vision Model: ${health.vision ? '✓ OK' : '✗ FAILED'}`);
  console.log(`  Image Storage: ${health.storage ? '✓ OK' : '✗ FAILED'}`);

  if (!health.vision) {
    console.error('\nVision model is not available. Please ensure Ollama is running.');
    console.log('  Run: npm run docker:up');
    console.log('  Then: npm run ollama:pull');
    return;
  }

  // Process files
  console.log('\nProcessing files...\n');

  const stats: ProcessingStats = {
    total: files.length,
    processed: 0,
    successful: 0,
    failed: 0,
    skipped: 0,
    startTime: new Date()
  };

  const entities: PosterEntity[] = [];
  const errors: Array<{ file: string; error: string }> = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    printProgress(i + 1, files.length, file, stats);

    try {
      const result = await processor.processImage(file, {
        skipIfExists: skipExisting
      });

      stats.processed++;

      if (result.success && result.entity) {
        stats.successful++;
        entities.push(result.entity);
      } else if (result.error?.includes('already processed')) {
        stats.skipped++;
      } else {
        stats.failed++;
        errors.push({ file, error: result.error || 'Unknown error' });
      }
    } catch (error) {
      stats.processed++;
      stats.failed++;
      errors.push({
        file,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    // Delay between files
    if (i < files.length - 1 && delayMs > 0) {
      await delay(delayMs);
    }
  }

  stats.endTime = new Date();
  const totalTime = stats.endTime.getTime() - stats.startTime.getTime();

  // Final output
  console.log('\n\n' + '='.repeat(70));
  console.log('Processing Complete');
  console.log('='.repeat(70));

  console.log('\nStatistics:');
  console.log('-'.repeat(40));
  console.log(`  Total Files:    ${stats.total}`);
  console.log(`  Processed:      ${stats.processed}`);
  console.log(`  Successful:     ${stats.successful}`);
  console.log(`  Failed:         ${stats.failed}`);
  console.log(`  Skipped:        ${stats.skipped}`);
  console.log(`  Total Time:     ${formatDuration(totalTime)}`);
  console.log(`  Avg Time/File:  ${formatDuration(totalTime / stats.processed)}`);

  // Save results
  const outputDir = './output';
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  // Save entities
  const entitiesFile = path.join(outputDir, `entities-${timestamp}.json`);
  fs.writeFileSync(entitiesFile, JSON.stringify(entities, null, 2));
  console.log(`\nEntities saved to: ${entitiesFile}`);

  // Save errors if any
  if (errors.length > 0) {
    const errorsFile = path.join(outputDir, `errors-${timestamp}.json`);
    fs.writeFileSync(errorsFile, JSON.stringify(errors, null, 2));
    console.log(`Errors saved to: ${errorsFile}`);

    console.log('\nErrors:');
    console.log('-'.repeat(40));
    for (const err of errors.slice(0, 10)) {
      console.log(`  ${path.basename(err.file)}: ${err.error.slice(0, 60)}`);
    }
    if (errors.length > 10) {
      console.log(`  ... and ${errors.length - 10} more errors`);
    }
  }

  console.log('\nNext Steps:');
  console.log('-'.repeat(40));
  console.log('  1. Review extracted entities in the output file');
  console.log('  2. Import entities to Neo4j: npm run neo4j:import');
  console.log('  3. Access the Neo4j browser: http://localhost:7474');
  console.log('  4. Access MinIO console: http://localhost:9001');
}

main().catch(console.error);
