/**
 * Processing Services Index
 *
 * Exports all processing services and utilities.
 */

// Main services
export { MetadataProcessingService } from './MetadataProcessingService.js';
export type { MetadataProcessingConfig } from './MetadataProcessingService.js';

export { PdfProcessingService } from './PdfProcessingService.js';
export type { PdfProcessingConfig } from './PdfProcessingService.js';

export { EmbeddingProcessingService } from './EmbeddingProcessingService.js';
export type { EmbeddingProcessingConfig, EntityWithEmbeddingStatus } from './EmbeddingProcessingService.js';

// Job management
export { ProcessingJobManager, processingJobManager } from './ProcessingJobManager.js';

// Types
export type {
  JobType,
  JobStatus,
  JobProgress,
  ProcessingJob,
  ProductInput,
  CategoryInput,
  MetadataJobOptions,
  MetadataStartRequest,
  MetadataBatchRequest,
  PdfJobOptions,
  PdfStartRequest,
  PdfBatchRequest,
  PdfInput,
  EmbeddingJobOptions,
  EmbeddingStartRequest,
  EmbeddingBatchRequest,
  EntityResult,
  RelationResult,
  ProcessingError,
  BatchResult,
  BatchStats,
  MetadataLoadResponse,
  CategoryHierarchy,
  PdfContent,
  PdfSection,
  DocumentChunk,
  ExtractionResult,
  TechnicalData,
  ValidationResult,
  ValidationError,
  ValidationWarning,
  ProcessingApiResponse
} from './types.js';

// Utilities
export {
  EntityBuilder,
  CatalogLoader,
  createCatalogLoader,
  ProductValidator,
  EntityValidator,
  ObservationParser
} from './utils/index.js';
