#!/usr/bin/env node

/**
 * Migration script for poster_type property to HAS_TYPE relationships
 *
 * This script:
 * 1. Finds all Poster entities with poster_type property
 * 2. Creates HAS_TYPE relationships to corresponding PosterType entities
 * 3. Handles "hybrid" by creating relationships to both inferred types
 *
 * Usage:
 *   npm run migrate:poster-types           # Live migration
 *   npm run migrate:poster-types -- --dry-run  # Preview changes
 *   npm run migrate:poster-types -- --rollback # Remove HAS_TYPE relationships
 */

import { KnowledgeGraphManager, type Entity, type Relation } from '../src/KnowledgeGraphManager.js';
import { initializeStorageProvider } from '../src/config/storage.js';

interface MigrationPlan {
  posterName: string;
  posterType: string;
  targetPosterTypes: string[];
  relationships: Array<{
    from: string;
    to: string;
    relationType: string;
    confidence: number;
    source: string;
    evidence: string;
    inferred_by: string;
    is_primary: boolean;
  }>;
}

interface MigrationStats {
  totalPosters: number;
  postersWithType: number;
  postersWithoutType: number;
  relationshipsCreated: number;
  hybridPosters: number;
  errors: string[];
}

/**
 * Maps poster_type value to PosterType entity name(s)
 */
function mapTypeToEntityNames(posterType: string): string[] {
  const typeKey = posterType.toLowerCase().trim();

  // Handle hybrid by returning both types it might represent
  // For now, hybrid typically means release + concert
  if (typeKey === 'hybrid') {
    return ['PosterType_release', 'PosterType_concert'];
  }

  // Standard types
  const validTypes = [
    'concert', 'festival', 'comedy', 'theater',
    'film', 'release', 'promo', 'exhibition', 'unknown'
  ];

  if (validTypes.includes(typeKey)) {
    return [`PosterType_${typeKey}`];
  }

  // Unknown type, map to unknown
  console.warn(`  Warning: Unknown poster_type "${posterType}", mapping to unknown`);
  return ['PosterType_unknown'];
}

/**
 * Extract poster_type from entity observations or properties
 */
function getPosterType(entity: Entity): string | null {
  // Check if it has a poster_type property directly (for extended entities)
  const extendedEntity = entity as Entity & { poster_type?: string };
  if (extendedEntity.poster_type) {
    return extendedEntity.poster_type;
  }

  // Try to extract from observations
  for (const obs of entity.observations || []) {
    // Match patterns like "poster_type: release" or "Type: concert"
    const match = obs.match(/(?:poster_type|type):\s*(\w+)/i);
    if (match) {
      return match[1];
    }
  }

  return null;
}

async function planMigration(
  knowledgeGraphManager: KnowledgeGraphManager
): Promise<{ plans: MigrationPlan[]; stats: MigrationStats }> {
  const stats: MigrationStats = {
    totalPosters: 0,
    postersWithType: 0,
    postersWithoutType: 0,
    relationshipsCreated: 0,
    hybridPosters: 0,
    errors: []
  };

  const plans: MigrationPlan[] = [];

  // Load all entities
  console.log('Loading knowledge graph...');
  const graph = await knowledgeGraphManager.loadGraph();

  // Get all Poster entities
  const posters = graph.entities.filter(e => e.entityType === 'Poster');
  stats.totalPosters = posters.length;
  console.log(`Found ${posters.length} Poster entities`);

  // Get existing HAS_TYPE relationships to avoid duplicates
  const existingHasType = new Set(
    graph.relations
      .filter(r => r.relationType === 'HAS_TYPE')
      .map(r => r.from)
  );
  console.log(`Found ${existingHasType.size} posters with existing HAS_TYPE relationships`);

  // Check PosterType entities exist
  const posterTypes = graph.entities.filter(e => e.entityType === 'PosterType');
  const posterTypeNames = new Set(posterTypes.map(e => e.name));
  console.log(`Found ${posterTypes.length} PosterType entities`);

  if (posterTypes.length === 0) {
    console.error('ERROR: No PosterType entities found. Run seed script first:');
    console.error('  npm run seed:poster-types');
    stats.errors.push('No PosterType entities found');
    return { plans, stats };
  }

  // Plan migration for each poster
  console.log('\nPlanning migration...');
  for (const poster of posters) {
    // Skip if already has HAS_TYPE relationship
    if (existingHasType.has(poster.name)) {
      continue;
    }

    const posterType = getPosterType(poster);

    if (!posterType) {
      stats.postersWithoutType++;
      continue;
    }

    stats.postersWithType++;

    const targetTypes = mapTypeToEntityNames(posterType);

    if (targetTypes.length > 1) {
      stats.hybridPosters++;
    }

    // Verify target PosterType entities exist
    const validTargets = targetTypes.filter(t => posterTypeNames.has(t));
    if (validTargets.length === 0) {
      stats.errors.push(`No valid PosterType found for "${posterType}" (poster: ${poster.name})`);
      continue;
    }

    const plan: MigrationPlan = {
      posterName: poster.name,
      posterType,
      targetPosterTypes: validTargets,
      relationships: validTargets.map((target, index) => ({
        from: poster.name,
        to: target,
        relationType: 'HAS_TYPE',
        confidence: posterType === 'unknown' ? 0.5 : 1.0,
        source: 'migration',
        evidence: `Migrated from poster_type property: "${posterType}"`,
        inferred_by: 'migrate-poster-types',
        is_primary: index === 0 // First type is primary
      }))
    };

    plans.push(plan);
    stats.relationshipsCreated += plan.relationships.length;
  }

  return { plans, stats };
}

async function executeMigration(
  knowledgeGraphManager: KnowledgeGraphManager,
  plans: MigrationPlan[]
): Promise<number> {
  console.log('\nExecuting migration...');

  // Create all relationships
  const relations: Relation[] = [];
  const now = Date.now();

  for (const plan of plans) {
    for (const rel of plan.relationships) {
      relations.push({
        from: rel.from,
        to: rel.to,
        relationType: rel.relationType,
        confidence: rel.confidence,
        metadata: {
          createdAt: now,
          updatedAt: now,
          source: rel.source,
          evidence: rel.evidence,
          inferred_by: rel.inferred_by,
          inferred_at: new Date().toISOString(),
          is_primary: rel.is_primary
        }
      });
    }
  }

  if (relations.length === 0) {
    console.log('No relationships to create.');
    return 0;
  }

  console.log(`Creating ${relations.length} HAS_TYPE relationships...`);

  // Create in batches to avoid overwhelming the database
  const batchSize = 50;
  let created = 0;

  for (let i = 0; i < relations.length; i += batchSize) {
    const batch = relations.slice(i, i + batchSize);
    const result = await knowledgeGraphManager.createRelations(batch);
    created += result.length;
    console.log(`  Batch ${Math.floor(i / batchSize) + 1}: ${result.length} relationships created`);
  }

  return created;
}

async function rollbackMigration(
  knowledgeGraphManager: KnowledgeGraphManager
): Promise<number> {
  console.log('\nRollback: Removing HAS_TYPE relationships created by migration...');

  // Load graph
  const graph = await knowledgeGraphManager.loadGraph();

  // Find HAS_TYPE relationships created by migration
  const migrationRelations = graph.relations.filter(r =>
    r.relationType === 'HAS_TYPE' &&
    r.metadata?.source === 'migration' &&
    r.metadata?.inferred_by === 'migrate-poster-types'
  );

  console.log(`Found ${migrationRelations.length} migration-created HAS_TYPE relationships`);

  if (migrationRelations.length === 0) {
    console.log('No migration relationships to rollback.');
    return 0;
  }

  // Note: The KnowledgeGraphManager doesn't have a deleteRelations method
  // This would need to be implemented via the storage provider directly
  console.log('WARNING: Automatic rollback not yet implemented.');
  console.log('To rollback manually, run the following Cypher query:');
  console.log('');
  console.log(`MATCH ()-[r:HAS_TYPE]->()
WHERE r.source = 'migration' AND r.inferred_by = 'migrate-poster-types'
DELETE r`);
  console.log('');

  return 0;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const rollback = process.argv.includes('--rollback');
  const verbose = process.argv.includes('--verbose');

  console.log('='.repeat(60));
  console.log('POSTER TYPE MIGRATION');
  console.log('='.repeat(60));
  console.log(`Mode: ${dryRun ? 'DRY RUN' : rollback ? 'ROLLBACK' : 'LIVE'}`);
  console.log('');

  // Initialize storage
  console.log('Initializing storage provider...');
  const storageProvider = initializeStorageProvider();

  console.log('Initializing Knowledge Graph Manager...');
  const knowledgeGraphManager = new KnowledgeGraphManager({
    storageProvider
  });
  console.log('');

  if (rollback) {
    await rollbackMigration(knowledgeGraphManager);
    return;
  }

  // Plan migration
  const { plans, stats } = await planMigration(knowledgeGraphManager);

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('MIGRATION PLAN SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total Poster entities: ${stats.totalPosters}`);
  console.log(`Posters with poster_type: ${stats.postersWithType}`);
  console.log(`Posters without poster_type: ${stats.postersWithoutType}`);
  console.log(`Hybrid posters (multiple types): ${stats.hybridPosters}`);
  console.log(`Relationships to create: ${stats.relationshipsCreated}`);

  if (stats.errors.length > 0) {
    console.log(`\nErrors (${stats.errors.length}):`);
    for (const error of stats.errors) {
      console.log(`  - ${error}`);
    }
  }

  if (verbose && plans.length > 0) {
    console.log('\nDetailed plan:');
    for (const plan of plans.slice(0, 10)) {
      console.log(`  ${plan.posterName}: ${plan.posterType} -> ${plan.targetPosterTypes.join(', ')}`);
    }
    if (plans.length > 10) {
      console.log(`  ... and ${plans.length - 10} more`);
    }
  }

  if (dryRun) {
    console.log('\nDRY RUN complete. No changes made.');
    console.log('Run without --dry-run to execute migration.');
    return;
  }

  if (plans.length === 0) {
    console.log('\nNo migration needed. All posters already have HAS_TYPE relationships or no poster_type.');
    return;
  }

  // Execute migration
  const created = await executeMigration(knowledgeGraphManager, plans);

  console.log('\n' + '='.repeat(60));
  console.log('MIGRATION COMPLETE');
  console.log('='.repeat(60));
  console.log(`Relationships created: ${created}`);
}

main().catch(error => {
  console.error('Migration failed:', error);
  process.exit(1);
});
