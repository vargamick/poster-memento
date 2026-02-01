/**
 * Backup Database Tool Handler
 *
 * Creates backups of Neo4j and PostgreSQL databases.
 * This should be run before any destructive operations.
 */

import { DatabaseBackup, getBackupConfigFromEnv, BackupResult, DatabaseStats, PostgresStats } from '../../../pipeline/index.js';
import { logger } from '../../../utils/logger.js';

export interface BackupDatabaseArgs {
  /** Whether to compress the backup files */
  compress?: boolean;
  /** Custom backup directory (optional) */
  backupDirectory?: string;
}

export interface BackupDatabaseResult {
  success: boolean;
  timestamp?: string;
  neo4jBackupPath?: string;
  postgresBackupPath?: string;
  manifestPath?: string;
  stats?: {
    neo4j: DatabaseStats;
    postgres: PostgresStats;
  };
  error?: string;
}

/**
 * Handle the backup_database tool request
 */
export async function handleBackupDatabase(
  args: BackupDatabaseArgs
): Promise<BackupDatabaseResult> {
  logger.info('Starting database backup', { compress: args.compress });

  try {
    const config = getBackupConfigFromEnv();

    if (args.compress !== undefined) {
      config.compress = args.compress;
    }

    if (args.backupDirectory) {
      config.backupDirectory = args.backupDirectory;
    }

    const backup = new DatabaseBackup(config);
    const result: BackupResult = await backup.backup();

    logger.info('Database backup complete', {
      timestamp: result.timestamp,
      neo4jPath: result.neo4jBackupPath,
      postgresPath: result.postgresBackupPath
    });

    return {
      success: true,
      timestamp: result.timestamp,
      neo4jBackupPath: result.neo4jBackupPath,
      postgresBackupPath: result.postgresBackupPath,
      manifestPath: result.manifestPath,
      stats: {
        neo4j: result.neo4jStats,
        postgres: result.postgresStats
      }
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Database backup failed', { error: errorMessage });

    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Get current database statistics without performing a backup
 */
export async function handleGetDatabaseStats(): Promise<{
  success: boolean;
  stats?: {
    neo4j: DatabaseStats;
    postgres: PostgresStats;
  };
  error?: string;
}> {
  logger.info('Getting database statistics');

  try {
    const config = getBackupConfigFromEnv();
    const backup = new DatabaseBackup(config);
    const stats = await backup.getDatabaseStats();

    return {
      success: true,
      stats
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Failed to get database statistics', { error: errorMessage });

    return {
      success: false,
      error: errorMessage
    };
  }
}
