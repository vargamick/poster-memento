#!/usr/bin/env node

/**
 * CLI wrapper for database reset
 * Run with: npx tsx scripts/admin/reset-databases.ts [--yes]
 */

import { DatabaseResetter, getResetConfigFromEnv } from '../../src/pipeline/index.js';

async function main() {
  const args = process.argv.slice(2);
  const skipConfirmation = args.includes('--yes') || args.includes('-y');

  // Load configuration from environment
  const config = getResetConfigFromEnv(skipConfirmation);

  // Validate required config
  if (!config.neo4jPassword) {
    console.error('Error: NEO4J_PASSWORD environment variable is required');
    process.exit(1);
  }

  if (!config.postgresPassword) {
    console.error('Error: POSTGRES_PASSWORD environment variable is required');
    process.exit(1);
  }

  const resetter = new DatabaseResetter(config);

  try {
    await resetter.reset();
    process.exit(0);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('\nFATAL ERROR:', errorMessage);
    process.exit(1);
  }
}

main();
