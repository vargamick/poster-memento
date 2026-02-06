/**
 * Poster Type Validator
 *
 * Infers the correct poster_type by cross-referencing extracted data
 * against external sources (MusicBrainz, Discogs, TMDB).
 *
 * This validator is especially useful for posters marked as 'unknown'
 * when the vision model couldn't determine the type.
 */

import { PosterEntity } from '../../image-processor/types.js';
import { ValidatorResult, ValidationContext, PosterType, QARelationshipSuggestion } from '../types.js';
import { BaseValidator } from './BaseValidator.js';
import { MusicBrainzClient } from '../clients/MusicBrainzClient.js';
import { DiscogsClient } from '../clients/DiscogsClient.js';
import { TMDBClient } from '../clients/TMDBClient.js';
import { combinedSimilarity, normalizeString } from '../utils/stringMatching.js';

/**
 * Configuration for PosterTypeValidator
 */
export interface PosterTypeValidatorConfig {
  /** Minimum similarity score to consider a match (0-1) */
  matchThreshold?: number;
  /** Minimum similarity score for partial match (0-1) */
  partialThreshold?: number;
  /** Maximum number of search results to consider */
  maxSearchResults?: number;
  /** Only infer types for 'unknown' posters */
  onlyUnknown?: boolean;
}

const DEFAULT_CONFIG: Required<PosterTypeValidatorConfig> = {
  matchThreshold: 0.85,
  partialThreshold: 0.65,
  maxSearchResults: 5,
  onlyUnknown: false, // Validate all posters, but prioritize unknown
};

/**
 * Inference result from external API lookup
 */
interface TypeInferenceResult {
  inferredType: PosterType;
  confidence: number;
  source: 'musicbrainz' | 'discogs' | 'tmdb' | 'internal';
  externalId?: string;
  externalUrl?: string;
  evidence: string;
}

/**
 * Existing HAS_TYPE relationship info
 */
interface ExistingTypeRelationship {
  typeKey: string;
  confidence: number;
  source: string;
  isPrimary: boolean;
}

/**
 * Extended validation result that includes relationship suggestions
 */
export interface PosterTypeValidationResult {
  validatorResults: ValidatorResult[];
  relationshipSuggestions: QARelationshipSuggestion[];
}

/**
 * Validates and infers poster_type using external data sources
 * Now supports both property-based and relationship-based validation
 */
export class PosterTypeValidator extends BaseValidator {
  readonly name = 'poster_type' as const;
  readonly supportedEntityTypes = ['Poster'];
  readonly supportedFields = ['poster_type', 'HAS_TYPE'];

  private musicBrainz: MusicBrainzClient;
  private discogs: DiscogsClient | null;
  private tmdb: TMDBClient | null;
  private config: Required<PosterTypeValidatorConfig>;

  constructor(
    musicBrainz: MusicBrainzClient,
    discogs?: DiscogsClient,
    tmdb?: TMDBClient,
    config?: PosterTypeValidatorConfig
  ) {
    super();
    this.musicBrainz = musicBrainz;
    this.discogs = discogs ?? null;
    this.tmdb = tmdb ?? null;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Validate poster_type field by attempting to infer correct type
   */
  async validate(
    entity: PosterEntity,
    _context: ValidationContext
  ): Promise<ValidatorResult[]> {
    const results: ValidatorResult[] = [];
    const currentType = entity.poster_type ?? 'unknown';

    // Skip if configured to only check unknown types and this isn't unknown
    if (this.config.onlyUnknown && currentType !== 'unknown') {
      return results;
    }

    // Attempt to infer the correct poster type
    const inference = await this.inferPosterType(entity);

    if (inference) {
      // If current type matches inferred type, it's validated
      if (currentType === inference.inferredType) {
        results.push(
          this.createResult('poster_type', currentType, {
            validatedValue: inference.inferredType,
            confidence: inference.confidence,
            status: 'match',
            source: inference.source,
            externalId: inference.externalId,
            externalUrl: inference.externalUrl,
            message: `Type confirmed: ${inference.evidence}`,
          })
        );
      }
      // If current type is unknown and we found a better type
      else if (currentType === 'unknown') {
        results.push(
          this.createResult('poster_type', currentType, {
            validatedValue: inference.inferredType,
            confidence: inference.confidence,
            status: 'mismatch',
            source: inference.source,
            externalId: inference.externalId,
            externalUrl: inference.externalUrl,
            message: `Suggested type: "${inference.inferredType}" - ${inference.evidence}`,
          })
        );
      }
      // If current type differs from inferred type (potential misclassification)
      else if (inference.confidence >= this.config.matchThreshold) {
        results.push(
          this.createResult('poster_type', currentType, {
            validatedValue: inference.inferredType,
            confidence: inference.confidence,
            status: 'partial',
            source: inference.source,
            externalId: inference.externalId,
            externalUrl: inference.externalUrl,
            message: `Consider changing type to "${inference.inferredType}" - ${inference.evidence}`,
          })
        );
      }
    } else if (currentType === 'unknown') {
      // Could not infer type for unknown poster
      results.push(
        this.createUnverifiedResult(
          'poster_type',
          currentType,
          'internal',
          'Could not infer poster type from available data'
        )
      );
    }

    return results;
  }

  /**
   * Validate poster type and generate relationship suggestions
   * This is the new preferred method for graph-native validation
   */
  async validateWithRelationships(
    entity: PosterEntity,
    context: ValidationContext,
    existingRelationships?: ExistingTypeRelationship[]
  ): Promise<PosterTypeValidationResult> {
    const validatorResults = await this.validate(entity, context);
    const relationshipSuggestions: QARelationshipSuggestion[] = [];

    // Get the current type from existing relationships or property
    const existingTypes = existingRelationships || [];
    const currentTypeFromProperty = entity.poster_type ?? 'unknown';
    const currentTypeFromRelationship = existingTypes.find(r => r.isPrimary)?.typeKey;
    const currentType = currentTypeFromRelationship || currentTypeFromProperty;

    // Attempt to infer the correct poster type
    const inference = await this.inferPosterType(entity);

    if (inference) {
      // Check if we need to suggest relationship changes
      const targetPosterTypeName = `PosterType_${inference.inferredType}`;

      if (existingTypes.length === 0) {
        // No existing HAS_TYPE relationship - suggest creating one
        if (inference.inferredType !== 'unknown') {
          relationshipSuggestions.push({
            operation: 'create',
            relationType: 'HAS_TYPE',
            fromEntity: entity.name,
            toEntity: targetPosterTypeName,
            suggestedMetadata: {
              confidence: inference.confidence,
              source: inference.source,
              evidence: inference.evidence,
              inferred_by: 'PosterTypeValidator',
              is_primary: true,
            },
            reason: `Create HAS_TYPE relationship: ${inference.evidence}`,
            externalId: inference.externalId,
            externalUrl: inference.externalUrl,
          });
        }
      } else if (currentType !== inference.inferredType) {
        // Existing relationship doesn't match inferred type
        const existingPrimary = existingTypes.find(r => r.isPrimary);

        if (existingPrimary && inference.confidence > existingPrimary.confidence) {
          // Higher confidence - suggest updating the existing relationship
          const currentPosterTypeName = `PosterType_${existingPrimary.typeKey}`;

          // Suggest deleting the old primary and creating a new one
          relationshipSuggestions.push({
            operation: 'update',
            relationType: 'HAS_TYPE',
            fromEntity: entity.name,
            toEntity: targetPosterTypeName,
            currentMetadata: {
              typeKey: existingPrimary.typeKey,
              confidence: existingPrimary.confidence,
              source: existingPrimary.source,
            },
            suggestedMetadata: {
              confidence: inference.confidence,
              source: inference.source,
              evidence: inference.evidence,
              inferred_by: 'PosterTypeValidator',
              is_primary: true,
            },
            reason: `Update type from "${existingPrimary.typeKey}" to "${inference.inferredType}" (higher confidence: ${(inference.confidence * 100).toFixed(0)}% vs ${(existingPrimary.confidence * 100).toFixed(0)}%) - ${inference.evidence}`,
            externalId: inference.externalId,
            externalUrl: inference.externalUrl,
          });
        }
      }
    }

    return {
      validatorResults,
      relationshipSuggestions,
    };
  }

  /**
   * Attempt to infer the poster type from entity data
   */
  private async inferPosterType(
    entity: PosterEntity
  ): Promise<TypeInferenceResult | null> {
    // Strategy 1: Check for music release (headliner + title → album lookup)
    if (!this.isEmpty(entity.headliner) && !this.isEmpty(entity.title)) {
      const releaseResult = await this.checkMusicRelease(
        entity.headliner!,
        entity.title!,
        entity.year
      );
      if (releaseResult) {
        return releaseResult;
      }
    }

    // Strategy 2: Check for film (title → TMDB lookup, especially if no headliner)
    if (!this.isEmpty(entity.title) && this.isEmpty(entity.headliner)) {
      const filmResult = await this.checkFilm(entity.title!, entity.year);
      if (filmResult) {
        return filmResult;
      }
    }

    // Strategy 3: Infer from structural elements
    const structuralResult = this.inferFromStructure(entity);
    if (structuralResult) {
      return structuralResult;
    }

    return null;
  }

  /**
   * Check if this is a music release by looking up artist + title
   */
  private async checkMusicRelease(
    artist: string,
    title: string,
    year?: number
  ): Promise<TypeInferenceResult | null> {
    const normalizedTitle = normalizeString(title);

    // Try MusicBrainz first
    try {
      const mbResults = await this.musicBrainz.searchRelease(
        title,
        artist,
        this.config.maxSearchResults
      );

      if (mbResults.length > 0) {
        const matches = mbResults.map(release => ({
          release,
          similarity: combinedSimilarity(normalizedTitle, normalizeString(release.title)),
        }));

        matches.sort((a, b) => b.similarity - a.similarity);
        const best = matches[0];

        if (best.similarity >= this.config.partialThreshold) {
          return {
            inferredType: 'album',
            confidence: best.similarity,
            source: 'musicbrainz',
            externalId: best.release.id,
            externalUrl: this.musicBrainz.getReleaseUrl(best.release.id),
            evidence: `Found album "${best.release.title}" by ${best.release.artistCredit} in MusicBrainz`,
          };
        }
      }
    } catch (error) {
      this.log('warn', `MusicBrainz release search failed for "${title}"`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Try Discogs as fallback
    if (this.discogs) {
      try {
        const dcResults = await this.discogs.searchRelease(
          title,
          artist,
          this.config.maxSearchResults
        );

        if (dcResults.length > 0) {
          const matches = dcResults.map(release => ({
            release,
            similarity: combinedSimilarity(normalizedTitle, normalizeString(release.title)),
          }));

          matches.sort((a, b) => b.similarity - a.similarity);
          const best = matches[0];

          if (best.similarity >= this.config.partialThreshold) {
            return {
              inferredType: 'album',
              confidence: best.similarity,
              source: 'discogs',
              externalId: String(best.release.id),
              externalUrl: this.discogs.getReleaseUrl(best.release.id),
              evidence: `Found album "${best.release.title}" in Discogs`,
            };
          }
        }
      } catch (error) {
        this.log('warn', `Discogs release search failed for "${title}"`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return null;
  }

  /**
   * Check if this is a film by looking up title in TMDB
   */
  private async checkFilm(
    title: string,
    year?: number
  ): Promise<TypeInferenceResult | null> {
    if (!this.tmdb) {
      return null;
    }

    try {
      const results = await this.tmdb.searchMovie(title, year, this.config.maxSearchResults);

      if (results.length > 0) {
        const normalizedInput = normalizeString(title);
        const matches = results.map(movie => ({
          movie,
          similarity: Math.max(
            combinedSimilarity(normalizedInput, normalizeString(movie.title)),
            combinedSimilarity(normalizedInput, normalizeString(movie.originalTitle))
          ),
        }));

        matches.sort((a, b) => b.similarity - a.similarity);
        const best = matches[0];

        if (best.similarity >= this.config.partialThreshold) {
          const releaseYear = TMDBClient.extractYear(best.movie.releaseDate);

          return {
            inferredType: 'film',
            confidence: best.similarity,
            source: 'tmdb',
            externalId: String(best.movie.id),
            externalUrl: this.tmdb.getMovieUrl(best.movie.id),
            evidence: `Found movie "${best.movie.title}"${releaseYear ? ` (${releaseYear})` : ''} in TMDB`,
          };
        }
      }
    } catch (error) {
      this.log('warn', `TMDB search failed for "${title}"`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return null;
  }

  /**
   * Infer type from structural elements (venue, date, multiple artists, etc.)
   */
  private inferFromStructure(entity: PosterEntity): TypeInferenceResult | null {
    const hasVenue = !this.isEmpty(entity.venue_name);
    const hasDate = !this.isEmpty(entity.event_date);
    const hasHeadliner = !this.isEmpty(entity.headliner);
    const supportingActs = this.getArrayValue(entity.supporting_acts);
    const hasSupportingActs = supportingActs.length > 0;
    const hasTitle = !this.isEmpty(entity.title);

    // Festival: Multiple artists (3+) with or without venue
    if (supportingActs.length >= 2 && hasHeadliner) {
      return {
        inferredType: 'festival',
        confidence: 0.7,
        source: 'internal',
        evidence: `Multiple artists detected (${supportingActs.length + 1} total)`,
      };
    }

    // Concert: Venue + Date + Headliner
    if (hasVenue && hasDate && hasHeadliner) {
      return {
        inferredType: 'concert',
        confidence: 0.75,
        source: 'internal',
        evidence: `Has venue (${entity.venue_name}), date, and headliner`,
      };
    }

    // Album: Headliner + Title but no venue (likely album promo)
    if (hasHeadliner && hasTitle && !hasVenue && !hasDate) {
      return {
        inferredType: 'album',
        confidence: 0.6,
        source: 'internal',
        evidence: `Has artist and title but no venue/date - likely album promo`,
      };
    }

    // Exhibition: Has title but no artists
    if (hasTitle && !hasHeadliner && !hasSupportingActs && !hasVenue) {
      // Low confidence - could be many things
      return null;
    }

    return null;
  }

  /**
   * Check if external APIs are available
   */
  async healthCheck(): Promise<boolean> {
    try {
      const mbHealth = await this.musicBrainz.healthCheck();
      if (!mbHealth) {
        this.log('warn', 'MusicBrainz API unavailable');
        return false;
      }

      // Check optional dependencies
      if (this.discogs) {
        const dcHealth = await this.discogs.healthCheck();
        if (!dcHealth) {
          this.log('warn', 'Discogs API unavailable');
        }
      }

      if (this.tmdb) {
        const tmdbHealth = await this.tmdb.healthCheck();
        if (!tmdbHealth) {
          this.log('warn', 'TMDB API unavailable');
        }
      }

      return true;
    } catch {
      return false;
    }
  }
}
