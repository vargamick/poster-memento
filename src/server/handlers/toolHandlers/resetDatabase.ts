/**
 * Reset Database Tool Handler
 *
 * Truncates/resets Neo4j and PostgreSQL databases while preserving schemas.
 * WARNING: This operation cannot be undone!
 */

import { DatabaseResetter, getResetConfigFromEnv, ResetResult, ResetStats } from '../../../pipeline/index.js';
import { logger } from '../../../utils/logger.js';

export interface ResetDatabaseArgs {
  /**
   * Confirmation token - must be "CONFIRM_RESET" to proceed.
   * This prevents accidental data loss.
   */
  confirmationToken: string;
}

export interface ResetDatabaseResult {
  success: boolean;
  beforeStats?: ResetStats;
  afterStats?: ResetStats;
  timestamp?: string;
  error?: string;
}

/**
 * Handle the reset_database tool request
 */
export async function handleResetDatabase(
  args: ResetDatabaseArgs
): Promise<ResetDatabaseResult> {
  // Validate confirmation token
  if (args.confirmationToken !== 'CONFIRM_RESET') {
    logger.warn('Database reset attempted without valid confirmation token');
    return {
      success: false,
      error: 'Invalid confirmation token. Must provide confirmationToken: "CONFIRM_RESET" to proceed. This is a safety measure to prevent accidental data loss.'
    };
  }

  logger.info('Starting database reset');

  try {
    // Skip interactive confirmation since we have the token
    const config = getResetConfigFromEnv(true);

    const resetter = new DatabaseResetter(config);
    const result: ResetResult = await resetter.reset();

    if (result.success) {
      logger.info('Database reset complete', {
        entitiesRemoved: result.beforeStats.neo4j.entities,
        relationshipsRemoved: result.beforeStats.neo4j.relationships,
        embeddingsRemoved: result.beforeStats.postgres.embeddings
      });
    } else {
      logger.warn('Database reset was cancelled or incomplete');
    }

    return {
      success: result.success,
      beforeStats: result.beforeStats,
      afterStats: result.afterStats,
      timestamp: result.timestamp
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Database reset failed', { error: errorMessage });

    return {
      success: false,
      error: errorMessage
    };
  }
}
