/**
 * Processing Service Types
 *
 * Type definitions for the processing pipeline API.
 * These types are designed to be consumed by external frontends.
 */

// ============================================
// Job Management Types
// ============================================

export type JobType = 'metadata' | 'pdf' | 'embeddings';
export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface JobProgress {
  total: number;
  processed: number;
  failed: number;
  percentComplete: number;
}

export interface ProcessingJob {
  jobId: string;
  type: JobType;
  status: JobStatus;
  progress: JobProgress;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

// ============================================
// Product/Entity Input Types
// ============================================

export interface ProductInput {
  product_name: string;
  product_code: string;
  product_url: string;
  product_overview: string;
  product_description: string;
  product_categories: string[];
  product_image_url?: string;
  product_skus?: string[];
  container_sizes?: string[];
  pds_url?: string;
  sds_url?: string;
  scraped_at?: string;
}

export interface CategoryInput {
  name: string;
  slug: string;
  url?: string;
}

// ============================================
// Batch Request/Response Types
// ============================================

export interface MetadataJobOptions {
  useCatalog?: boolean;
  dryRun?: boolean;
  catalogPath?: string;
}

export interface MetadataStartRequest {
  options?: MetadataJobOptions;
}

export interface MetadataBatchRequest {
  jobId: string;
  products: ProductInput[];
  categories?: CategoryInput[];
  options?: MetadataJobOptions;
}

export interface PdfJobOptions {
  useCatalog?: boolean;
  dryRun?: boolean;
  catalogPath?: string;
}

export interface PdfStartRequest {
  scrapeRunPath: string;
  options?: PdfJobOptions;
}

export interface PdfBatchRequest {
  jobId: string;
  pdfs: PdfInput[];
  options?: PdfJobOptions;
}

export interface PdfInput {
  productEntityId: string;
  pdfPath: string;
  pdfType: 'PDS' | 'SDS';
}

export interface EmbeddingJobOptions {
  entityTypes?: string[];
  batchSize?: number;
  delayMs?: number;
}

export interface EmbeddingStartRequest {
  options?: EmbeddingJobOptions;
}

export interface EmbeddingBatchRequest {
  jobId: string;
  entityIds: string[];
}

// ============================================
// Result Types
// ============================================

export interface EntityResult {
  productName?: string;
  entityId: string;
  entityType: string;
  status: 'created' | 'updated' | 'skipped' | 'failed';
  error?: string;
}

export interface RelationResult {
  from: string;
  to: string;
  relationType: string;
  status: 'created' | 'skipped' | 'failed';
  error?: string;
}

export interface ProcessingError {
  item: string;
  error: string;
  code?: string;
}

export interface BatchResult {
  success: boolean;
  processed: number;
  failed: number;
  results: EntityResult[];
  relations?: RelationResult[];
  errors?: ProcessingError[];
  stats?: BatchStats;
}

export interface BatchStats {
  entitiesCreated: number;
  entitiesUpdated: number;
  entitiesSkipped: number;
  relationsCreated: number;
  relationsSkipped: number;
  chunksCreated?: number;
  embeddingsGenerated?: number;
}

// ============================================
// Metadata Load Response
// ============================================

export interface MetadataLoadResponse {
  products: ProductInput[];
  categories: CategoryInput[];
  scrapeRunInfo: {
    directory: string;
    timestamp: string;
    isFull: boolean;
    productCount: number;
    categoryCount: number;
    pdfPDSCount: number;
    pdfSDSCount: number;
  };
}

// ============================================
// Category Hierarchy Types
// ============================================

export interface CategoryHierarchy {
  slug: string;
  parentSlug?: string;
  children: string[];
}

// ============================================
// PDF Processing Types
// ============================================

export interface PdfContent {
  rawText: string;
  sections: PdfSection[];
  pageCount: number;
  extractedAt: string;
}

export interface PdfSection {
  title: string;
  content: string;
  startPage?: number;
}

export interface DocumentChunk {
  chunkId: string;
  productEntityId: string;
  content: string;
  sectionTitle?: string;
  tokenCount: number;
  chunkIndex: number;
}

// ============================================
// Extraction Types (from catalog)
// ============================================

export interface ExtractionResult {
  entityType: string;
  instanceId: string;
  graphEntityName: string;
  confidence: number;
  matchType: 'exact' | 'synonym' | 'pattern';
  context?: string;
}

export interface TechnicalData {
  ph?: number;
  color?: string;
  odor?: string;
  foam_level?: string;
  dilution_ratios?: string[];
  safety_warnings?: string[];
  incompatible_surfaces?: string[];
  key_benefits?: string[];
  application_methods?: string[];
  suitable_equipment?: string[];
  environmental_certifications?: string[];
  flammable?: boolean;
  ready_to_use?: boolean;
}

// ============================================
// Validation Types
// ============================================

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  dataQualityScore: number;
}

export interface ValidationError {
  field: string;
  message: string;
  code: string;
}

export interface ValidationWarning {
  field: string;
  message: string;
  code: string;
}

// ============================================
// API Response Wrapper
// ============================================

export interface ProcessingApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}
