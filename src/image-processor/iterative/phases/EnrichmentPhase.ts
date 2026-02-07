/**
 * Enrichment Phase - External API Data Enrichment
 *
 * This phase enriches extracted poster data by querying external APIs:
 * - Film posters: TMDB for director, cast, year, rating
 * - Album posters: MusicBrainz/Discogs for release date, label
 * - Concert/festival: MusicBrainz for artist validation
 *
 * This phase runs AFTER the assembly phase and BEFORE storage to
 * fill in missing data that the vision model couldn't extract.
 */

import { PhaseManager } from '../PhaseManager.js';
import { ProcessingContext, PosterType, ArtistPhaseResult, ArtistMatch } from '../types.js';
import { PosterEntity } from '../../types.js';
import { TMDBClient } from '../../../qa-validation/clients/TMDBClient.js';
import { MusicBrainzClient } from '../../../qa-validation/clients/MusicBrainzClient.js';
import { DiscogsClient } from '../../../qa-validation/clients/DiscogsClient.js';
import { ValidationSource } from '../../../qa-validation/types.js';

// ============================================================================
// Types
// ============================================================================

export interface EnrichmentPhaseResult {
  phase: 'enrichment';
  status: 'completed' | 'partial' | 'failed' | 'skipped';
  confidence: number;
  processingTimeMs: number;

  /** Fields that were enriched */
  enrichedFields: string[];

  /** Original values before enrichment (for auditing) */
  originalValues: Record<string, unknown>;

  /** Enrichment sources used */
  sources: Array<{
    source: 'tmdb' | 'musicbrainz' | 'discogs';
    externalId: string;
    matchConfidence: number;
    fieldsEnriched: string[];
  }>;

  /** Errors encountered during enrichment */
  errors?: string[];

  /** Updated entity with enriched data */
  enrichedEntity: Partial<PosterEntity>;

  /** Artist results enhanced with film/music metadata */
  enhancedArtistResult?: ArtistPhaseResult;
}

export interface EnrichmentPhaseOptions {
  /** Enable TMDB lookups for film posters */
  enableTMDB?: boolean;
  /** Enable MusicBrainz lookups */
  enableMusicBrainz?: boolean;
  /** Enable Discogs lookups */
  enableDiscogs?: boolean;
  /** Minimum confidence to accept external match */
  minMatchConfidence?: number;
  /** Skip enrichment if entity already has this field */
  skipIfExists?: string[];
}

const DEFAULT_OPTIONS: Required<EnrichmentPhaseOptions> = {
  enableTMDB: true,
  enableMusicBrainz: true,
  enableDiscogs: true,
  minMatchConfidence: 0.7,
  skipIfExists: [],
};

// ============================================================================
// Enrichment Phase Implementation
// ============================================================================

export class EnrichmentPhase {
  private phaseManager: PhaseManager;
  private tmdbClient?: TMDBClient;
  private musicBrainzClient: MusicBrainzClient;
  private discogsClient?: DiscogsClient;

  constructor(
    phaseManager: PhaseManager,
    tmdbApiKey?: string,
    discogsToken?: string
  ) {
    this.phaseManager = phaseManager;
    this.musicBrainzClient = new MusicBrainzClient();

    if (tmdbApiKey) {
      this.tmdbClient = new TMDBClient(tmdbApiKey);
    }

    if (discogsToken) {
      this.discogsClient = new DiscogsClient(discogsToken);
    }
  }

  /**
   * Execute the enrichment phase
   */
  async execute(
    entity: Partial<PosterEntity>,
    artistResult: ArtistPhaseResult,
    context: ProcessingContext,
    options: EnrichmentPhaseOptions = {}
  ): Promise<EnrichmentPhaseResult> {
    const startTime = Date.now();
    const mergedOptions = { ...DEFAULT_OPTIONS, ...options };

    const result: EnrichmentPhaseResult = {
      phase: 'enrichment',
      status: 'completed',
      confidence: 1.0,
      processingTimeMs: 0,
      enrichedFields: [],
      originalValues: {},
      sources: [],
      enrichedEntity: { ...entity },
      enhancedArtistResult: { ...artistResult },
    };

    try {
      const posterType = entity.poster_type;

      if (!posterType) {
        result.status = 'skipped';
        result.processingTimeMs = Date.now() - startTime;
        return result;
      }

      // Route to type-specific enrichment
      switch (posterType) {
        case 'film':
          await this.enrichFilmData(result, mergedOptions);
          break;

        case 'album':
        case 'hybrid':
          await this.enrichAlbumData(result, artistResult, mergedOptions);
          break;

        case 'concert':
        case 'festival':
        case 'comedy':
        case 'theater':
          await this.enrichEventData(result, artistResult, mergedOptions);
          break;

        default:
          // For other types, try basic artist enrichment
          await this.enrichBasicArtistData(result, artistResult, mergedOptions);
      }

      // Calculate final status
      if (result.enrichedFields.length === 0) {
        result.status = result.errors && result.errors.length > 0 ? 'failed' : 'skipped';
      } else if (result.errors && result.errors.length > 0) {
        result.status = 'partial';
      }

      result.processingTimeMs = Date.now() - startTime;
      // Note: EnrichmentPhaseResult is not stored in phaseManager as it has a different structure

      return result;
    } catch (error) {
      result.status = 'failed';
      result.errors = [error instanceof Error ? error.message : String(error)];
      result.processingTimeMs = Date.now() - startTime;
      return result;
    }
  }

  /**
   * Enrich film poster data using TMDB
   */
  private async enrichFilmData(
    result: EnrichmentPhaseResult,
    options: Required<EnrichmentPhaseOptions>
  ): Promise<void> {
    if (!options.enableTMDB || !this.tmdbClient) {
      result.errors = result.errors || [];
      result.errors.push('TMDB not configured - set TMDB_API_KEY environment variable');
      return;
    }

    const entity = result.enrichedEntity;
    const title = entity.title || entity.headliner;

    if (!title) {
      result.errors = result.errors || [];
      result.errors.push('No film title available for TMDB lookup');
      return;
    }

    try {
      console.log(`[ENRICHMENT] Looking up film "${title}" in TMDB...`);

      // Search for the movie
      const searchResults = await this.tmdbClient.searchMovie(title, entity.year);

      if (!searchResults || searchResults.length === 0) {
        result.errors = result.errors || [];
        result.errors.push(`No TMDB matches found for "${title}"`);
        return;
      }

      // Take the best match
      const movie = searchResults[0];
      const matchConfidence = this.calculateTitleMatchConfidence(title, movie.title);

      if (matchConfidence < options.minMatchConfidence) {
        result.errors = result.errors || [];
        result.errors.push(`TMDB match confidence too low: ${matchConfidence.toFixed(2)} for "${movie.title}"`);
        return;
      }

      console.log(`[ENRICHMENT] Found TMDB match: "${movie.title}" (${movie.id}) with confidence ${matchConfidence.toFixed(2)}`);

      // Get full movie details and credits
      const [details, credits] = await Promise.all([
        this.tmdbClient.getMovie(movie.id),
        this.tmdbClient.getMovieCredits(movie.id),
      ]);

      if (!details || !credits) {
        result.errors = result.errors || [];
        result.errors.push('Failed to get movie details or credits from TMDB');
        return;
      }

      // Extract and store the data
      const fieldsEnriched: string[] = [];

      // Year
      if (!entity.year && details.release_date) {
        result.originalValues['year'] = entity.year;
        entity.year = parseInt(details.release_date.substring(0, 4), 10);
        fieldsEnriched.push('year');
      }

      // Note: MPAA Rating would need to be fetched from TMDB's release_dates endpoint
      // For now we add vote_average to observations if useful
      if (details.vote_average) {
        if (!entity.observations) entity.observations = [];
        entity.observations.push(`TMDB Rating: ${details.vote_average.toFixed(1)}/10`);
      }

      // Director from credits
      if (credits.crew) {
        const director = credits.crew.find(c => c.job === 'Director');
        if (director) {
          if (!result.enhancedArtistResult!.director) {
            result.enhancedArtistResult!.director = {
              extractedName: director.name,
              validatedName: director.name,
              confidence: matchConfidence,
              externalId: `tmdb:${director.id}`,
              source: 'tmdb' as ValidationSource,
            };
            fieldsEnriched.push('director');
          }
        }
      }

      // Cast from credits
      if (credits.cast && credits.cast.length > 0) {
        // Get top 5 billed actors
        const topCast = credits.cast.slice(0, 5);

        if (!result.enhancedArtistResult!.cast || result.enhancedArtistResult!.cast.length === 0) {
          result.enhancedArtistResult!.cast = topCast.map(actor => ({
            extractedName: actor.name,
            validatedName: actor.name,
            confidence: matchConfidence,
            externalId: `tmdb:${actor.id}`,
            source: 'tmdb' as ValidationSource,
          }));
          fieldsEnriched.push('cast');
        }
      }

      // Update entity headliner to be the film title (not an actor)
      if (entity.headliner && entity.headliner !== movie.title) {
        // If headliner was extracted as an actor name, move it to notes
        const observation = `Originally extracted headliner "${entity.headliner}" (likely an actor)`;
        if (!entity.observations) entity.observations = [];
        entity.observations.push(observation);
        entity.headliner = undefined; // Films don't have headliners
        fieldsEnriched.push('headliner_corrected');
      }

      // Store source info
      if (fieldsEnriched.length > 0) {
        result.enrichedFields.push(...fieldsEnriched);
        result.sources.push({
          source: 'tmdb',
          externalId: `tmdb:${movie.id}`,
          matchConfidence,
          fieldsEnriched,
        });

        // Add TMDB metadata to entity
        if (!entity.observations) entity.observations = [];
        entity.observations.push(`TMDB ID: ${movie.id}`);
        entity.observations.push(`TMDB Title: ${movie.title}`);
        if (details.tagline) {
          entity.observations.push(`Tagline: ${details.tagline}`);
        }
      }
    } catch (error) {
      result.errors = result.errors || [];
      result.errors.push(`TMDB lookup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Enrich album poster data using MusicBrainz/Discogs
   */
  private async enrichAlbumData(
    result: EnrichmentPhaseResult,
    artistResult: ArtistPhaseResult,
    options: Required<EnrichmentPhaseOptions>
  ): Promise<void> {
    const entity = result.enrichedEntity;
    const artistName = artistResult.headliner?.extractedName || entity.headliner;
    const albumTitle = entity.title;

    if (!artistName) {
      result.errors = result.errors || [];
      result.errors.push('No artist name available for album lookup');
      return;
    }

    // Try MusicBrainz first
    if (options.enableMusicBrainz) {
      try {
        await this.enrichFromMusicBrainz(result, artistName, albumTitle, options);
      } catch (error) {
        result.errors = result.errors || [];
        result.errors.push(`MusicBrainz lookup failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Fallback to Discogs if MusicBrainz didn't find enough data
    if (options.enableDiscogs && this.discogsClient && result.enrichedFields.length < 2) {
      try {
        await this.enrichFromDiscogs(result, artistName, albumTitle, options);
      } catch (error) {
        result.errors = result.errors || [];
        result.errors.push(`Discogs lookup failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  /**
   * Enrich from MusicBrainz
   */
  private async enrichFromMusicBrainz(
    result: EnrichmentPhaseResult,
    artistName: string,
    albumTitle: string | undefined,
    options: Required<EnrichmentPhaseOptions>
  ): Promise<void> {
    const entity = result.enrichedEntity;

    console.log(`[ENRICHMENT] Looking up artist "${artistName}" in MusicBrainz...`);

    // First, find the artist
    const artists = await this.musicBrainzClient.searchArtist(artistName);

    if (!artists || artists.length === 0) {
      return;
    }

    const artist = artists[0];
    const artistConfidence = this.calculateTitleMatchConfidence(artistName, artist.name);

    if (artistConfidence < options.minMatchConfidence) {
      return;
    }

    console.log(`[ENRICHMENT] Found MusicBrainz artist: "${artist.name}" (${artist.id})`);

    const fieldsEnriched: string[] = [];

    // Validate/enrich the headliner name
    if (result.enhancedArtistResult!.headliner) {
      result.enhancedArtistResult!.headliner.validatedName = artist.name;
      result.enhancedArtistResult!.headliner.externalId = `mbid:${artist.id}`;
      fieldsEnriched.push('headliner_validated');
    }

    // If we have an album title, search for the release
    if (albumTitle) {
      console.log(`[ENRICHMENT] Looking up release "${albumTitle}" by "${artist.name}"...`);

      const releases = await this.musicBrainzClient.searchRelease(albumTitle, artist.name);

      if (releases && releases.length > 0) {
        const release = releases[0];
        const releaseConfidence = this.calculateTitleMatchConfidence(albumTitle, release.title);

        if (releaseConfidence >= options.minMatchConfidence) {
          console.log(`[ENRICHMENT] Found MusicBrainz release: "${release.title}" (${release.id})`);

          // Extract release date
          if (!entity.event_date && release.date) {
            result.originalValues['event_date'] = entity.event_date;
            entity.event_date = this.formatMusicBrainzDate(release.date);
            fieldsEnriched.push('release_date');
          }

          // Extract year
          if (!entity.year && release.date) {
            result.originalValues['year'] = entity.year;
            entity.year = parseInt(release.date.substring(0, 4), 10);
            fieldsEnriched.push('year');
          }

          // Extract record label
          if (!entity.record_label && release.labelInfo && release.labelInfo.length > 0) {
            const labelInfo = release.labelInfo[0];
            if (labelInfo.label) {
              result.originalValues['record_label'] = entity.record_label;
              entity.record_label = labelInfo.label.name;
              result.enhancedArtistResult!.recordLabel = labelInfo.label.name;
              fieldsEnriched.push('record_label');
            }
          }

          // Add MusicBrainz metadata
          if (!entity.observations) entity.observations = [];
          entity.observations.push(`MusicBrainz Release ID: ${release.id}`);
          if (release.country) {
            entity.observations.push(`Release Country: ${release.country}`);
          }

          if (fieldsEnriched.length > 0) {
            result.sources.push({
              source: 'musicbrainz',
              externalId: `mbid:${release.id}`,
              matchConfidence: releaseConfidence,
              fieldsEnriched,
            });
          }
        }
      }
    }

    // Add artist-level source
    if (fieldsEnriched.length > 0 || artistConfidence >= options.minMatchConfidence) {
      result.enrichedFields.push(...fieldsEnriched);
      if (!result.sources.some(s => s.source === 'musicbrainz')) {
        result.sources.push({
          source: 'musicbrainz',
          externalId: `mbid:${artist.id}`,
          matchConfidence: artistConfidence,
          fieldsEnriched: ['headliner_validated'],
        });
      }
    }
  }

  /**
   * Enrich from Discogs
   */
  private async enrichFromDiscogs(
    result: EnrichmentPhaseResult,
    artistName: string,
    albumTitle: string | undefined,
    options: Required<EnrichmentPhaseOptions>
  ): Promise<void> {
    if (!this.discogsClient) return;

    const entity = result.enrichedEntity;

    console.log(`[ENRICHMENT] Looking up "${artistName}" in Discogs...`);

    // Search Discogs
    const query = albumTitle ? `${artistName} ${albumTitle}` : artistName;
    const releases = await this.discogsClient.searchRelease(query);

    if (!releases || releases.length === 0) {
      return;
    }

    const release = releases[0];
    const matchConfidence = albumTitle
      ? this.calculateTitleMatchConfidence(albumTitle, release.title)
      : this.calculateTitleMatchConfidence(artistName, release.title);

    if (matchConfidence < options.minMatchConfidence) {
      return;
    }

    console.log(`[ENRICHMENT] Found Discogs release: "${release.title}" (${release.id})`);

    const fieldsEnriched: string[] = [];

    // Extract year (Discogs returns year as string)
    if (!entity.year && release.year) {
      result.originalValues['year'] = entity.year;
      entity.year = parseInt(release.year, 10);
      fieldsEnriched.push('year');
    }

    // Extract record label
    if (!entity.record_label && release.label && release.label.length > 0) {
      result.originalValues['record_label'] = entity.record_label;
      entity.record_label = release.label[0];
      result.enhancedArtistResult!.recordLabel = release.label[0];
      fieldsEnriched.push('record_label');
    }

    // Add Discogs metadata
    if (!entity.observations) entity.observations = [];
    entity.observations.push(`Discogs ID: ${release.id}`);
    if (release.genre && release.genre.length > 0) {
      entity.observations.push(`Genre: ${release.genre.join(', ')}`);
    }
    if (release.style && release.style.length > 0) {
      entity.observations.push(`Style: ${release.style.join(', ')}`);
    }

    if (fieldsEnriched.length > 0) {
      result.enrichedFields.push(...fieldsEnriched);
      result.sources.push({
        source: 'discogs',
        externalId: `discogs:${release.id}`,
        matchConfidence,
        fieldsEnriched,
      });
    }
  }

  /**
   * Enrich event data (concert, festival, etc.)
   */
  private async enrichEventData(
    result: EnrichmentPhaseResult,
    artistResult: ArtistPhaseResult,
    options: Required<EnrichmentPhaseOptions>
  ): Promise<void> {
    // For events, we mainly validate the artist through MusicBrainz
    if (!options.enableMusicBrainz) return;

    const artistName = artistResult.headliner?.extractedName;
    if (!artistName) return;

    try {
      console.log(`[ENRICHMENT] Validating event artist "${artistName}" in MusicBrainz...`);

      const artists = await this.musicBrainzClient.searchArtist(artistName);

      if (!artists || artists.length === 0) {
        return;
      }

      const artist = artists[0];
      const matchConfidence = this.calculateTitleMatchConfidence(artistName, artist.name);

      if (matchConfidence >= options.minMatchConfidence) {
        console.log(`[ENRICHMENT] Validated artist: "${artist.name}" (${artist.id})`);

        // Update the headliner with validated name
        if (result.enhancedArtistResult!.headliner) {
          result.enhancedArtistResult!.headliner.validatedName = artist.name;
          result.enhancedArtistResult!.headliner.externalId = `mbid:${artist.id}`;
          result.enhancedArtistResult!.headliner.confidence = matchConfidence;
        }

        result.enrichedFields.push('headliner_validated');
        result.sources.push({
          source: 'musicbrainz',
          externalId: `mbid:${artist.id}`,
          matchConfidence,
          fieldsEnriched: ['headliner_validated'],
        });

        // Add to entity observations
        if (!result.enrichedEntity.observations) result.enrichedEntity.observations = [];
        result.enrichedEntity.observations.push(`MusicBrainz Artist ID: ${artist.id}`);
      }
    } catch (error) {
      result.errors = result.errors || [];
      result.errors.push(`Artist validation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Basic artist enrichment for other poster types
   */
  private async enrichBasicArtistData(
    result: EnrichmentPhaseResult,
    artistResult: ArtistPhaseResult,
    options: Required<EnrichmentPhaseOptions>
  ): Promise<void> {
    // Same as event enrichment - validate the artist
    await this.enrichEventData(result, artistResult, options);
  }

  /**
   * Calculate title match confidence using normalized string comparison
   */
  private calculateTitleMatchConfidence(extracted: string, external: string): number {
    const normalize = (s: string) =>
      s.toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .trim();

    const a = normalize(extracted);
    const b = normalize(external);

    if (a === b) return 1.0;

    // Check if one contains the other
    if (a.includes(b) || b.includes(a)) {
      return 0.9;
    }

    // Levenshtein distance-based similarity
    const distance = this.levenshteinDistance(a, b);
    const maxLen = Math.max(a.length, b.length);
    const similarity = 1 - distance / maxLen;

    return Math.max(0, similarity);
  }

  /**
   * Levenshtein distance calculation
   */
  private levenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[b.length][a.length];
  }

  /**
   * Format MusicBrainz date to DD/MM/YYYY
   */
  private formatMusicBrainzDate(date: string): string {
    // MusicBrainz dates are YYYY-MM-DD or YYYY-MM or YYYY
    const parts = date.split('-');

    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    } else if (parts.length === 2) {
      return `${parts[1]}/${parts[0]}`;
    } else {
      return parts[0];
    }
  }

  /**
   * Health check for external APIs
   */
  async healthCheck(): Promise<Record<string, boolean>> {
    const health: Record<string, boolean> = {};

    // MusicBrainz
    try {
      await this.musicBrainzClient.searchArtist('test');
      health.musicbrainz = true;
    } catch {
      health.musicbrainz = false;
    }

    // TMDB
    if (this.tmdbClient) {
      try {
        await this.tmdbClient.searchMovie('test');
        health.tmdb = true;
      } catch {
        health.tmdb = false;
      }
    } else {
      health.tmdb = false;
    }

    // Discogs
    if (this.discogsClient) {
      try {
        await this.discogsClient.searchArtist('test');
        health.discogs = true;
      } catch {
        health.discogs = false;
      }
    } else {
      health.discogs = false;
    }

    return health;
  }
}
