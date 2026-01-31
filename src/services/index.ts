/**
 * Services index
 *
 * Exports all service classes and factory functions
 */

export {
  AdminService,
  createAdminServiceFromEnv,
  type DatabaseConfig,
  type DatabaseStats,
  type ResetResult,
  type BackupResult,
  type HealthStatus
} from './AdminService.js';

export {
  S3Service,
  createS3ServiceFromEnv,
  type S3Config,
  type ScrapeRunInfo,
  type DownloadProgress,
  type DownloadResult
} from './S3Service.js';

export {
  ProcessingService,
  createProcessingServiceFromEnv,
  type JobPhase,
  type JobStatus,
  type RefreshOptions
} from './ProcessingService.js';

// Processing pipeline services
export {
  MetadataProcessingService,
  PdfProcessingService,
  EmbeddingProcessingService,
  ProcessingJobManager,
  processingJobManager,
  EntityBuilder,
  CatalogLoader,
  createCatalogLoader,
  ProductValidator,
  EntityValidator,
  ObservationParser
} from './processing/index.js';

export type {
  MetadataProcessingConfig,
  PdfProcessingConfig,
  EmbeddingProcessingConfig,
  EntityWithEmbeddingStatus,
  JobType,
  JobProgress,
  ProcessingJob,
  ProductInput,
  CategoryInput,
  MetadataJobOptions,
  PdfJobOptions,
  EmbeddingJobOptions,
  PdfInput,
  EntityResult,
  RelationResult,
  BatchResult,
  BatchStats,
  MetadataLoadResponse,
  PdfContent,
  DocumentChunk
} from './processing/index.js';
