#!/usr/bin/env tsx
/**
 * Test Selected Posters - Process specific posters for validation
 */

import * as fs from 'fs';
import 'dotenv/config';
import { createPosterProcessor } from '../../src/image-processor/index.js';

const TEST_POSTERS = [
  '/Users/mick/AI/GregRako/PastedandWasted/Posters/SourceImages/concertformax.DONE.JPG',
  '/Users/mick/AI/GregRako/PastedandWasted/Posters/SourceImages/rollingstones.DONE.JPG',
  '/Users/mick/AI/GregRako/PastedandWasted/Posters/SourceImages/junglebroslive.DONE.JPG',
  '/Users/mick/AI/GregRako/PastedandWasted/Posters/SourceImages/12bent.DONE.JPG',
  '/Users/mick/AI/GregRako/PastedandWasted/Posters/SourceImages/beegeesshow.DONE.JPG',
];

async function main() {
  console.log('='.repeat(70));
  console.log('Testing Selected Music Posters');
  console.log('='.repeat(70));

  const processor = await createPosterProcessor();
  const results = [];

  for (const posterPath of TEST_POSTERS) {
    const filename = posterPath.split('/').pop();
    console.log(`\nProcessing: ${filename}...`);
    
    const result = await processor.processImage(posterPath);
    
    if (result.success && result.entity) {
      const e = result.entity;
      console.log(`  ✓ Title: ${e.title || '-'}`);
      console.log(`  ✓ Headliner: ${e.headliner || '-'}`);
      console.log(`  ✓ Venue: ${e.venue_name || '-'}`);
      console.log(`  ✓ Date: ${e.event_date || '-'}`);
      console.log(`  ✓ Year: ${e.year || '-'}`);
      console.log(`  ✓ Supporting Acts: ${e.supporting_acts?.length || 0}`);
      console.log(`  ✓ Time: ${result.processingTimeMs}ms`);
      results.push(result.entity);
    } else {
      console.log(`  ✗ Failed: ${result.error}`);
    }
  }

  // Save results
  const outputFile = './output/test-selected-results.json';
  fs.writeFileSync(outputFile, JSON.stringify(results, null, 2));
  console.log(`\n${'='.repeat(70)}`);
  console.log(`Results saved to: ${outputFile}`);
  console.log(`Total processed: ${results.length}/${TEST_POSTERS.length}`);
}

main().catch(console.error);
