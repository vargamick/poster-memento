/**
 * Iterative Processing Types
 *
 * Types and interfaces for the multi-phase iterative poster processing pipeline.
 */

import { PosterEntity, TypeInference, VisionExtractionResult } from '../types.js';
import { ValidationSource, ValidatorResult, QASuggestion } from '../../qa-validation/types.js';

// ============================================================================
// Phase Names and Status
// ============================================================================

export type ProcessingPhaseName = 'type' | 'artist' | 'venue' | 'event' | 'assembly';

export type PhaseStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'needs_review';

// ============================================================================
// Poster Types
// ============================================================================

export type PosterType =
  | 'concert'
  | 'festival'
  | 'comedy'
  | 'theater'
  | 'film'
  | 'album'
  | 'promo'
  | 'exhibition'
  | 'hybrid'
  | 'unknown';

// ============================================================================
// Base Phase Result
// ============================================================================

export interface BasePhaseResult {
  posterId: string;
  imagePath: string;
  phase: ProcessingPhaseName;
  status: PhaseStatus;
  confidence: number;
  processingTimeMs: number;
  errors?: string[];
  warnings?: string[];
}

// ============================================================================
// Phase 1: Type Classification Result
// ============================================================================

export interface TypePhaseResult extends BasePhaseResult {
  phase: 'type';
  primaryType: {
    type: PosterType;
    confidence: number;
    evidence: string[];
  };
  secondaryTypes?: TypeInference[];
  visualCues: {
    hasArtistPhoto?: boolean;
    hasAlbumArtwork?: boolean;
    hasLogo?: boolean;
    dominantColors?: string[];
    style?: 'photographic' | 'illustrated' | 'typographic' | 'mixed' | 'other';
  };
  extractedText?: string;
  readyForPhase2: boolean;
}

// ============================================================================
// Phase 2: Artist Extraction Result
// ============================================================================

export interface ArtistMatch {
  extractedName: string;
  validatedName?: string;
  externalId?: string;
  externalUrl?: string;
  confidence: number;
  source: ValidationSource;
  alternatives?: Array<{
    name: string;
    confidence: number;
    externalId?: string;
  }>;
}

export interface ArtistPhaseResult extends BasePhaseResult {
  phase: 'artist';
  posterType: PosterType;
  headliner?: ArtistMatch;
  supportingActs?: ArtistMatch[];
  tourName?: string;
  recordLabel?: string;
  /** For film posters */
  director?: ArtistMatch;
  cast?: ArtistMatch[];
  existingArtistMatches?: Array<{
    name: string;
    entityId: string;
  }>;
  readyForPhase3: boolean;
}

// ============================================================================
// Phase 3: Venue Extraction Result
// ============================================================================

export interface VenueMatch {
  extractedName: string;
  validatedName?: string;
  city?: string;
  state?: string;
  country?: string;
  existingVenueId?: string;
  confidence: number;
  source: ValidationSource;
}

export interface VenuePhaseResult extends BasePhaseResult {
  phase: 'venue';
  posterType: PosterType;
  venue?: VenueMatch;
  /** For film posters - theater info */
  theater?: VenueMatch;
  existingVenueMatches?: Array<{
    name: string;
    entityId: string;
    city?: string;
  }>;
  readyForPhase4: boolean;
}

// ============================================================================
// Phase 4: Event/Date Extraction Result
// ============================================================================

export interface DateInfo {
  rawValue: string;
  parsed?: Date;
  year?: number;
  month?: number;
  day?: number;
  confidence: number;
  format?: string;
}

export interface EventPhaseResult extends BasePhaseResult {
  phase: 'event';
  posterType: PosterType;
  eventDate?: DateInfo;
  year?: number;
  decade?: string;
  timeDetails?: {
    doorTime?: string;
    showTime?: string;
  };
  ticketPrice?: string;
  ageRestriction?: string;
  promoter?: string;
  /** Validation: Was artist active during this period? */
  artistActiveValidation?: {
    valid: boolean;
    message?: string;
  };
  /** Validation: Did venue exist at this time? */
  venueExistsValidation?: {
    valid: boolean;
    message?: string;
  };
  readyForAssembly: boolean;
}

// ============================================================================
// Assembly Phase Result
// ============================================================================

export interface AssemblyPhaseResult extends BasePhaseResult {
  phase: 'assembly';
  entity: PosterEntity;
  relationshipsCreated: Array<{
    type: string;
    from: string;
    to: string;
  }>;
  entitiesCreated: Array<{
    type: string;
    name: string;
    isNew: boolean;
  }>;
  overallConfidence: number;
  fieldsNeedingReview: string[];
}

// ============================================================================
// Union Type for All Phase Results
// ============================================================================

export type PhaseResult =
  | TypePhaseResult
  | ArtistPhaseResult
  | VenuePhaseResult
  | EventPhaseResult
  | AssemblyPhaseResult;

// ============================================================================
// Processing Context
// ============================================================================

export interface ProcessingContext {
  sessionId: string;
  imagePath: string;
  posterId: string;
  startedAt: Date;
  currentPhase: ProcessingPhaseName;
  phaseResults: Map<ProcessingPhaseName, PhaseResult>;
  validationResults: ValidatorResult[];
  suggestions: QASuggestion[];
}

// ============================================================================
// Iterative Processing Options
// ============================================================================

export interface IterativeProcessingOptions {
  /** Processing mode */
  mode: 'iterative' | 'single-pass';

  /** Confidence threshold to proceed to next phase (0-1) */
  confidenceThreshold?: number;

  /** Action when confidence is below threshold */
  onLowConfidence?: 'flag' | 'pause' | 'skip' | 'retry';

  /** Maximum retry attempts per phase */
  maxRetries?: number;

  /** Enable type validation phase */
  validateTypes?: boolean;

  /** Enable artist validation phase */
  validateArtists?: boolean;

  /** Enable venue validation phase */
  validateVenues?: boolean;

  /** Enable event/date validation */
  validateEvents?: boolean;

  /** Skip storage (for testing) */
  skipStorage?: boolean;

  /** Custom model key to use */
  modelKey?: string;

  /** Pause for manual review if any field below threshold */
  pauseOnLowConfidence?: boolean;

  /** External validation sources to use */
  validationSources?: ValidationSource[];
}

export const DEFAULT_ITERATIVE_OPTIONS: Required<IterativeProcessingOptions> = {
  mode: 'iterative',
  confidenceThreshold: 0.7,
  onLowConfidence: 'flag',
  maxRetries: 2,
  validateTypes: true,
  validateArtists: true,
  validateVenues: true,
  validateEvents: true,
  skipStorage: false,
  modelKey: '',
  pauseOnLowConfidence: false,
  validationSources: ['musicbrainz', 'discogs', 'internal'],
};

// ============================================================================
// Phase Configuration
// ============================================================================

export interface PhaseConfig {
  enabled: boolean;
  confidenceThreshold: number;
  retryOnLowConfidence: boolean;
  maxRetries: number;
  validationSources?: ValidationSource[];
}

export interface IterativeProcessingConfig {
  type: PhaseConfig;
  artist: PhaseConfig;
  venue: PhaseConfig;
  event: PhaseConfig;
  onLowConfidence: 'flag' | 'pause' | 'skip';
  batchSize: number;
}

export const DEFAULT_PHASE_CONFIG: IterativeProcessingConfig = {
  type: {
    enabled: true,
    confidenceThreshold: 0.7,
    retryOnLowConfidence: true,
    maxRetries: 2,
  },
  artist: {
    enabled: true,
    confidenceThreshold: 0.6,
    retryOnLowConfidence: true,
    maxRetries: 2,
    validationSources: ['musicbrainz', 'discogs', 'internal'],
  },
  venue: {
    enabled: true,
    confidenceThreshold: 0.6,
    retryOnLowConfidence: false,
    maxRetries: 1,
    validationSources: ['internal'],
  },
  event: {
    enabled: true,
    confidenceThreshold: 0.5,
    retryOnLowConfidence: false,
    maxRetries: 1,
  },
  onLowConfidence: 'flag',
  batchSize: 10,
};

// ============================================================================
// Job Status for Iterative Processing
// ============================================================================

export interface IterativeJobStatus {
  jobId: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  currentPhase: ProcessingPhaseName;
  progress: {
    totalImages: number;
    processedImages: number;
    currentImageIndex: number;
    currentImagePath?: string;
  };
  phaseProgress: {
    type: { completed: number; total: number };
    artist: { completed: number; total: number };
    venue: { completed: number; total: number };
    event: { completed: number; total: number };
    assembly: { completed: number; total: number };
  };
  stats: {
    successCount: number;
    failureCount: number;
    lowConfidenceCount: number;
    needsReviewCount: number;
    averageConfidence: number;
  };
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
}

// ============================================================================
// Iterative Processing Result
// ============================================================================

export interface IterativeProcessingResult {
  success: boolean;
  posterId: string;
  imagePath: string;
  entity?: PosterEntity;
  phases: {
    type?: TypePhaseResult;
    artist?: ArtistPhaseResult;
    venue?: VenuePhaseResult;
    event?: EventPhaseResult;
    assembly?: AssemblyPhaseResult;
  };
  overallConfidence: number;
  fieldsNeedingReview: string[];
  processingTimeMs: number;
  error?: string;
}

// ============================================================================
// Batch Processing Types
// ============================================================================

export interface IterativeBatchRequest {
  imagePaths: string[];
  options?: Partial<IterativeProcessingOptions>;
}

export interface IterativeBatchResult {
  jobId: string;
  results: IterativeProcessingResult[];
  summary: {
    total: number;
    successful: number;
    failed: number;
    needsReview: number;
    averageConfidence: number;
    byType: Record<PosterType, number>;
  };
  processingTimeMs: number;
}

// ============================================================================
// Phase Override Types (for manual corrections mid-processing)
// ============================================================================

export interface PhaseOverride {
  posterId: string;
  phase: ProcessingPhaseName;
  field: string;
  value: unknown;
  continueProcessing: boolean;
}

export interface PhaseRetryRequest {
  posterId: string;
  phase: ProcessingPhaseName;
  adjustedPrompt?: string;
  adjustedOptions?: Partial<IterativeProcessingOptions>;
}
