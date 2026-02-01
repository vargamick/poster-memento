/**
 * Get Processing Status Tool Handler
 *
 * Returns the current status of poster processing operations,
 * including progress, counts, and knowledge graph statistics.
 */

import { KnowledgeGraphManager } from '../../../KnowledgeGraphManager.js';
import { getProcessingStats, resetProcessingState } from './processPosterBatch.js';
import { handleScanPosters } from './scanPosters.js';
import { logger } from '../../../utils/logger.js';

export interface GetProcessingStatusArgs {
  /** Source path to check status for */
  sourcePath?: string;
  /** Whether to include detailed entity counts from the knowledge graph */
  includeGraphStats?: boolean;
  /** Reset the processing state (start fresh) */
  reset?: boolean;
}

export interface ProcessingStatusResult {
  success: boolean;
  sourcePath: string;
  /** Total image files found in source */
  totalSourceFiles: number;
  /** Files processed in current session */
  sessionProcessedCount: number;
  /** Files remaining to process */
  remainingCount: number;
  /** Percentage complete (0-100) */
  percentComplete: number;
  /** When processing started for this source */
  sessionStartedAt: string | null;
  /** Estimated batches remaining (at default batch size of 100) */
  estimatedBatchesRemaining: number;
  /** Knowledge graph statistics */
  graphStats?: {
    /** Total poster entities in graph */
    posterCount: number;
    /** Total artist entities */
    artistCount: number;
    /** Total venue entities */
    venueCount: number;
    /** Total relations */
    relationCount: number;
  };
  error?: string;
}

/**
 * Handle the get_processing_status tool request
 */
export async function handleGetProcessingStatus(
  args: GetProcessingStatusArgs,
  knowledgeGraphManager: KnowledgeGraphManager
): Promise<ProcessingStatusResult> {
  const sourcePath = args.sourcePath || process.env.SOURCE_IMAGES_PATH || './SourceImages';
  const includeGraphStats = args.includeGraphStats !== false;

  logger.info('Getting processing status', { sourcePath, includeGraphStats });

  try {
    // Reset state if requested
    if (args.reset) {
      resetProcessingState(sourcePath);
      logger.info('Processing state reset', { sourcePath });
    }

    // Get current processing stats
    let stats = getProcessingStats(sourcePath);

    // If no stats exist, scan to get totals
    if (!stats) {
      const scanResult = await handleScanPosters({
        sourcePath,
        limit: 1 // Just need the total count
      });

      if (!scanResult.success) {
        return {
          success: false,
          sourcePath,
          totalSourceFiles: 0,
          sessionProcessedCount: 0,
          remainingCount: 0,
          percentComplete: 0,
          sessionStartedAt: null,
          estimatedBatchesRemaining: 0,
          error: scanResult.error
        };
      }

      // Return initial state
      return {
        success: true,
        sourcePath: scanResult.sourcePath,
        totalSourceFiles: scanResult.totalFiles,
        sessionProcessedCount: 0,
        remainingCount: scanResult.totalFiles,
        percentComplete: 0,
        sessionStartedAt: null,
        estimatedBatchesRemaining: Math.ceil(scanResult.totalFiles / 100),
        graphStats: includeGraphStats ? await getGraphStats(knowledgeGraphManager) : undefined
      };
    }

    // Calculate batches remaining
    const batchSize = 100;
    const estimatedBatchesRemaining = Math.ceil(stats.remainingCount / batchSize);

    const result: ProcessingStatusResult = {
      success: true,
      sourcePath: stats.sourcePath,
      totalSourceFiles: stats.totalFiles,
      sessionProcessedCount: stats.processedCount,
      remainingCount: stats.remainingCount,
      percentComplete: stats.percentComplete,
      sessionStartedAt: stats.startedAt?.toISOString() || null,
      estimatedBatchesRemaining
    };

    // Add graph stats if requested
    if (includeGraphStats) {
      result.graphStats = await getGraphStats(knowledgeGraphManager);
    }

    logger.info('Processing status retrieved', {
      totalSourceFiles: result.totalSourceFiles,
      sessionProcessedCount: result.sessionProcessedCount,
      percentComplete: result.percentComplete
    });

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Error getting processing status:', error);

    return {
      success: false,
      sourcePath,
      totalSourceFiles: 0,
      sessionProcessedCount: 0,
      remainingCount: 0,
      percentComplete: 0,
      sessionStartedAt: null,
      estimatedBatchesRemaining: 0,
      error: errorMessage
    };
  }
}

/**
 * Get statistics from the knowledge graph
 */
async function getGraphStats(knowledgeGraphManager: KnowledgeGraphManager): Promise<{
  posterCount: number;
  artistCount: number;
  venueCount: number;
  relationCount: number;
}> {
  try {
    // Get entity counts by type
    const graphData = await knowledgeGraphManager.readGraph();

    let posterCount = 0;
    let artistCount = 0;
    let venueCount = 0;

    for (const entity of graphData.entities) {
      switch (entity.entityType?.toLowerCase()) {
        case 'poster':
          posterCount++;
          break;
        case 'artist':
          artistCount++;
          break;
        case 'venue':
          venueCount++;
          break;
      }
    }

    return {
      posterCount,
      artistCount,
      venueCount,
      relationCount: graphData.relations?.length || 0
    };
  } catch (error) {
    logger.warn('Error getting graph stats:', error);
    return {
      posterCount: 0,
      artistCount: 0,
      venueCount: 0,
      relationCount: 0
    };
  }
}
