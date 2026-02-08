/**
 * Vision Model Types for Poster Memento
 */

export interface VisionExtractionResult {
  extracted_text: string;
  structured_data?: {
    poster_type?: 'concert' | 'festival' | 'comedy' | 'theater' | 'film' | 'album' | 'promo' | 'exhibition' | 'hybrid' | 'unknown';
    title?: string;
    artists?: string[];
    headliner?: string;
    supporting_acts?: string[];
    venue?: string;
    city?: string;
    state?: string;
    date?: string;
    year?: number;
    ticket_price?: string;
    door_time?: string;
    show_time?: string;
    age_restriction?: string;
    tour_name?: string;
    record_label?: string;
    promoter?: string;
    visual_elements?: {
      has_artist_photo?: boolean;
      has_album_artwork?: boolean;
      has_logo?: boolean;
      dominant_colors?: string[];
      style?: 'photographic' | 'illustrated' | 'typographic' | 'mixed' | 'other';
    };
    /** Vision model notes/commentary extracted from uncertain fields */
    extraction_notes?: string;
  };
  model: string;
  provider: string;
  processing_time_ms: number;
  confidence?: number;
  /** Token usage for cost tracking (cloud providers) */
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
}

export interface VisionModelProvider {
  name: string;
  extractFromImage(imagePath: string, prompt?: string): Promise<VisionExtractionResult>;
  listModels(): Promise<string[]>;
  healthCheck(): Promise<boolean>;
  getModelInfo(): { name: string; provider: string; parameters?: string };
}

export interface VisionModelConfig {
  provider: 'ollama' | 'vllm' | 'transformers' | 'openai' | 'anthropic' | 'google';
  baseUrl?: string;  // Optional for cloud providers (they have defaults)
  model: string;
  description?: string;
  parameters?: string;
  apiKey?: string;   // API key for cloud providers (env var takes precedence)
  options?: {
    temperature?: number;
    maxTokens?: number;
    timeout?: number;       // Request timeout in ms
    maxRetries?: number;    // Number of retry attempts
  };
}

export interface VisionModelsConfigFile {
  default: string;
  models: Record<string, VisionModelConfig>;
}

export interface StoredImage {
  bucket: string;
  key: string;
  url: string;
  hash: string;
  originalFilename: string;
  sizeBytes: number;
  mimeType: string;
}

/**
 * Type inference result from processing
 */
export interface TypeInference {
  type_key: string;
  confidence: number;
  source: 'vision' | 'musicbrainz' | 'discogs' | 'tmdb' | 'internal';
  evidence?: string;
  is_primary: boolean;
}

export interface PosterEntity {
  name: string;
  entityType: 'Poster';
  /** @deprecated Use inferred_types and HAS_TYPE relationships instead */
  poster_type?: 'concert' | 'festival' | 'comedy' | 'theater' | 'film' | 'album' | 'promo' | 'exhibition' | 'hybrid' | 'unknown';
  /** New type inference system - creates HAS_TYPE relationships */
  inferred_types?: TypeInference[];
  title?: string;
  headliner?: string;
  supporting_acts?: string[];
  venue_name?: string;
  city?: string;
  state?: string;
  country?: string;
  event_date?: string;
  /**
   * Vision model commentary and uncertainty notes.
   * Stores explanatory text that shouldn't be in data fields.
   * E.g., "Date could not be determined", "Artist name unclear"
   */
  extraction_notes?: string;
  year?: number;
  decade?: string;
  ticket_price?: string;
  door_time?: string;
  show_time?: string;
  age_restriction?: string;
  tour_name?: string;
  record_label?: string;
  promoter?: string;
  extracted_text?: string;
  visual_elements?: {
    has_artist_photo?: boolean;
    has_album_artwork?: boolean;
    has_logo?: boolean;
    dominant_colors?: string[];
    style?: 'photographic' | 'illustrated' | 'typographic' | 'mixed' | 'other';
  };
  description?: string;
  observations: string[];
  metadata: {
    source_image_url: string;
    source_image_key?: string;
    source_image_hash: string;
    original_filename: string;
    file_size_bytes: number;
    image_dimensions?: string;
    vision_model: string;
    processing_time_ms: number;
    extraction_confidence?: number;
    processing_date: string;
  };
}

// ============================================================================
// Session & Live Storage Types
// ============================================================================

/**
 * Information about an upload session (staging area)
 */
export interface SessionInfo {
  sessionId: string;       // e.g., "2026-02-05_concert-posters"
  name: string;            // User-friendly name
  description?: string;    // Optional user-provided description
  created: string;         // ISO timestamp
  imageCount: number;
  totalSizeBytes: number;
}

/**
 * An image in a session (awaiting processing)
 */
export interface SessionImage {
  hash: string;
  filename: string;
  key: string;             // Full S3 key
  sizeBytes: number;
  uploadedAt: string;
  url: string;             // Presigned URL
}

/**
 * An image in the live folder (processed, has corresponding KG entity)
 */
export interface LiveImage {
  hash: string;
  filename: string;
  key: string;             // Full S3 key
  entityName: string;      // Corresponding KG entity name
  sizeBytes: number;
  processedAt: string;
  url: string;             // Presigned URL
}

/**
 * Statistics for the live folder
 */
export interface LiveStats {
  totalImages: number;
  totalSizeBytes: number;
  oldestImage?: string;
  newestImage?: string;
}

/**
 * Result of archiving live images to a timestamped folder
 */
export interface ArchiveResult {
  archivePath: string;       // e.g., "archive/2026-02-08T14-30-00Z/"
  imagesCopied: number;
  metadataCopied: number;
}

/**
 * Processing result stored in live/metadata/
 */
export interface ProcessingResultMetadata {
  hash: string;
  entityName: string;
  title?: string;
  extractedData: Record<string, unknown>;
  modelKey: string;
  processedAt: string;
  sourceSessionId?: string;
}

/**
 * Result of processing a single image from a session
 */
export interface SessionProcessingResult {
  hash: string;
  success: boolean;
  entityName?: string;
  title?: string;
  error?: string;
  movedToLive: boolean;
  processingTimeMs?: number;
}
