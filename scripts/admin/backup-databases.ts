#!/usr/bin/env node

/**
 * CLI wrapper for database backup
 * Run with: npx tsx scripts/admin/backup-databases.ts [--compress]
 */

import { DatabaseBackup, getBackupConfigFromEnv } from '../../src/pipeline/index.js';

async function main() {
  const args = process.argv.slice(2);
  const compress = args.includes('--compress') || args.includes('-c');

  // Load configuration from environment
  const config = getBackupConfigFromEnv();
  config.compress = compress;

  // Validate required config
  if (!config.neo4jPassword) {
    console.error('Error: NEO4J_PASSWORD environment variable is required');
    process.exit(1);
  }

  if (!config.postgresPassword) {
    console.error('Error: POSTGRES_PASSWORD environment variable is required');
    process.exit(1);
  }

  const backup = new DatabaseBackup(config);

  try {
    await backup.backup();
    process.exit(0);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('\nFATAL ERROR:', errorMessage);
    process.exit(1);
  }
}

main();
