/**
 * Film Validator
 *
 * Validates film poster metadata including directors, cast, and titles
 * using TMDB (The Movie Database) API.
 */

import { PosterEntity } from '../../image-processor/types.js';
import { ValidatorResult, ValidationContext } from '../types.js';
import { BaseValidator } from './BaseValidator.js';
import { TMDBClient } from '../clients/TMDBClient.js';
import { combinedSimilarity, normalizeString } from '../utils/stringMatching.js';

/**
 * Configuration for FilmValidator
 */
export interface FilmValidatorConfig {
  /** Minimum similarity score to consider a match (0-1) */
  matchThreshold?: number;
  /** Minimum similarity score for partial match (0-1) */
  partialThreshold?: number;
  /** Maximum number of search results to consider */
  maxSearchResults?: number;
}

const DEFAULT_CONFIG: Required<FilmValidatorConfig> = {
  matchThreshold: 0.85,
  partialThreshold: 0.65,
  maxSearchResults: 5,
};

/**
 * Validates film poster metadata against TMDB
 */
export class FilmValidator extends BaseValidator {
  readonly name = 'film' as const;
  readonly supportedEntityTypes = ['Poster'];
  readonly supportedFields = ['title', 'director', 'cast'];

  private tmdb: TMDBClient;
  private config: Required<FilmValidatorConfig>;

  constructor(tmdb: TMDBClient, config?: FilmValidatorConfig) {
    super();
    this.tmdb = tmdb;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Validate film-related fields
   */
  async validate(
    entity: PosterEntity,
    context: ValidationContext
  ): Promise<ValidatorResult[]> {
    const results: ValidatorResult[] = [];
    const posterType = context.posterType ?? entity.poster_type;

    // Only validate film posters
    if (posterType !== 'film') {
      return results;
    }

    // Validate film title and get movie details
    let movieId: number | undefined;
    if (!this.isEmpty(entity.title)) {
      const titleResult = await this.validateFilmTitle(entity.title!, entity.year);
      results.push(titleResult);

      // Extract movie ID if we got a match
      if (titleResult.externalId) {
        movieId = parseInt(titleResult.externalId, 10);
      }
    }

    // If we have a movie ID, validate director and cast against its credits
    if (movieId) {
      // Validate director
      if (!this.isEmpty(entity.headliner)) {
        const directorResult = await this.validateDirector(entity.headliner!, movieId);
        results.push(directorResult);
      }

      // Validate cast (supporting_acts is used for cast in film posters)
      if (entity.supporting_acts && entity.supporting_acts.length > 0) {
        for (const actor of entity.supporting_acts) {
          const actorResult = await this.validateCastMember(actor, movieId);
          results.push(actorResult);
        }
      }
    } else {
      // Without movie ID, do general person searches
      if (!this.isEmpty(entity.headliner)) {
        const directorResult = await this.validatePerson(entity.headliner!, 'Directing');
        results.push(directorResult);
      }
    }

    return results;
  }

  /**
   * Validate a film title against TMDB
   */
  private async validateFilmTitle(
    title: string,
    year?: number
  ): Promise<ValidatorResult> {
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
   * Validate a director against movie credits
   */
  private async validateDirector(
    directorName: string,
    movieId: number
  ): Promise<ValidatorResult> {
    try {
      const credits = await this.tmdb.getMovieCredits(movieId);

      if (!credits) {
        return this.createUnverifiedResult(
          'director',
          directorName,
          'tmdb',
          'Could not fetch movie credits'
        );
      }

      // Find directors in crew
      const directors = credits.crew.filter(c => c.job === 'Director');

      if (directors.length === 0) {
        return this.createUnverifiedResult(
          'director',
          directorName,
          'tmdb',
          'No director found in movie credits'
        );
      }

      // Calculate similarity for each director
      const normalizedInput = normalizeString(directorName);
      const matches = directors.map(director => ({
        director,
        similarity: combinedSimilarity(normalizedInput, normalizeString(director.name)),
      }));

      matches.sort((a, b) => b.similarity - a.similarity);
      const best = matches[0];

      if (best.similarity >= this.config.partialThreshold) {
        const status = best.similarity >= this.config.matchThreshold ? 'match' : 'partial';

        return this.createResult('director', directorName, {
          validatedValue: best.director.name,
          confidence: best.similarity,
          status,
          source: 'tmdb',
          externalId: String(best.director.id),
          externalUrl: this.tmdb.getPersonUrl(best.director.id),
          message: `${status === 'match' ? 'Verified' : 'Possible match'}: ${best.director.name}`,
          alternatives: matches.slice(1).map(m => ({
            value: m.director.name,
            confidence: m.similarity,
            externalId: String(m.director.id),
          })),
        });
      }

      return this.createUnverifiedResult(
        'director',
        directorName,
        'tmdb',
        `Director "${directorName}" not matched in movie credits`
      );
    } catch (error) {
      this.log('warn', `TMDB credits fetch failed for movie ${movieId}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.createUnverifiedResult(
        'director',
        directorName,
        'tmdb',
        `TMDB credits fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Validate a cast member against movie credits
   */
  private async validateCastMember(
    actorName: string,
    movieId: number
  ): Promise<ValidatorResult> {
    try {
      const credits = await this.tmdb.getMovieCredits(movieId);

      if (!credits) {
        return this.createUnverifiedResult(
          'cast',
          actorName,
          'tmdb',
          'Could not fetch movie credits'
        );
      }

      if (credits.cast.length === 0) {
        return this.createUnverifiedResult(
          'cast',
          actorName,
          'tmdb',
          'No cast found in movie credits'
        );
      }

      // Calculate similarity for each cast member
      const normalizedInput = normalizeString(actorName);
      const matches = credits.cast.map(actor => ({
        actor,
        similarity: combinedSimilarity(normalizedInput, normalizeString(actor.name)),
      }));

      matches.sort((a, b) => b.similarity - a.similarity);
      const best = matches[0];

      if (best.similarity >= this.config.partialThreshold) {
        const status = best.similarity >= this.config.matchThreshold ? 'match' : 'partial';

        return this.createResult('cast', actorName, {
          validatedValue: best.actor.name,
          confidence: best.similarity,
          status,
          source: 'tmdb',
          externalId: String(best.actor.id),
          externalUrl: this.tmdb.getPersonUrl(best.actor.id),
          message: `${status === 'match' ? 'Verified' : 'Possible match'}: ${best.actor.name} as ${best.actor.character}`,
          alternatives: matches.slice(1, 4).map(m => ({
            value: `${m.actor.name} as ${m.actor.character}`,
            confidence: m.similarity,
            externalId: String(m.actor.id),
          })),
        });
      }

      return this.createUnverifiedResult(
        'cast',
        actorName,
        'tmdb',
        `Actor "${actorName}" not matched in movie credits`
      );
    } catch (error) {
      this.log('warn', `TMDB credits fetch failed for movie ${movieId}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.createUnverifiedResult(
        'cast',
        actorName,
        'tmdb',
        `TMDB credits fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Validate a person (director/actor) via general search
   */
  private async validatePerson(
    name: string,
    expectedDepartment?: string
  ): Promise<ValidatorResult> {
    try {
      const results = await this.tmdb.searchPerson(name, this.config.maxSearchResults);

      if (!results.length) {
        return this.createUnverifiedResult(
          'director',
          name,
          'tmdb',
          `Person "${name}" not found in TMDB`
        );
      }

      // Calculate similarity for each result
      const normalizedInput = normalizeString(name);
      const matches = results.map(person => ({
        person,
        similarity: combinedSimilarity(normalizedInput, normalizeString(person.name)),
        departmentMatch: expectedDepartment
          ? person.knownForDepartment === expectedDepartment
          : true,
      }));

      // Sort by similarity, with department match boost
      matches.sort((a, b) => {
        const scoreA = a.similarity + (a.departmentMatch ? 0.1 : 0);
        const scoreB = b.similarity + (b.departmentMatch ? 0.1 : 0);
        return scoreB - scoreA;
      });

      const best = matches[0];

      if (best.similarity >= this.config.partialThreshold) {
        const status = best.similarity >= this.config.matchThreshold ? 'match' : 'partial';

        return this.createResult('director', name, {
          validatedValue: best.person.name,
          confidence: best.similarity,
          status,
          source: 'tmdb',
          externalId: String(best.person.id),
          externalUrl: this.tmdb.getPersonUrl(best.person.id),
          message: `${status === 'match' ? 'Verified' : 'Possible match'}: ${best.person.name} (${best.person.knownForDepartment})`,
          alternatives: matches.slice(1, 4).map(m => ({
            value: `${m.person.name} (${m.person.knownForDepartment})`,
            confidence: m.similarity,
            externalId: String(m.person.id),
          })),
        });
      }

      return this.createUnverifiedResult(
        'director',
        name,
        'tmdb',
        `No confident match found for "${name}" in TMDB`
      );
    } catch (error) {
      this.log('warn', `TMDB person search failed for "${name}"`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.createUnverifiedResult(
        'director',
        name,
        'tmdb',
        `TMDB person search failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Check if TMDB API is available
   */
  async healthCheck(): Promise<boolean> {
    return await this.tmdb.healthCheck();
  }
}
