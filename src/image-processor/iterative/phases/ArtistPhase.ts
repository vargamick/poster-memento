/**
 * Artist Phase - Artist extraction and validation
 *
 * Second phase of iterative processing that extracts artist information
 * using type-specific prompts and validates against external databases.
 */

import { BasePhase, PhaseInput } from './BasePhase.js';
import {
  ArtistPhaseResult,
  ArtistMatch,
  PosterType,
} from '../types.js';
import { ARTIST_PROMPTS } from '../prompts.js';
import { VisionModelProvider } from '../../types.js';
import { PhaseManager } from '../PhaseManager.js';
import { EntityService } from '../../../core/services/EntityService.js';
import { ArtistValidator } from '../../../qa-validation/validators/ArtistValidator.js';
import { ValidatorResult, ValidationContext } from '../../../qa-validation/types.js';

/**
 * Artist Phase - Extracts and validates artist information
 */
export class ArtistPhase extends BasePhase<ArtistPhaseResult> {
  readonly phaseName = 'artist' as const;
  private entityService?: EntityService;
  private artistValidator?: ArtistValidator;

  constructor(
    visionProvider: VisionModelProvider,
    phaseManager: PhaseManager,
    entityService?: EntityService,
    artistValidator?: ArtistValidator
  ) {
    super(visionProvider, phaseManager);
    this.entityService = entityService;
    this.artistValidator = artistValidator;
  }

  /**
   * Execute artist extraction phase
   */
  async execute(input: PhaseInput): Promise<ArtistPhaseResult> {
    const startTime = Date.now();

    try {
      // Get poster type from previous phase
      const posterType = this.getPosterType(input.context);

      this.log('info', `Starting artist extraction for ${input.posterId} (type: ${posterType})`);

      // Step 1: Get type-specific prompt
      const prompt = ARTIST_PROMPTS[posterType] || ARTIST_PROMPTS['unknown'];

      // Step 2: Extract artist information
      const extraction = await this.visionProvider.extractFromImage(
        input.imagePath,
        prompt
      );

      // Step 3: Parse the response
      const parsed = this.parseJsonResponse(extraction.extracted_text);

      // Step 4: Extract and normalize artist data based on type
      const artistData = this.extractArtistData(parsed, posterType);

      // Step 5: Validate artists against external sources
      let headlinerMatch: ArtistMatch | undefined;
      let supportingMatches: ArtistMatch[] = [];

      if (input.options.validateArtists && this.artistValidator) {
        if (artistData.headliner) {
          headlinerMatch = await this.validateArtist(artistData.headliner, 'headliner');
        }

        if (artistData.supportingActs && artistData.supportingActs.length > 0) {
          supportingMatches = await Promise.all(
            artistData.supportingActs.map(act => this.validateArtist(act, 'supporting_acts'))
          );
        }
      } else {
        // Create unvalidated matches
        if (artistData.headliner) {
          headlinerMatch = {
            extractedName: artistData.headliner,
            confidence: 0.5,
            source: 'internal',
          };
        }

        if (artistData.supportingActs) {
          supportingMatches = artistData.supportingActs.map(act => ({
            extractedName: act,
            confidence: 0.5,
            source: 'internal',
          }));
        }
      }

      // Step 6: Search for existing artists in knowledge base
      const existingArtistMatches = await this.findExistingArtists(
        artistData.headliner,
        artistData.supportingActs
      );

      // Step 7: Handle film-specific extraction
      let director: ArtistMatch | undefined;
      let cast: ArtistMatch[] = [];

      if (posterType === 'film') {
        if (artistData.director) {
          director = input.options.validateArtists && this.artistValidator
            ? await this.validateArtist(artistData.director, 'director')
            : { extractedName: artistData.director, confidence: 0.5, source: 'internal' };
        }

        if (artistData.cast && artistData.cast.length > 0) {
          cast = await Promise.all(
            artistData.cast.map(actor =>
              input.options.validateArtists && this.artistValidator
                ? this.validateArtist(actor, 'cast')
                : Promise.resolve({ extractedName: actor, confidence: 0.5, source: 'internal' } as ArtistMatch)
            )
          );
        }
      }

      // Step 8: Calculate confidence
      const confidence = this.calculateArtistConfidence(
        headlinerMatch,
        supportingMatches,
        posterType
      );

      // Step 9: Determine readiness for next phase
      const readyForPhase3 = confidence >= (input.options.confidenceThreshold ?? 0.5);

      const result: ArtistPhaseResult = {
        posterId: input.posterId,
        imagePath: input.imagePath,
        phase: 'artist',
        status: readyForPhase3 ? 'completed' : 'needs_review',
        confidence,
        processingTimeMs: Date.now() - startTime,
        posterType,
        headliner: headlinerMatch,
        supportingActs: supportingMatches.length > 0 ? supportingMatches : undefined,
        tourName: this.normalizeString(artistData.tourName),
        recordLabel: this.normalizeString(artistData.recordLabel),
        director: posterType === 'film' ? director : undefined,
        cast: posterType === 'film' && cast.length > 0 ? cast : undefined,
        existingArtistMatches,
        readyForPhase3,
        warnings: this.generateWarnings(headlinerMatch, supportingMatches),
      };

      // Store result
      this.phaseManager.storePhaseResult(input.context.sessionId, result);

      this.log('info', `Artist extraction complete: ${headlinerMatch?.extractedName ?? 'none'} (${Math.round(confidence * 100)}%)`);

      return result;
    } catch (error) {
      return this.handleError(input, error, startTime);
    }
  }

  /**
   * Extract artist data from parsed response based on poster type
   */
  private extractArtistData(
    parsed: Record<string, unknown>,
    posterType: PosterType
  ): {
    headliner?: string;
    supportingActs?: string[];
    tourName?: string;
    recordLabel?: string;
    director?: string;
    cast?: string[];
  } {
    switch (posterType) {
      case 'film':
        return {
          director: this.normalizeString(parsed.director),
          cast: [
            ...this.normalizeStringArray(parsed.lead_actors),
            ...this.normalizeStringArray(parsed.supporting_cast),
          ],
          headliner: this.normalizeString(parsed.director), // Use director as "headliner" equivalent
        };

      case 'theater':
        return {
          headliner: this.normalizeString(parsed.playwright) ||
            this.normalizeStringArray(parsed.lead_performers)[0],
          supportingActs: this.normalizeStringArray(parsed.lead_performers).slice(1),
          director: this.normalizeString(parsed.director),
        };

      case 'exhibition':
        return {
          headliner: this.normalizeString(parsed.exhibiting_artist),
        };

      case 'album':
        return {
          headliner: this.normalizeString(parsed.headliner),
          supportingActs: this.normalizeStringArray(parsed.featured_artists),
          recordLabel: this.normalizeString(parsed.record_label),
        };

      case 'unknown':
        return {
          headliner: this.normalizeString(parsed.primary_name),
          supportingActs: this.normalizeStringArray(parsed.other_names),
        };

      default:
        // Concert, festival, comedy, promo, hybrid
        return {
          headliner: this.normalizeString(parsed.headliner),
          supportingActs: this.normalizeStringArray(parsed.supporting_acts),
          tourName: this.normalizeString(parsed.tour_name),
          recordLabel: this.normalizeString(parsed.record_label),
        };
    }
  }

  /**
   * Validate an artist against external sources
   */
  private async validateArtist(
    artistName: string,
    field: string
  ): Promise<ArtistMatch> {
    if (!this.artistValidator) {
      return {
        extractedName: artistName,
        confidence: 0.5,
        source: 'internal',
      };
    }

    try {
      // Create a mock entity for validation
      const mockEntity = {
        name: `temp_${Date.now()}`,
        entityType: 'Poster' as const,
        headliner: field === 'headliner' ? artistName : undefined,
        supporting_acts: field === 'supporting_acts' ? [artistName] : undefined,
        observations: [],
        metadata: {
          source_image_url: '',
          source_image_hash: '',
          original_filename: '',
          file_size_bytes: 0,
          vision_model: '',
          processing_time_ms: 0,
          processing_date: new Date().toISOString(),
        },
      };

      const context: ValidationContext = {
        config: {},
      };

      const results = await this.artistValidator.validate(mockEntity, context);

      // Find the result for this artist
      const result = results.find(r =>
        r.originalValue?.toLowerCase() === artistName.toLowerCase()
      );

      if (result && result.status !== 'unverified') {
        return {
          extractedName: artistName,
          validatedName: result.validatedValue,
          externalId: result.externalId,
          externalUrl: result.externalUrl,
          confidence: result.confidence,
          source: result.source,
          alternatives: result.alternatives?.map(alt => ({
            name: alt.value,
            confidence: alt.confidence,
            externalId: alt.externalId,
          })),
        };
      }

      return {
        extractedName: artistName,
        confidence: 0.3,
        source: 'internal',
      };
    } catch (error) {
      this.log('warn', `Artist validation failed for ${artistName}`, {
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        extractedName: artistName,
        confidence: 0.3,
        source: 'internal',
      };
    }
  }

  /**
   * Find existing artists in knowledge base
   */
  private async findExistingArtists(
    headliner?: string,
    supportingActs?: string[]
  ): Promise<Array<{ name: string; entityId: string }>> {
    if (!this.entityService) return [];

    const matches: Array<{ name: string; entityId: string }> = [];
    const artistsToSearch = [
      headliner,
      ...(supportingActs || []),
    ].filter((a): a is string => !!a);

    for (const artist of artistsToSearch) {
      try {
        const result = await this.entityService.searchEntities(artist, {
          entityTypes: ['Artist'],
          limit: 3,
        });

        if (result.success && result.data && result.data.entities.length > 0) {
          // Find best match
          for (const entity of result.data.entities) {
            if (entity.name.toLowerCase().includes(artist.toLowerCase()) ||
                artist.toLowerCase().includes(entity.name.toLowerCase())) {
              matches.push({
                name: artist,
                entityId: entity.name,
              });
              break;
            }
          }
        }
      } catch {
        // Ignore search errors
      }
    }

    return matches;
  }

  /**
   * Calculate confidence for artist extraction
   */
  private calculateArtistConfidence(
    headliner?: ArtistMatch,
    supportingActs?: ArtistMatch[],
    posterType?: PosterType
  ): number {
    const weights = {
      headliner: 0.6,
      supporting: 0.3,
      validation: 0.1,
    };

    let score = 0;

    // Headliner confidence
    if (headliner) {
      score += weights.headliner * headliner.confidence;

      // Bonus for external validation
      if (headliner.externalId) {
        score += weights.validation;
      }
    } else {
      // Some poster types don't require headliner
      if (posterType === 'exhibition' || posterType === 'promo') {
        score += weights.headliner * 0.5;
      }
    }

    // Supporting acts confidence
    if (supportingActs && supportingActs.length > 0) {
      const avgSupporting = supportingActs.reduce((sum, a) => sum + a.confidence, 0) /
        supportingActs.length;
      score += weights.supporting * avgSupporting;
    } else {
      // Not all posters have supporting acts
      score += weights.supporting * 0.5;
    }

    return Math.min(score, 1.0);
  }

  /**
   * Generate warnings for low confidence or unvalidated artists
   */
  private generateWarnings(
    headliner?: ArtistMatch,
    supportingActs?: ArtistMatch[]
  ): string[] | undefined {
    const warnings: string[] = [];

    if (headliner && !headliner.externalId) {
      warnings.push(`Headliner "${headliner.extractedName}" not verified in external database`);
    }

    if (headliner && headliner.validatedName &&
        headliner.validatedName !== headliner.extractedName) {
      warnings.push(`Headliner spelling may be "${headliner.validatedName}" instead of "${headliner.extractedName}"`);
    }

    if (supportingActs) {
      for (const act of supportingActs) {
        if (act.validatedName && act.validatedName !== act.extractedName) {
          warnings.push(`"${act.extractedName}" may be "${act.validatedName}"`);
        }
      }
    }

    return warnings.length > 0 ? warnings : undefined;
  }
}
