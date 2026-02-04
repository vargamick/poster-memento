/**
 * Artist Validator
 *
 * Validates artist names extracted from posters against MusicBrainz and Discogs.
 */

import { PosterEntity } from '../../image-processor/types.js';
import { ValidatorResult, ValidationContext, MusicBrainzArtist } from '../types.js';
import { BaseValidator } from './BaseValidator.js';
import { MusicBrainzClient } from '../clients/MusicBrainzClient.js';
import { DiscogsClient } from '../clients/DiscogsClient.js';
import { artistSimilarity, normalizeArtistName } from '../utils/stringMatching.js';

/**
 * Configuration for ArtistValidator
 */
export interface ArtistValidatorConfig {
  /** Minimum similarity score to consider a match (0-1) */
  matchThreshold?: number;
  /** Minimum similarity score for partial match (0-1) */
  partialThreshold?: number;
  /** Maximum number of search results to consider */
  maxSearchResults?: number;
  /** Whether to use Discogs as fallback */
  useDiscogsFallback?: boolean;
}

const DEFAULT_CONFIG: Required<ArtistValidatorConfig> = {
  matchThreshold: 0.9,
  partialThreshold: 0.7,
  maxSearchResults: 5,
  useDiscogsFallback: true,
};

/**
 * Validates artist names against external music databases
 */
export class ArtistValidator extends BaseValidator {
  readonly name = 'artist' as const;
  readonly supportedEntityTypes = ['Poster', 'Artist'];
  readonly supportedFields = ['headliner', 'supporting_acts'];

  private musicBrainz: MusicBrainzClient;
  private discogs: DiscogsClient | null;
  private config: Required<ArtistValidatorConfig>;

  constructor(
    musicBrainz: MusicBrainzClient,
    discogs?: DiscogsClient,
    config?: ArtistValidatorConfig
  ) {
    super();
    this.musicBrainz = musicBrainz;
    this.discogs = discogs ?? null;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Validate artist fields in the entity
   */
  async validate(
    entity: PosterEntity,
    _context: ValidationContext
  ): Promise<ValidatorResult[]> {
    const results: ValidatorResult[] = [];

    // Validate headliner
    if (!this.isEmpty(entity.headliner)) {
      const headlinerResult = await this.validateArtistName(
        entity.headliner!,
        'headliner'
      );
      results.push(headlinerResult);
    }

    // Validate supporting acts
    const supportingActs = this.getArrayValue(entity.supporting_acts);
    for (const act of supportingActs) {
      const actResult = await this.validateArtistName(act, 'supporting_acts');
      results.push(actResult);
    }

    return results;
  }

  /**
   * Validate a single artist name against external sources
   */
  private async validateArtistName(
    artistName: string,
    field: string
  ): Promise<ValidatorResult> {
    const normalizedInput = normalizeArtistName(artistName);

    // Try MusicBrainz first
    try {
      const mbResult = await this.searchMusicBrainz(artistName, normalizedInput);
      if (mbResult) {
        return mbResult;
      }
    } catch (error) {
      this.log('warn', `MusicBrainz search failed for "${artistName}"`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Try Discogs as fallback
    if (this.discogs && this.config.useDiscogsFallback) {
      try {
        const dcResult = await this.searchDiscogs(artistName, normalizedInput, field);
        if (dcResult) {
          return dcResult;
        }
      } catch (error) {
        this.log('warn', `Discogs search failed for "${artistName}"`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Could not verify against any source
    return this.createUnverifiedResult(
      field,
      artistName,
      'musicbrainz',
      `Artist "${artistName}" not found in MusicBrainz${this.discogs ? ' or Discogs' : ''}`
    );
  }

  /**
   * Search MusicBrainz for artist
   */
  private async searchMusicBrainz(
    artistName: string,
    normalizedInput: string
  ): Promise<ValidatorResult | null> {
    // Try exact search first
    const exactResults = await this.musicBrainz.searchArtist(
      artistName,
      this.config.maxSearchResults
    );

    // Find best match
    const bestMatch = this.findBestArtistMatch(normalizedInput, exactResults);

    if (bestMatch) {
      return this.createArtistResult(
        artistName,
        bestMatch.artist,
        bestMatch.similarity,
        'musicbrainz'
      );
    }

    // Try fuzzy search if exact didn't work
    const fuzzyResults = await this.musicBrainz.searchArtistFuzzy(
      artistName,
      this.config.maxSearchResults * 2
    );

    const fuzzyMatch = this.findBestArtistMatch(normalizedInput, fuzzyResults);

    if (fuzzyMatch && fuzzyMatch.similarity >= this.config.partialThreshold) {
      return this.createArtistResult(
        artistName,
        fuzzyMatch.artist,
        fuzzyMatch.similarity,
        'musicbrainz'
      );
    }

    return null;
  }

  /**
   * Search Discogs for artist
   */
  private async searchDiscogs(
    artistName: string,
    normalizedInput: string,
    field: string
  ): Promise<ValidatorResult | null> {
    if (!this.discogs) return null;

    const results = await this.discogs.searchArtist(
      artistName,
      this.config.maxSearchResults
    );

    if (!results.length) return null;

    // Calculate similarity for each result
    const matches = results.map(artist => ({
      artist,
      similarity: artistSimilarity(normalizedInput, normalizeArtistName(artist.title)),
    }));

    // Sort by similarity
    matches.sort((a, b) => b.similarity - a.similarity);

    const best = matches[0];

    if (best.similarity >= this.config.partialThreshold) {
      const status = best.similarity >= this.config.matchThreshold ? 'match' : 'partial';

      return this.createResult(field, artistName, {
        validatedValue: best.artist.title,
        confidence: best.similarity,
        status,
        source: 'discogs',
        externalId: String(best.artist.id),
        externalUrl: this.discogs.getArtistUrl(best.artist.id),
        message: status === 'match'
          ? `Verified: "${best.artist.title}" found in Discogs`
          : `Possible match: "${best.artist.title}" in Discogs (${Math.round(best.similarity * 100)}% confidence)`,
        alternatives: matches.slice(1, 4).map(m => ({
          value: m.artist.title,
          confidence: m.similarity,
          externalId: String(m.artist.id),
        })),
      });
    }

    return null;
  }

  /**
   * Find the best matching artist from search results
   */
  private findBestArtistMatch(
    normalizedInput: string,
    artists: MusicBrainzArtist[]
  ): { artist: MusicBrainzArtist; similarity: number } | null {
    if (!artists.length) return null;

    let bestMatch: MusicBrainzArtist | null = null;
    let bestSimilarity = 0;

    for (const artist of artists) {
      const normalizedResult = normalizeArtistName(artist.name);
      const similarity = artistSimilarity(normalizedInput, normalizedResult);

      // Also check sort name
      const sortNameSimilarity = artistSimilarity(
        normalizedInput,
        normalizeArtistName(artist.sortName)
      );

      const finalSimilarity = Math.max(similarity, sortNameSimilarity);

      if (finalSimilarity > bestSimilarity) {
        bestSimilarity = finalSimilarity;
        bestMatch = artist;
      }
    }

    if (bestMatch && bestSimilarity >= this.config.partialThreshold) {
      return { artist: bestMatch, similarity: bestSimilarity };
    }

    return null;
  }

  /**
   * Create a result for an artist match
   */
  private createArtistResult(
    originalName: string,
    artist: MusicBrainzArtist,
    similarity: number,
    source: 'musicbrainz' | 'discogs'
  ): ValidatorResult {
    const field = 'headliner'; // Will be overwritten by caller if needed
    const status = similarity >= this.config.matchThreshold ? 'match' : 'partial';

    const url = source === 'musicbrainz'
      ? this.musicBrainz.getArtistUrl(artist.id)
      : this.discogs?.getArtistUrl(parseInt(artist.id)) ?? '';

    let message: string;
    if (status === 'match') {
      message = `Verified: "${artist.name}"`;
      if (artist.disambiguation) {
        message += ` (${artist.disambiguation})`;
      }
      if (artist.type) {
        message += ` [${artist.type}]`;
      }
    } else {
      message = `Possible match: "${artist.name}" (${Math.round(similarity * 100)}% confidence)`;
    }

    return this.createResult(field, originalName, {
      validatedValue: artist.name,
      confidence: similarity,
      status,
      source,
      externalId: artist.id,
      externalUrl: url,
      message,
    });
  }

  /**
   * Check if external APIs are available
   */
  async healthCheck(): Promise<boolean> {
    try {
      const mbHealth = await this.musicBrainz.healthCheck();
      if (!mbHealth) return false;

      if (this.discogs) {
        const dcHealth = await this.discogs.healthCheck();
        // Discogs is optional, so we don't fail if it's unavailable
        if (!dcHealth) {
          this.log('warn', 'Discogs API unavailable, continuing with MusicBrainz only');
        }
      }

      return true;
    } catch {
      return false;
    }
  }
}
