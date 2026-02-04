/**
 * QA Validation Types for Poster Memento
 *
 * Types and interfaces for the QA validation system that validates
 * extracted poster metadata against external sources.
 */

import { PosterEntity } from '../image-processor/types.js';

// ============================================================================
// Validation Result Types
// ============================================================================

export type ValidationStatus = 'match' | 'partial' | 'mismatch' | 'unverified';
export type OverallStatus = 'validated' | 'warning' | 'mismatch' | 'unverified';
export type ValidationSource = 'musicbrainz' | 'discogs' | 'tmdb' | 'wikidata' | 'internal';

/**
 * Result from a single field validation
 */
export interface ValidatorResult {
  validatorName: string;
  field: string;
  originalValue: string | undefined;
  validatedValue?: string;
  confidence: number;              // 0-1 scale
  status: ValidationStatus;
  source: ValidationSource;
  externalId?: string;             // ID in external system (e.g., MusicBrainz MBID)
  externalUrl?: string;            // URL to external resource
  message?: string;                // Human-readable explanation
  alternatives?: Array<{           // Alternative matches found
    value: string;
    confidence: number;
    externalId?: string;
  }>;
}

/**
 * Suggestion for correcting a field value
 */
export interface QASuggestion {
  field: string;
  currentValue: string | undefined;
  suggestedValue: string;
  reason: string;
  confidence: number;
  source: ValidationSource;
  externalId?: string;
}

/**
 * Suggestion for a relationship operation
 */
export interface QARelationshipSuggestion {
  /** Type of operation to perform */
  operation: 'create' | 'update' | 'delete';
  /** Relationship type (e.g., 'HAS_TYPE') */
  relationType: string;
  /** Source entity name */
  fromEntity: string;
  /** Target entity name */
  toEntity: string;
  /** Current relationship metadata (for update/delete) */
  currentMetadata?: Record<string, unknown>;
  /** Suggested relationship metadata (for create/update) */
  suggestedMetadata?: {
    confidence: number;
    source: ValidationSource;
    evidence?: string;
    inferred_by?: string;
    is_primary?: boolean;
  };
  /** Human-readable reason for the suggestion */
  reason: string;
  /** External reference */
  externalId?: string;
  externalUrl?: string;
}

/**
 * External match found during validation
 */
export interface ExternalMatch {
  source: ValidationSource;
  externalId: string;
  name: string;
  matchScore: number;
  url: string;
  metadata?: Record<string, unknown>;
}

/**
 * Complete validation result for a single entity
 */
export interface QAValidationResult {
  entityId: string;
  entityType: 'Poster' | 'Artist' | 'Venue' | 'Event' | 'Release';
  overallScore: number;            // 0-100 confidence score
  status: OverallStatus;
  validatedAt: string;             // ISO timestamp
  validatorResults: ValidatorResult[];
  suggestions: QASuggestion[];
  /** Relationship operation suggestions (for graph-native validation) */
  relationshipSuggestions?: QARelationshipSuggestion[];
  externalMatches: ExternalMatch[];
  processingTimeMs: number;
}

// ============================================================================
// Job Management Types
// ============================================================================

export type QAJobPhase =
  | 'pending'
  | 'fetching_entities'
  | 'validating_artists'
  | 'validating_venues'
  | 'validating_dates'
  | 'validating_releases'
  | 'validating_poster_type'
  | 'generating_report'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * Statistics for a QA validation job
 */
export interface QAJobStats {
  totalEntities: number;
  processedEntities: number;
  validatedCount: number;          // status === 'validated'
  warningCount: number;            // status === 'warning'
  mismatchCount: number;           // status === 'mismatch'
  unverifiedCount: number;         // status === 'unverified'
  averageScore: number;
  apiCallsMade: number;
  errors: string[];
}

/**
 * Status of a QA validation job
 */
export interface QAJobStatus {
  jobId: string;
  phase: QAJobPhase;
  progress: number;                // 0-100
  message: string;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
  config: QAValidationConfig;
  stats: QAJobStats;
}

// ============================================================================
// Configuration Types
// ============================================================================

export type ValidatorName = 'artist' | 'venue' | 'date' | 'release' | 'poster_type';
export type PosterType = 'concert' | 'festival' | 'comedy' | 'theater' | 'film' | 'release' | 'promo' | 'exhibition' | 'hybrid' | 'unknown';

/**
 * Configuration for a QA validation job
 */
export interface QAValidationConfig {
  /** Entity types to validate */
  entityTypes?: ('Poster' | 'Artist' | 'Venue' | 'Event' | 'Release')[];

  /** Filter by poster types */
  posterTypes?: PosterType[];

  /** Which validators to run */
  validators?: ValidatorName[];

  /** Minimum confidence threshold (0-1) for considering a match valid */
  minConfidenceThreshold?: number;

  /** Include entities that couldn't be verified */
  includeUnverified?: boolean;

  /** Number of entities to process per batch */
  batchSize?: number;

  /** Delay between batches in ms (for rate limiting) */
  delayBetweenBatches?: number;

  /** Fail the job on any mismatch */
  strictMode?: boolean;

  /** Specific entity IDs to validate (optional) */
  entityIds?: string[];
}

/**
 * Default configuration values
 */
export const DEFAULT_QA_CONFIG: Required<Omit<QAValidationConfig, 'entityIds'>> = {
  entityTypes: ['Poster'],
  posterTypes: ['concert', 'festival', 'comedy', 'theater', 'film', 'release', 'unknown'],
  validators: ['artist', 'venue', 'date', 'release', 'poster_type'],
  minConfidenceThreshold: 0.7,
  includeUnverified: true,
  batchSize: 10,
  delayBetweenBatches: 1000,
  strictMode: false,
};

// ============================================================================
// Report Types
// ============================================================================

/**
 * Summary statistics for an entity type
 */
export interface EntityTypeSummary {
  total: number;
  validated: number;
  warnings: number;
  mismatches: number;
  unverified: number;
  averageScore: number;
}

/**
 * Issue summary for reporting
 */
export interface IssueSummary {
  field: string;
  count: number;
  examples: Array<{
    entityId: string;
    currentValue: string;
    suggestedValue?: string;
  }>;
}

/**
 * Summary section of a QA report
 */
export interface QAReportSummary {
  totalEntities: number;
  validatedCount: number;
  warningCount: number;
  mismatchCount: number;
  unverifiedCount: number;
  overallScore: number;
  byEntityType: Record<string, EntityTypeSummary>;
  byPosterType: Record<string, EntityTypeSummary>;
  topIssues: IssueSummary[];
  apiStats: {
    musicbrainz: { calls: number; successes: number; failures: number };
    discogs: { calls: number; successes: number; failures: number };
    tmdb: { calls: number; successes: number; failures: number };
  };
}

/**
 * Complete QA validation report
 */
export interface QAReport {
  reportId: string;
  jobId: string;
  generatedAt: string;
  config: QAValidationConfig;
  summary: QAReportSummary;
  results: QAValidationResult[];
  recommendations: string[];
}

// ============================================================================
// External API Types
// ============================================================================

/**
 * Rate limiter configuration
 */
export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

/**
 * API client configuration
 */
export interface APIClientConfig {
  baseUrl: string;
  userAgent: string;
  rateLimit: RateLimitConfig;
  timeout?: number;
  apiKey?: string;
  cacheTTL?: number;              // Cache time-to-live in ms
}

/**
 * MusicBrainz artist search result
 */
export interface MusicBrainzArtist {
  id: string;                      // MBID
  name: string;
  sortName: string;
  disambiguation?: string;
  type?: string;                   // 'Person' | 'Group' | 'Orchestra' | etc.
  country?: string;
  area?: string;
  score: number;                   // Search relevance score
  tags?: Array<{ name: string; count: number }>;
}

/**
 * MusicBrainz release search result
 */
export interface MusicBrainzRelease {
  id: string;
  title: string;
  artistCredit: string;
  releaseGroup?: {
    id: string;
    primaryType?: string;
  };
  date?: string;
  country?: string;
  labelInfo?: Array<{
    label?: { id: string; name: string };
  }>;
  score: number;
}

/**
 * Discogs artist search result
 */
export interface DiscogsArtist {
  id: number;
  title: string;                   // Artist name
  thumb: string;
  coverImage: string;
  resourceUrl: string;
}

/**
 * Discogs release search result
 */
export interface DiscogsRelease {
  id: number;
  title: string;
  year?: string;
  format?: string[];
  label?: string[];
  genre?: string[];
  style?: string[];
  thumb: string;
  resourceUrl: string;
}

/**
 * Discogs label search result
 */
export interface DiscogsLabel {
  id: number;
  title: string;
  resourceUrl: string;
}

/**
 * TMDB movie search result
 */
export interface TMDBMovie {
  id: number;
  title: string;
  originalTitle: string;
  releaseDate: string;
  overview: string;
  posterPath?: string;
  popularity: number;
  voteAverage: number;
}

// ============================================================================
// Validator Types
// ============================================================================

/**
 * Context passed to validators
 */
export interface ValidationContext {
  config: QAValidationConfig;
  posterType?: PosterType;
  relatedEntities?: {
    artists?: string[];
    venues?: string[];
    events?: string[];
  };
}

/**
 * Base validator interface
 */
export interface IValidator {
  name: ValidatorName;
  supportedEntityTypes: string[];
  supportedFields: string[];

  validate(
    entity: PosterEntity,
    context: ValidationContext
  ): Promise<ValidatorResult[]>;

  healthCheck(): Promise<boolean>;
}

// ============================================================================
// Service Types
// ============================================================================

/**
 * QA service configuration
 */
export interface QAServiceConfig {
  enabled: boolean;
  defaultValidators: ValidatorName[];
  confidenceThreshold: number;
  externalAPIs: {
    musicbrainz: { enabled: boolean; rateLimit: number };
    discogs: { enabled: boolean; rateLimit: number };
    tmdb: { enabled: boolean; rateLimit: number };
  };
}

/**
 * Service result type (following existing patterns)
 */
export interface QAServiceResult<T> {
  success: boolean;
  data?: T;
  errors?: string[];
  warnings?: string[];
}
