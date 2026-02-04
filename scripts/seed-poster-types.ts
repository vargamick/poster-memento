#!/usr/bin/env node

/**
 * Seed script for PosterType entities
 * Creates the canonical PosterType entities if they don't exist
 */

import { KnowledgeGraphManager } from '../src/KnowledgeGraphManager.js';
import { initializeStorageProvider } from '../src/config/storage.js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface PosterTypeSeed {
  name: string;
  entityType: string;
  type_key: string;
  display_name: string;
  description: string;
  detection_hints: string[];
}

interface SeedFile {
  description: string;
  version: string;
  entities: PosterTypeSeed[];
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const force = process.argv.includes('--force');

  console.log('='.repeat(60));
  console.log('POSTER TYPE SEED SCRIPT');
  console.log('='.repeat(60));
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Force: ${force ? 'YES (will recreate existing)' : 'NO (skip existing)'}`);
  console.log('');

  // Load seed data
  const seedPath = resolve(__dirname, '../instances/posters/seeds/poster-types.json');
  console.log(`Loading seed data from: ${seedPath}`);

  const seedData: SeedFile = JSON.parse(readFileSync(seedPath, 'utf-8'));
  console.log(`Found ${seedData.entities.length} PosterType definitions`);
  console.log('');

  if (dryRun) {
    console.log('DRY RUN - Would create the following entities:');
    for (const entity of seedData.entities) {
      console.log(`  - ${entity.name} (${entity.display_name}): ${entity.description}`);
    }
    console.log('');
    console.log('Run without --dry-run to create entities.');
    return;
  }

  // Initialize storage
  console.log('Initializing storage provider...');
  const storageProvider = initializeStorageProvider();

  console.log('Initializing Knowledge Graph Manager...');
  const knowledgeGraphManager = new KnowledgeGraphManager({
    storageProvider
  });
  console.log('');

  // Check for existing PosterType entities
  console.log('Checking for existing PosterType entities...');
  const existingGraph = await knowledgeGraphManager.loadGraph();
  const existingPosterTypes = existingGraph.entities.filter(
    e => e.entityType === 'PosterType'
  );
  console.log(`Found ${existingPosterTypes.length} existing PosterType entities`);

  // Determine which entities to create
  const existingNames = new Set(existingPosterTypes.map(e => e.name));
  const entitiesToCreate = seedData.entities.filter(entity => {
    if (existingNames.has(entity.name)) {
      if (force) {
        console.log(`  Will recreate: ${entity.name}`);
        return true;
      } else {
        console.log(`  Skipping (exists): ${entity.name}`);
        return false;
      }
    }
    console.log(`  Will create: ${entity.name}`);
    return true;
  });

  if (entitiesToCreate.length === 0) {
    console.log('');
    console.log('No new entities to create. All PosterType entities already exist.');
    console.log('Use --force to recreate existing entities.');
    return;
  }

  console.log('');
  console.log(`Creating ${entitiesToCreate.length} PosterType entities...`);

  // Convert seed data to Entity format
  const entities = entitiesToCreate.map(seed => ({
    name: seed.name,
    entityType: seed.entityType,
    observations: [
      `Type key: ${seed.type_key}`,
      `Display name: ${seed.display_name}`,
      `Description: ${seed.description}`,
      seed.detection_hints.length > 0
        ? `Detection hints: ${seed.detection_hints.join(', ')}`
        : 'No detection hints'
    ],
    // Store structured data in observations for now
    // These will be queryable via pattern matching
    type_key: seed.type_key,
    display_name: seed.display_name,
    description: seed.description,
    detection_hints: seed.detection_hints
  }));

  // Create entities
  const created = await knowledgeGraphManager.createEntities(entities as any);

  console.log('');
  console.log('='.repeat(60));
  console.log('RESULTS');
  console.log('='.repeat(60));
  console.log(`Created: ${created.length} PosterType entities`);

  for (const entity of created) {
    console.log(`  ✓ ${entity.name}`);
  }

  console.log('');
  console.log('Seed complete!');
}

main().catch(error => {
  console.error('Seed script failed:', error);
  process.exit(1);
});
