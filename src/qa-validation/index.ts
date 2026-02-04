/**
 * QA Validation Module
 *
 * Provides functionality for validating extracted poster metadata
 * against external sources (MusicBrainz, Discogs, TMDB).
 */

// Main service
export { QAValidationService } from './QAValidationService.js';
export type { QAServiceDependencies } from './QAValidationService.js';

// Types
export * from './types.js';

// Validators
export { BaseValidator } from './validators/BaseValidator.js';
export { ArtistValidator } from './validators/ArtistValidator.js';
export type { ArtistValidatorConfig } from './validators/ArtistValidator.js';
export { VenueValidator } from './validators/VenueValidator.js';
export { DateValidator } from './validators/DateValidator.js';
export { ReleaseValidator } from './validators/ReleaseValidator.js';
export type { ReleaseValidatorConfig } from './validators/ReleaseValidator.js';

// API Clients
export { BaseAPIClient, APIError } from './clients/BaseAPIClient.js';
export type { RequestOptions } from './clients/BaseAPIClient.js';
export { MusicBrainzClient, createMusicBrainzConfig } from './clients/MusicBrainzClient.js';
export { DiscogsClient, createDiscogsConfig } from './clients/DiscogsClient.js';
export { TMDBClient, createTMDBConfig } from './clients/TMDBClient.js';

// Utilities
export * from './utils/stringMatching.js';
export * from './utils/confidenceScoring.js';
