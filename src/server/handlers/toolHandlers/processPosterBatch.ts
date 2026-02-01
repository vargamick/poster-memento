/**
 * Process Poster Batch Tool Handler
 *
 * Processes a batch of poster images using vision models
 * and stores the extracted metadata in the knowledge graph.
 */

import { KnowledgeGraphManager } from '../../../KnowledgeGraphManager.js';
import { createPosterProcessor, ProcessingResult } from '../../../image-processor/PosterProcessor.js';
import { handleScanPosters } from './scanPosters.js';
import { logger } from '../../../utils/logger.js';

export interface ProcessPosterBatchArgs {
  /** Specific file paths to process (optional - if not provided, uses sourcePath) */
  filePaths?: string[];
  /** Source directory to scan for images (used if filePaths not provided) */
  sourcePath?: string;
  /** Batch size - number of images to process in this call */
  batchSize?: number;
  /** Offset for pagination when processing from sourcePath */
  offset?: number;
  /** Skip images that have already been processed (by hash) */
  skipIfExists?: boolean;
  /** Custom vision model to use (optional) */
  modelKey?: string;
  /** Whether to store images in object storage */
  storeImages?: boolean;
}

export interface ProcessPosterBatchResult {
  success: boolean;
  batchNumber: number;
  totalInBatch: number;
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  offset: number;
  hasMore: boolean;
  totalRemaining: number;
  entities: Array<{
    name: string;
    title?: string;
    headliner?: string;
    venue?: string;
    success: boolean;
    error?: string;
    processingTimeMs: number;
  }>;
  errors: string[];
  averageProcessingTimeMs: number;
}

// Track processing state across calls
const processingState = new Map<string, {
  totalFiles: number;
  processedFiles: Set<string>;
  startedAt: Date;
}>();

/**
 * Get or create processing state for a source path
 */
function getProcessingState(sourcePath: string) {
  if (!processingState.has(sourcePath)) {
    processingState.set(sourcePath, {
      totalFiles: 0,
      processedFiles: new Set(),
      startedAt: new Date()
    });
  }
  return processingState.get(sourcePath)!;
}

/**
 * Handle the process_poster_batch tool request
 */
export async function handleProcessPosterBatch(
  args: ProcessPosterBatchArgs,
  knowledgeGraphManager: KnowledgeGraphManager
): Promise<ProcessPosterBatchResult> {
  const batchSize = args.batchSize || 10;
  const offset = args.offset || 0;
  const skipIfExists = args.skipIfExists !== false;
  const storeImages = args.storeImages !== false;
  const sourcePath = args.sourcePath || process.env.SOURCE_IMAGES_PATH || './SourceImages';

  logger.info('Processing poster batch', { batchSize, offset, skipIfExists, sourcePath });

  const result: ProcessPosterBatchResult = {
    success: true,
    batchNumber: Math.floor(offset / batchSize) + 1,
    totalInBatch: 0,
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    offset,
    hasMore: false,
    totalRemaining: 0,
    entities: [],
    errors: [],
    averageProcessingTimeMs: 0
  };

  try {
    // Get files to process
    let filesToProcess: string[];
    let totalFiles: number;
    let hasMore: boolean;

    if (args.filePaths && args.filePaths.length > 0) {
      // Use provided file paths
      filesToProcess = args.filePaths.slice(0, batchSize);
      totalFiles = args.filePaths.length;
      hasMore = args.filePaths.length > batchSize;
    } else {
      // Scan source directory
      const scanResult = await handleScanPosters({
        sourcePath,
        offset,
        limit: batchSize
      });

      if (!scanResult.success) {
        return {
          ...result,
          success: false,
          errors: [scanResult.error || 'Failed to scan source directory']
        };
      }

      filesToProcess = scanResult.files.map(f => f.path);
      totalFiles = scanResult.totalFiles;
      hasMore = scanResult.hasMore;
    }

    result.totalInBatch = filesToProcess.length;
    result.hasMore = hasMore;
    result.totalRemaining = totalFiles - offset - filesToProcess.length;

    // Update processing state
    const state = getProcessingState(sourcePath);
    state.totalFiles = totalFiles;

    if (filesToProcess.length === 0) {
      logger.info('No files to process in this batch');
      return result;
    }

    // Initialize poster processor
    const processor = await createPosterProcessor();

    // Process each file
    let totalProcessingTime = 0;

    for (const filePath of filesToProcess) {
      // Check if already processed in this session
      if (state.processedFiles.has(filePath)) {
        result.skipped++;
        continue;
      }

      try {
        const processingResult = await processor.processImage(filePath, {
          skipIfExists,
          skipStorage: !storeImages,
          modelKey: args.modelKey
        });

        result.processed++;
        totalProcessingTime += processingResult.processingTimeMs;

        if (processingResult.success && processingResult.entity) {
          // Create entity in knowledge graph
          const entity = processingResult.entity;

          await knowledgeGraphManager.createEntities([{
            name: entity.name,
            entityType: entity.entityType,
            observations: entity.observations || []
          }]);

          // Add additional observations with structured data
          const additionalObservations: string[] = [];

          if (entity.poster_type) additionalObservations.push(`Poster type: ${entity.poster_type}`);
          if (entity.title) additionalObservations.push(`Title: ${entity.title}`);
          if (entity.headliner) additionalObservations.push(`Headliner: ${entity.headliner}`);
          if (entity.supporting_acts?.length) {
            additionalObservations.push(`Supporting acts: ${entity.supporting_acts.join(', ')}`);
          }
          if (entity.venue_name) additionalObservations.push(`Venue: ${entity.venue_name}`);
          if (entity.city) additionalObservations.push(`City: ${entity.city}`);
          if (entity.state) additionalObservations.push(`State: ${entity.state}`);
          if (entity.event_date) additionalObservations.push(`Event date: ${entity.event_date}`);
          if (entity.year) additionalObservations.push(`Year: ${entity.year}`);
          if (entity.decade) additionalObservations.push(`Decade: ${entity.decade}`);
          if (entity.ticket_price) additionalObservations.push(`Ticket price: ${entity.ticket_price}`);
          if (entity.door_time) additionalObservations.push(`Door time: ${entity.door_time}`);
          if (entity.show_time) additionalObservations.push(`Show time: ${entity.show_time}`);
          if (entity.age_restriction) additionalObservations.push(`Age restriction: ${entity.age_restriction}`);
          if (entity.tour_name) additionalObservations.push(`Tour: ${entity.tour_name}`);
          if (entity.record_label) additionalObservations.push(`Record label: ${entity.record_label}`);
          if (entity.promoter) additionalObservations.push(`Promoter: ${entity.promoter}`);
          if (entity.visual_elements?.style) additionalObservations.push(`Visual style: ${entity.visual_elements.style}`);
          if (entity.visual_elements?.dominant_colors?.length) {
            additionalObservations.push(`Dominant colors: ${entity.visual_elements.dominant_colors.join(', ')}`);
          }

          if (additionalObservations.length > 0) {
            await knowledgeGraphManager.addObservations([{
              entityName: entity.name,
              contents: additionalObservations
            }]);
          }

          // Create relations to artists, venues, etc.
          // Using relationship types from instance-config.json
          const relations: Array<{ from: string; to: string; relationType: string }> = [];

          // Create headliner artist entity and FEATURES_ARTIST relation
          if (entity.headliner) {
            const headlinerName = `artist_${entity.headliner.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
            try {
              await knowledgeGraphManager.createEntities([{
                name: headlinerName,
                entityType: 'Artist',
                observations: [
                  `Artist name: ${entity.headliner}`,
                  'Role: Headliner'
                ]
              }]);
            } catch (e) {
              // Entity might already exist
            }
            relations.push({
              from: entity.name,
              to: headlinerName,
              relationType: 'FEATURES_ARTIST'
            });
          }

          // Create supporting act entities and FEATURES_ARTIST relations
          if (entity.supporting_acts?.length) {
            for (const act of entity.supporting_acts) {
              const actName = `artist_${act.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
              try {
                await knowledgeGraphManager.createEntities([{
                  name: actName,
                  entityType: 'Artist',
                  observations: [
                    `Artist name: ${act}`,
                    'Role: Supporting Act'
                  ]
                }]);
              } catch (e) {
                // Entity might already exist
              }
              relations.push({
                from: entity.name,
                to: actName,
                relationType: 'FEATURES_ARTIST'
              });
            }
          }

          // Create venue entity and ADVERTISES_VENUE relation
          if (entity.venue_name) {
            const venueName = `venue_${entity.venue_name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
            try {
              await knowledgeGraphManager.createEntities([{
                name: venueName,
                entityType: 'Venue',
                observations: [
                  `Venue name: ${entity.venue_name}`,
                  entity.city ? `City: ${entity.city}` : '',
                  entity.state ? `State: ${entity.state}` : ''
                ].filter(Boolean)
              }]);
            } catch (e) {
              // Entity might already exist
            }
            relations.push({
              from: entity.name,
              to: venueName,
              relationType: 'ADVERTISES_VENUE'
            });
          }

          if (relations.length > 0) {
            try {
              await knowledgeGraphManager.createRelations(relations);
            } catch (e) {
              logger.warn('Error creating relations:', e);
            }
          }

          result.succeeded++;
          state.processedFiles.add(filePath);

          result.entities.push({
            name: entity.name,
            title: entity.title,
            headliner: entity.headliner,
            venue: entity.venue_name,
            success: true,
            processingTimeMs: processingResult.processingTimeMs
          });
        } else {
          // Processing failed or skipped
          if (processingResult.error?.includes('already processed')) {
            result.skipped++;
            state.processedFiles.add(filePath);
          } else {
            result.failed++;
            result.errors.push(`${filePath}: ${processingResult.error}`);
          }

          result.entities.push({
            name: filePath,
            success: false,
            error: processingResult.error,
            processingTimeMs: processingResult.processingTimeMs
          });
        }
      } catch (error) {
        result.failed++;
        const errorMessage = error instanceof Error ? error.message : String(error);
        result.errors.push(`${filePath}: ${errorMessage}`);
        logger.error(`Error processing ${filePath}:`, error);

        result.entities.push({
          name: filePath,
          success: false,
          error: errorMessage,
          processingTimeMs: 0
        });
      }
    }

    // Calculate average processing time
    if (result.processed > 0) {
      result.averageProcessingTimeMs = Math.round(totalProcessingTime / result.processed);
    }

    logger.info('Batch processing complete', {
      batchNumber: result.batchNumber,
      processed: result.processed,
      succeeded: result.succeeded,
      failed: result.failed,
      skipped: result.skipped,
      hasMore: result.hasMore,
      totalRemaining: result.totalRemaining
    });

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Batch processing failed:', error);

    return {
      ...result,
      success: false,
      errors: [errorMessage]
    };
  }
}

/**
 * Get current processing statistics
 */
export function getProcessingStats(sourcePath?: string): {
  sourcePath: string;
  totalFiles: number;
  processedCount: number;
  remainingCount: number;
  percentComplete: number;
  startedAt: Date | null;
} | null {
  const path = sourcePath || process.env.SOURCE_IMAGES_PATH || './SourceImages';
  const state = processingState.get(path);

  if (!state) {
    return null;
  }

  const processedCount = state.processedFiles.size;
  const remainingCount = state.totalFiles - processedCount;
  const percentComplete = state.totalFiles > 0
    ? Math.round((processedCount / state.totalFiles) * 100)
    : 0;

  return {
    sourcePath: path,
    totalFiles: state.totalFiles,
    processedCount,
    remainingCount,
    percentComplete,
    startedAt: state.startedAt
  };
}

/**
 * Reset processing state for a source path
 */
export function resetProcessingState(sourcePath?: string): void {
  const path = sourcePath || process.env.SOURCE_IMAGES_PATH || './SourceImages';
  processingState.delete(path);
}
