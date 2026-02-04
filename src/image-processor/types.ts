/**
 * Vision Model Types for Poster Memento
 */

export interface VisionExtractionResult {
  extracted_text: string;
  structured_data?: {
    poster_type?: 'concert' | 'festival' | 'comedy' | 'theater' | 'film' | 'release' | 'promo' | 'exhibition' | 'hybrid' | 'unknown';
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
  };
  model: string;
  provider: string;
  processing_time_ms: number;
  confidence?: number;
}

export interface VisionModelProvider {
  name: string;
  extractFromImage(imagePath: string, prompt?: string): Promise<VisionExtractionResult>;
  listModels(): Promise<string[]>;
  healthCheck(): Promise<boolean>;
  getModelInfo(): { name: string; provider: string; parameters?: string };
}

export interface VisionModelConfig {
  provider: 'ollama' | 'vllm' | 'transformers';
  baseUrl: string;
  model: string;
  description?: string;
  parameters?: string;
  options?: {
    temperature?: number;
    maxTokens?: number;
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
  poster_type?: 'concert' | 'festival' | 'comedy' | 'theater' | 'film' | 'release' | 'promo' | 'exhibition' | 'hybrid' | 'unknown';
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
