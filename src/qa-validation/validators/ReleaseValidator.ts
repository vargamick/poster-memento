/**
 * Release Validator
 *
 * Validates release/album information using MusicBrainz and Discogs,
 * and film information using TMDB.
 */

import { PosterEntity } from '../../image-processor/types.js';
import { ValidatorResult, ValidationContext, PosterType } from '../types.js';
import { BaseValidator } from './BaseValidator.js';
import { MusicBrainzClient } from '../clients/MusicBrainzClient.js';
import { DiscogsClient } from '../clients/DiscogsClient.js';
import { TMDBClient } from '../clients/TMDBClient.js';
import { combinedSimilarity, normalizeString } from '../utils/stringMatching.js';

/**
 * Configuration for ReleaseValidator
 */
export interface ReleaseValidatorConfig {
  /** Minimum similarity score to consider a match (0-1) */
  matchThreshold?: number;
  /** Minimum similarity score for partial match (0-1) */
  partialThreshold?: number;
  /** Maximum number of search results to consider */
  maxSearchResults?: number;
}

const DEFAULT_CONFIG: Required<ReleaseValidatorConfig> = {
  matchThreshold: 0.85,
  partialThreshold: 0.65,
  maxSearchResults: 5,
};

/**
 * Validates release/album/film information
 */
export class ReleaseValidator extends BaseValidator {
  readonly name = 'release' as const;
  readonly supportedEntityTypes = ['Poster', 'Release'];
  readonly supportedFields = ['title', 'record_label'];

  private musicBrainz: MusicBrainzClient;
  private discogs: DiscogsClient | null;
  private tmdb: TMDBClient | null;
  private config: Required<ReleaseValidatorConfig>;

  constructor(
    musicBrainz: MusicBrainzClient,
    discogs?: DiscogsClient,
    tmdb?: TMDBClient,
    config?: ReleaseValidatorConfig
  ) {
    super();
    this.musicBrainz = musicBrainz;
    this.discogs = discogs ?? null;
    this.tmdb = tmdb ?? null;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Validate release-related fields
   */
  async validate(
    entity: PosterEntity,
    context: ValidationContext
  ): Promise<ValidatorResult[]> {
    const results: ValidatorResult[] = [];
    const posterType = context.posterType ?? entity.poster_type;

    // For film posters, validate against TMDB
    if (posterType === 'film' && !this.isEmpty(entity.title)) {
      const filmResult = await this.validateFilm(entity.title!, entity.year);
      results.push(filmResult);
    }
    // For album/promo posters, validate against music databases
    else if (
      (posterType === 'album' || posterType === 'promo') &&
      !this.isEmpty(entity.title)
    ) {
      const releaseResult = await this.validateMusicRelease(
        entity.title!,
        entity.headliner,
        entity.year
      );
      results.push(releaseResult);
    }

    // Validate record label for music-related posters
    if (
      !this.isEmpty(entity.record_label) &&
      ['album', 'promo', 'concert', 'festival'].includes(posterType ?? '')
    ) {
      const labelResult = await this.validateRecordLabel(entity.record_label!);
      results.push(labelResult);
    }

    return results;
  }

  /**
   * Validate a film title against TMDB
   */
  private async validateFilm(
    title: string,
    year?: number
  ): Promise<ValidatorResult> {
    if (!this.tmdb) {
      return this.createUnverifiedResult(
        'title',
        title,
        'tmdb',
        'TMDB client not configured for film validation'
      );
    }

    try {
      const results = await this.tmdb.searchMovie(title, year, this.config.maxSearchResults);

      if (!results.length) {
        return this.createUnverifiedResult(
          'title',
          title,
          'tmdb',
          `Film "${title}" not found in TMDB`
        );
      }

      // Calculate similarity for each result
      const normalizedInput = normalizeString(title);
      const matches = results.map(movie => ({
        movie,
        similarity: Math.max(
          combinedSimilarity(normalizedInput, normalizeString(movie.title)),
          combinedSimilarity(normalizedInput, normalizeString(movie.originalTitle))
        ),
      }));

      // Sort by similarity
      matches.sort((a, b) => b.similarity - a.similarity);

      const best = matches[0];

      if (best.similarity >= this.config.partialThreshold) {
        const status = best.similarity >= this.config.matchThreshold ? 'match' : 'partial';
        const releaseYear = TMDBClient.extractYear(best.movie.releaseDate);

        let message = `Found: "${best.movie.title}"`;
        if (releaseYear) {
          message += ` (${releaseYear})`;
        }

        // Check year consistency if provided
        if (year && releaseYear && Math.abs(year - releaseYear) > 1) {
          return this.createResult('title', title, {
            validatedValue: best.movie.title,
            confidence: best.similarity * 0.7, // Reduce confidence due to year mismatch
            status: 'partial',
            source: 'tmdb',
            externalId: String(best.movie.id),
            externalUrl: this.tmdb.getMovieUrl(best.movie.id),
            message: `${message} - Note: Year mismatch (poster: ${year}, TMDB: ${releaseYear})`,
            alternatives: matches.slice(1, 4).map(m => ({
              value: m.movie.title,
              confidence: m.similarity,
              externalId: String(m.movie.id),
            })),
          });
        }

        return this.createResult('title', title, {
          validatedValue: best.movie.title,
          confidence: best.similarity,
          status,
          source: 'tmdb',
          externalId: String(best.movie.id),
          externalUrl: this.tmdb.getMovieUrl(best.movie.id),
          message: status === 'match' ? `Verified: ${message}` : `Possible match: ${message}`,
          alternatives: matches.slice(1, 4).map(m => ({
            value: m.movie.title,
            confidence: m.similarity,
            externalId: String(m.movie.id),
          })),
        });
      }

      return this.createUnverifiedResult(
        'title',
        title,
        'tmdb',
        `No confident match found for film "${title}" in TMDB`
      );
    } catch (error) {
      this.log('warn', `TMDB search failed for "${title}"`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.createUnverifiedResult(
        'title',
        title,
        'tmdb',
        `TMDB search failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Validate a music release against MusicBrainz and Discogs
   */
  private async validateMusicRelease(
    title: string,
    artist?: string,
    year?: number
  ): Promise<ValidatorResult> {
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
          const status = best.similarity >= this.config.matchThreshold ? 'match' : 'partial';

          return this.createResult('title', title, {
            validatedValue: best.release.title,
            confidence: best.similarity,
            status,
            source: 'musicbrainz',
            externalId: best.release.id,
            externalUrl: this.musicBrainz.getReleaseUrl(best.release.id),
            message: `${status === 'match' ? 'Verified' : 'Possible match'}: "${best.release.title}" by ${best.release.artistCredit}`,
            alternatives: matches.slice(1, 4).map(m => ({
              value: `${m.release.title} by ${m.release.artistCredit}`,
              confidence: m.similarity,
              externalId: m.release.id,
            })),
          });
        }
      }
    } catch (error) {
      this.log('warn', `MusicBrainz search failed for release "${title}"`, {
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
            const status = best.similarity >= this.config.matchThreshold ? 'match' : 'partial';

            return this.createResult('title', title, {
              validatedValue: best.release.title,
              confidence: best.similarity,
              status,
              source: 'discogs',
              externalId: String(best.release.id),
              externalUrl: this.discogs.getReleaseUrl(best.release.id),
              message: `${status === 'match' ? 'Verified' : 'Possible match'}: "${best.release.title}"${best.release.year ? ` (${best.release.year})` : ''}`,
              alternatives: matches.slice(1, 4).map(m => ({
                value: m.release.title,
                confidence: m.similarity,
                externalId: String(m.release.id),
              })),
            });
          }
        }
      } catch (error) {
        this.log('warn', `Discogs search failed for release "${title}"`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return this.createUnverifiedResult(
      'title',
      title,
      'musicbrainz',
      `Release "${title}" not found in MusicBrainz${this.discogs ? ' or Discogs' : ''}`
    );
  }

  /**
   * Validate a record label name
   */
  private async validateRecordLabel(labelName: string): Promise<ValidatorResult> {
    const normalizedLabel = normalizeString(labelName);

    // Try MusicBrainz first
    try {
      const mbLabels = await this.musicBrainz.searchLabel(
        labelName,
        this.config.maxSearchResults
      );

      if (mbLabels.length > 0) {
        const matches = mbLabels.map(label => ({
          label,
          similarity: combinedSimilarity(normalizedLabel, normalizeString(label.name)),
        }));

        matches.sort((a, b) => b.similarity - a.similarity);
        const best = matches[0];

        if (best.similarity >= this.config.partialThreshold) {
          const status = best.similarity >= this.config.matchThreshold ? 'match' : 'partial';

          return this.createResult('record_label', labelName, {
            validatedValue: best.label.name,
            confidence: best.similarity,
            status,
            source: 'musicbrainz',
            externalId: best.label.id,
            externalUrl: this.musicBrainz.getLabelUrl(best.label.id),
            message: `${status === 'match' ? 'Verified' : 'Possible match'}: "${best.label.name}"`,
          });
        }
      }
    } catch (error) {
      this.log('warn', `MusicBrainz label search failed for "${labelName}"`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Try Discogs labels
    if (this.discogs) {
      try {
        const dcLabels = await this.discogs.searchLabel(
          labelName,
          this.config.maxSearchResults
        );

        if (dcLabels.length > 0) {
          const matches = dcLabels.map(label => ({
            label,
            similarity: combinedSimilarity(normalizedLabel, normalizeString(label.title)),
          }));

          matches.sort((a, b) => b.similarity - a.similarity);
          const best = matches[0];

          if (best.similarity >= this.config.partialThreshold) {
            const status = best.similarity >= this.config.matchThreshold ? 'match' : 'partial';

            return this.createResult('record_label', labelName, {
              validatedValue: best.label.title,
              confidence: best.similarity,
              status,
              source: 'discogs',
              externalId: String(best.label.id),
              externalUrl: this.discogs.getLabelUrl(best.label.id),
              message: `${status === 'match' ? 'Verified' : 'Possible match'}: "${best.label.title}"`,
            });
          }
        }
      } catch (error) {
        this.log('warn', `Discogs label search failed for "${labelName}"`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return this.createUnverifiedResult(
      'record_label',
      labelName,
      'musicbrainz',
      `Label "${labelName}" not found`
    );
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
