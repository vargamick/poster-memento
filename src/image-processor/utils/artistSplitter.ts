/**
 * Artist Splitter Utility
 *
 * Splits concatenated artist names and validates each against MusicBrainz/Discogs.
 * Handles cases where vision models return multiple artists as a single string
 * (e.g., "Artist1 Artist2 Artist3" from festival posters).
 */

import { MusicBrainzClient } from '../../qa-validation/clients/MusicBrainzClient.js';
import { DiscogsClient } from '../../qa-validation/clients/DiscogsClient.js';
import {
  extractPotentialNames,
  artistSimilarity,
  normalizeArtistName,
} from '../../qa-validation/utils/stringMatching.js';
import type { MusicBrainzArtist, ValidationSource } from '../../qa-validation/types.js';

// ============================================================================
// Types
// ============================================================================

export interface ValidatedArtist {
  /** Original extracted name */
  name: string;
  /** Canonical name from external source (if validated) */
  canonicalName?: string;
  /** External ID (MBID or Discogs ID) */
  externalId?: string;
  /** External URL */
  externalUrl?: string;
  /** Validation confidence (0-1) */
  confidence: number;
  /** Source of validation */
  source: ValidationSource;
}

export interface ArtistSplitResult {
  /** Original input text */
  originalText: string;
  /** Validated artists (split or single) */
  artists: ValidatedArtist[];
  /** Whether the input was detected as concatenated */
  wasConcatenated: boolean;
  /** Method used for splitting */
  splitMethod: 'none' | 'delimiter' | 'validation_guided';
  /** Processing notes for debugging */
  notes: string[];
}

export interface ArtistSplitterConfig {
  /** Minimum confidence to consider a match valid */
  matchThreshold?: number;
  /** Minimum confidence for partial match */
  partialThreshold?: number;
  /** Maximum length before assuming concatenation */
  maxSingleArtistLength?: number;
  /** Whether to use Discogs as fallback */
  useDiscogsFallback?: boolean;
  /** Enable verbose logging */
  verbose?: boolean;
}

const DEFAULT_CONFIG: Required<ArtistSplitterConfig> = {
  matchThreshold: 0.85,
  partialThreshold: 0.7,
  maxSingleArtistLength: 50,
  useDiscogsFallback: true,
  verbose: false,
};

// ============================================================================
// Artist Splitter Class
// ============================================================================

export class ArtistSplitter {
  private musicBrainz: MusicBrainzClient;
  private discogs: DiscogsClient | null;
  private config: Required<ArtistSplitterConfig>;

  constructor(
    musicBrainz: MusicBrainzClient,
    discogs?: DiscogsClient,
    config?: ArtistSplitterConfig
  ) {
    this.musicBrainz = musicBrainz;
    this.discogs = discogs ?? null;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Split and validate an artist string.
   * Returns validated individual artists if the input appears to be concatenated.
   */
  async splitAndValidate(artistString: string): Promise<ArtistSplitResult> {
    const notes: string[] = [];
    const trimmed = artistString?.trim();

    if (!trimmed) {
      return {
        originalText: artistString,
        artists: [],
        wasConcatenated: false,
        splitMethod: 'none',
        notes: ['Empty input'],
      };
    }

    // Step 1: Try validating as a single artist first
    if (this.config.verbose) notes.push('Attempting single artist validation...');
    const singleResult = await this.validateSingleArtist(trimmed);

    // If high confidence match, return as single artist
    if (singleResult && singleResult.confidence >= this.config.matchThreshold) {
      if (this.config.verbose) {
        notes.push(`High confidence match: ${singleResult.canonicalName} (${(singleResult.confidence * 100).toFixed(0)}%)`);
      }
      return {
        originalText: artistString,
        artists: [singleResult],
        wasConcatenated: false,
        splitMethod: 'none',
        notes,
      };
    }

    // Step 2: Check if this looks like concatenated artists
    const looksLikeConcatenated = this.looksLikeConcatenatedArtists(trimmed);

    if (!looksLikeConcatenated && singleResult && singleResult.confidence >= this.config.partialThreshold) {
      // Partial match and doesn't look concatenated - accept it
      if (this.config.verbose) {
        notes.push(`Partial match accepted: ${singleResult.canonicalName} (${(singleResult.confidence * 100).toFixed(0)}%)`);
      }
      return {
        originalText: artistString,
        artists: [singleResult],
        wasConcatenated: false,
        splitMethod: 'none',
        notes,
      };
    }

    // Step 3: Try splitting by delimiters
    if (this.config.verbose) notes.push('Attempting delimiter-based split...');
    const candidates = extractPotentialNames(trimmed);

    if (candidates.length <= 1) {
      // Couldn't split - return original (validated or not)
      if (singleResult) {
        notes.push('Could not split, using single result');
        return {
          originalText: artistString,
          artists: [singleResult],
          wasConcatenated: false,
          splitMethod: 'none',
          notes,
        };
      }

      // Create unvalidated entry
      notes.push('Could not validate or split');
      return {
        originalText: artistString,
        artists: [{
          name: trimmed,
          confidence: 0,
          source: 'internal',
        }],
        wasConcatenated: false,
        splitMethod: 'none',
        notes,
      };
    }

    // Step 4: Validate each candidate
    if (this.config.verbose) notes.push(`Found ${candidates.length} potential artists: ${candidates.join(', ')}`);

    const validatedArtists: ValidatedArtist[] = [];
    let validatedCount = 0;

    for (const candidate of candidates) {
      const result = await this.validateSingleArtist(candidate);

      if (result && result.confidence >= this.config.partialThreshold) {
        validatedArtists.push(result);
        validatedCount++;
        if (this.config.verbose) {
          notes.push(`Validated: "${candidate}" → ${result.canonicalName} (${(result.confidence * 100).toFixed(0)}%)`);
        }
      } else {
        // Include unvalidated but cleaned name
        validatedArtists.push({
          name: candidate,
          confidence: result?.confidence ?? 0,
          source: 'internal',
        });
        if (this.config.verbose) {
          notes.push(`Not validated: "${candidate}" (${result ? (result.confidence * 100).toFixed(0) + '%' : 'no match'})`);
        }
      }
    }

    // Step 5: Decide if split was successful
    // If more than half of candidates validated, consider it a successful split
    const splitSuccessful = validatedCount > candidates.length / 2;

    if (splitSuccessful && validatedArtists.length > 1) {
      notes.push(`Split successful: ${validatedCount}/${candidates.length} artists validated`);
      return {
        originalText: artistString,
        artists: validatedArtists,
        wasConcatenated: true,
        splitMethod: 'delimiter',
        notes,
      };
    }

    // Split didn't work well - return original
    if (singleResult) {
      notes.push('Split validation unsuccessful, using original');
      return {
        originalText: artistString,
        artists: [singleResult],
        wasConcatenated: false,
        splitMethod: 'none',
        notes,
      };
    }

    // Return unvalidated original
    notes.push('Could not validate original or split');
    return {
      originalText: artistString,
      artists: [{
        name: trimmed,
        confidence: 0,
        source: 'internal',
      }],
      wasConcatenated: false,
      splitMethod: 'none',
      notes,
    };
  }

  /**
   * Validate a single artist name against MusicBrainz and optionally Discogs
   */
  private async validateSingleArtist(name: string): Promise<ValidatedArtist | null> {
    const normalizedInput = normalizeArtistName(name);

    // Try MusicBrainz first
    try {
      const mbResult = await this.searchMusicBrainz(name, normalizedInput);
      if (mbResult) {
        return mbResult;
      }
    } catch (error) {
      // Log but continue to Discogs
      if (this.config.verbose) {
        console.log(`MusicBrainz search failed for "${name}":`, error);
      }
    }

    // Try Discogs as fallback
    if (this.discogs && this.config.useDiscogsFallback) {
      try {
        const dcResult = await this.searchDiscogs(name, normalizedInput);
        if (dcResult) {
          return dcResult;
        }
      } catch (error) {
        if (this.config.verbose) {
          console.log(`Discogs search failed for "${name}":`, error);
        }
      }
    }

    return null;
  }

  /**
   * Search MusicBrainz for an artist
   */
  private async searchMusicBrainz(
    artistName: string,
    normalizedInput: string
  ): Promise<ValidatedArtist | null> {
    // Try exact search first
    const exactResults = await this.musicBrainz.searchArtist(artistName, 5);

    const bestMatch = this.findBestMatch(normalizedInput, exactResults);

    if (bestMatch) {
      return {
        name: artistName,
        canonicalName: bestMatch.artist.name,
        externalId: bestMatch.artist.id,
        externalUrl: this.musicBrainz.getArtistUrl(bestMatch.artist.id),
        confidence: bestMatch.similarity,
        source: 'musicbrainz',
      };
    }

    // Try fuzzy search
    const fuzzyResults = await this.musicBrainz.searchArtistFuzzy(artistName, 10);
    const fuzzyMatch = this.findBestMatch(normalizedInput, fuzzyResults);

    if (fuzzyMatch && fuzzyMatch.similarity >= this.config.partialThreshold) {
      return {
        name: artistName,
        canonicalName: fuzzyMatch.artist.name,
        externalId: fuzzyMatch.artist.id,
        externalUrl: this.musicBrainz.getArtistUrl(fuzzyMatch.artist.id),
        confidence: fuzzyMatch.similarity,
        source: 'musicbrainz',
      };
    }

    return null;
  }

  /**
   * Search Discogs for an artist
   */
  private async searchDiscogs(
    artistName: string,
    normalizedInput: string
  ): Promise<ValidatedArtist | null> {
    if (!this.discogs) return null;

    const results = await this.discogs.searchArtist(artistName, 5);
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
      return {
        name: artistName,
        canonicalName: best.artist.title,
        externalId: String(best.artist.id),
        externalUrl: this.discogs.getArtistUrl(best.artist.id),
        confidence: best.similarity,
        source: 'discogs',
      };
    }

    return null;
  }

  /**
   * Find the best matching artist from MusicBrainz results
   */
  private findBestMatch(
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
   * Heuristic to detect if a string looks like concatenated artist names
   */
  private looksLikeConcatenatedArtists(text: string): boolean {
    // Too long for a single artist name
    if (text.length > this.config.maxSingleArtistLength) {
      return true;
    }

    // Contains multiple capital letters that look like separate names
    // e.g., "Black Eyed Peas Fergie Will.i" has capital letters throughout
    const capitalWordCount = (text.match(/\b[A-Z][a-z]+\b/g) || []).length;
    if (capitalWordCount >= 4) {
      return true;
    }

    // Contains delimiters that suggest multiple artists
    if (/[,&|•·]/.test(text)) {
      return true;
    }

    // Contains words like "and", "with", "featuring"
    if (/\b(and|with|featuring|feat\.?|ft\.?)\b/i.test(text)) {
      return true;
    }

    return false;
  }
}

// ============================================================================
// Convenience Function
// ============================================================================

/**
 * Split and validate an array of artist strings.
 * Flattens results into a single array of validated artists.
 */
export async function splitAndValidateArtists(
  artistStrings: string[],
  splitter: ArtistSplitter
): Promise<{
  artists: ValidatedArtist[];
  anyConcatenated: boolean;
  notes: string[];
}> {
  const allArtists: ValidatedArtist[] = [];
  const allNotes: string[] = [];
  let anyConcatenated = false;

  for (const artistString of artistStrings) {
    const result = await splitter.splitAndValidate(artistString);
    allArtists.push(...result.artists);
    allNotes.push(...result.notes);
    if (result.wasConcatenated) {
      anyConcatenated = true;
    }
  }

  // Deduplicate by canonical name or name
  const seen = new Set<string>();
  const uniqueArtists = allArtists.filter(artist => {
    const key = normalizeArtistName(artist.canonicalName ?? artist.name);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    artists: uniqueArtists,
    anyConcatenated,
    notes: allNotes,
  };
}
