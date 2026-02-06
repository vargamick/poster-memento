/**
 * Venue Phase - Venue extraction and validation
 *
 * Third phase of iterative processing that extracts venue information
 * using type-specific prompts and validates against knowledge base.
 */

import { BasePhase, PhaseInput } from './BasePhase.js';
import {
  VenuePhaseResult,
  VenueMatch,
  PosterType,
} from '../types.js';
import { VENUE_PROMPTS } from '../prompts.js';
import { VisionModelProvider } from '../../types.js';
import { PhaseManager } from '../PhaseManager.js';
import { EntityService } from '../../../core/services/EntityService.js';
import { SearchService } from '../../../core/services/SearchService.js';

/**
 * Venue Phase - Extracts and validates venue information
 */
export class VenuePhase extends BasePhase<VenuePhaseResult> {
  readonly phaseName = 'venue' as const;
  private entityService?: EntityService;
  private searchService?: SearchService;

  constructor(
    visionProvider: VisionModelProvider,
    phaseManager: PhaseManager,
    entityService?: EntityService,
    searchService?: SearchService
  ) {
    super(visionProvider, phaseManager);
    this.entityService = entityService;
    this.searchService = searchService;
  }

  /**
   * Execute venue extraction phase
   */
  async execute(input: PhaseInput): Promise<VenuePhaseResult> {
    const startTime = Date.now();

    try {
      // Get poster type and artist context from previous phases
      const posterType = this.getPosterType(input.context);
      const artistContext = this.getArtistContext(input.context);

      this.log('info', `Starting venue extraction for ${input.posterId} (type: ${posterType})`);

      // Step 1: Get type-specific prompt
      const prompt = VENUE_PROMPTS[posterType] || VENUE_PROMPTS['unknown'];

      // Step 2: Extract venue information
      const extraction = await this.visionProvider.extractFromImage(
        input.imagePath,
        prompt
      );

      // Step 3: Parse the response
      const parsed = this.parseJsonResponse(extraction.extracted_text);

      // Step 4: Extract and normalize venue data
      const venueData = this.extractVenueData(parsed, posterType);

      // Step 5: Create venue match
      let venueMatch: VenueMatch | undefined;
      let theaterMatch: VenueMatch | undefined;

      if (venueData.venueName) {
        venueMatch = {
          extractedName: venueData.venueName,
          city: venueData.city,
          state: venueData.state,
          country: venueData.country,
          confidence: 0.5,
          source: 'internal',
        };

        // Step 6: Validate venue in knowledge base
        if (input.options.validateVenues && this.entityService) {
          const validatedMatch = await this.validateVenue(venueMatch, artistContext);
          if (validatedMatch) {
            venueMatch = validatedMatch;
          }
        }
      }

      // Handle film-specific theater extraction
      if (posterType === 'film' && venueData.theaterName) {
        theaterMatch = {
          extractedName: venueData.theaterName,
          city: venueData.city,
          state: venueData.state,
          confidence: 0.5,
          source: 'internal',
        };
      }

      // Step 7: Search for existing venues
      const existingVenueMatches = await this.findExistingVenues(
        venueData.venueName,
        venueData.city
      );

      // Update confidence if we found existing match
      if (existingVenueMatches.length > 0 && venueMatch) {
        const exactMatch = existingVenueMatches.find(
          m => m.name.toLowerCase() === venueMatch!.extractedName.toLowerCase()
        );
        if (exactMatch) {
          venueMatch.existingVenueId = exactMatch.entityId;
          venueMatch.confidence = Math.max(venueMatch.confidence, 0.8);
        }
      }

      // Step 8: Try to infer location from artist tour data
      if (!venueData.city && artistContext.headliner && this.searchService) {
        const inferredLocation = await this.inferLocationFromArtist(
          artistContext.headliner,
          venueData.venueName
        );
        if (inferredLocation && venueMatch) {
          venueMatch.city = inferredLocation.city;
          venueMatch.state = inferredLocation.state;
          this.log('info', `Inferred location: ${inferredLocation.city}, ${inferredLocation.state}`);
        }
      }

      // Step 9: Calculate confidence
      const confidence = this.calculateVenueConfidence(venueMatch, posterType);

      // Step 10: Determine readiness
      const readyForPhase4 = confidence >= (input.options.confidenceThreshold ?? 0.5) ||
        this.isVenueOptionalForType(posterType);

      const result: VenuePhaseResult = {
        posterId: input.posterId,
        imagePath: input.imagePath,
        phase: 'venue',
        status: readyForPhase4 ? 'completed' : 'needs_review',
        confidence,
        processingTimeMs: Date.now() - startTime,
        posterType,
        venue: venueMatch,
        theater: theaterMatch,
        existingVenueMatches: existingVenueMatches.length > 0 ? existingVenueMatches : undefined,
        readyForPhase4,
        warnings: this.generateWarnings(venueMatch, posterType),
      };

      // Store result
      this.phaseManager.storePhaseResult(input.context.sessionId, result);

      this.log('info', `Venue extraction complete: ${venueMatch?.extractedName ?? 'none'} (${Math.round(confidence * 100)}%)`);

      return result;
    } catch (error) {
      return this.handleError(input, error, startTime);
    }
  }

  /**
   * Get artist context from previous phase
   */
  private getArtistContext(context: import('../types.js').ProcessingContext): {
    headliner?: string;
  } {
    const artistResult = context.phaseResults.get('artist');
    if (artistResult && 'headliner' in artistResult) {
      const ar = artistResult as import('../types.js').ArtistPhaseResult;
      return {
        headliner: ar.headliner?.validatedName ?? ar.headliner?.extractedName,
      };
    }
    return {};
  }

  /**
   * Extract venue data from parsed response based on poster type
   */
  private extractVenueData(
    parsed: Record<string, unknown>,
    posterType: PosterType
  ): {
    venueName?: string;
    theaterName?: string;
    city?: string;
    state?: string;
    country?: string;
    address?: string;
  } {
    switch (posterType) {
      case 'film':
        return {
          theaterName: this.normalizeString(parsed.theater_name),
          venueName: this.normalizeString(parsed.theater_name),
          city: this.normalizeString(parsed.city),
        };

      case 'album':
        // Album posters typically don't have venues unless it's a release show
        return {
          venueName: this.normalizeString(parsed.venue_name),
          city: this.normalizeString(parsed.city),
        };

      case 'exhibition':
        return {
          venueName: this.normalizeString(parsed.venue_name),
          city: this.normalizeString(parsed.city),
          address: this.normalizeString(parsed.address),
        };

      default:
        return {
          venueName: this.normalizeString(parsed.venue_name),
          city: this.normalizeString(parsed.city),
          state: this.normalizeString(parsed.state),
          country: this.normalizeString(parsed.country),
          address: this.normalizeString(parsed.address),
        };
    }
  }

  /**
   * Validate venue against knowledge base
   */
  private async validateVenue(
    venue: VenueMatch,
    artistContext: { headliner?: string }
  ): Promise<VenueMatch | null> {
    if (!this.entityService) return null;

    try {
      // Search for venue by name
      const searchQuery = venue.city
        ? `${venue.extractedName} ${venue.city}`
        : venue.extractedName;

      const result = await this.entityService.searchEntities(searchQuery, {
        entityTypes: ['Venue'],
        limit: 5,
      });

      if (!result.success || !result.data || result.data.entities.length === 0) {
        return null;
      }

      // Find best matching venue
      for (const entity of result.data.entities) {
        const nameMatch = this.calculateVenueNameSimilarity(
          venue.extractedName,
          entity.name
        );

        if (nameMatch > 0.7) {
          // Extract location from entity observations if available
          let entityCity: string | undefined;
          let entityState: string | undefined;

          if ('observations' in entity && Array.isArray(entity.observations)) {
            for (const obs of entity.observations) {
              const cityMatch = obs.match(/city:\s*(.+)/i);
              if (cityMatch) entityCity = cityMatch[1].trim();
              const stateMatch = obs.match(/state:\s*(.+)/i);
              if (stateMatch) entityState = stateMatch[1].trim();
            }
          }

          return {
            extractedName: venue.extractedName,
            validatedName: entity.name,
            existingVenueId: entity.name,
            city: venue.city || entityCity,
            state: venue.state || entityState,
            confidence: nameMatch,
            source: 'internal',
          };
        }
      }

      return null;
    } catch (error) {
      this.log('warn', 'Venue validation failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Calculate similarity between venue names
   */
  private calculateVenueNameSimilarity(name1: string, name2: string): number {
    const n1 = name1.toLowerCase().replace(/[^a-z0-9]/g, '');
    const n2 = name2.toLowerCase().replace(/[^a-z0-9]/g, '');

    if (n1 === n2) return 1.0;
    if (n1.includes(n2) || n2.includes(n1)) return 0.9;

    // Simple Jaccard similarity on words
    const words1 = new Set(name1.toLowerCase().split(/\s+/));
    const words2 = new Set(name2.toLowerCase().split(/\s+/));

    const intersection = new Set([...words1].filter(w => words2.has(w)));
    const union = new Set([...words1, ...words2]);

    return intersection.size / union.size;
  }

  /**
   * Find existing venues in knowledge base
   */
  private async findExistingVenues(
    venueName?: string,
    city?: string
  ): Promise<Array<{ name: string; entityId: string; city?: string }>> {
    if (!this.entityService || !venueName) return [];

    try {
      const searchQuery = city ? `${venueName} ${city}` : venueName;

      const result = await this.entityService.searchEntities(searchQuery, {
        entityTypes: ['Venue'],
        limit: 5,
      });

      if (!result.success || !result.data) return [];

      return result.data.entities.map(entity => ({
        name: venueName,
        entityId: entity.name,
        city,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Try to infer location from artist's tour data
   */
  private async inferLocationFromArtist(
    artistName: string,
    venueName?: string
  ): Promise<{ city?: string; state?: string } | null> {
    if (!this.searchService || !venueName) return null;

    try {
      // Search for posters with this artist and venue - returns ScoredEntity[] directly
      const results = await this.searchService.search(
        `${artistName} ${venueName}`,
        {
          entityTypes: ['Poster'],
          limit: 10,
        }
      );

      if (!results || results.length === 0) return null;

      // Look for location in similar posters
      for (const scoredEntity of results) {
        // ScoredEntity extends Entity, so observations are directly on scoredEntity
        if ('observations' in scoredEntity && Array.isArray(scoredEntity.observations)) {
          for (const obs of scoredEntity.observations) {
            const cityMatch = obs.match(/city:\s*(.+)/i);
            const stateMatch = obs.match(/state:\s*(.+)/i);

            if (cityMatch || stateMatch) {
              return {
                city: cityMatch?.[1].trim(),
                state: stateMatch?.[1].trim(),
              };
            }
          }
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Check if venue is optional for poster type
   */
  private isVenueOptionalForType(posterType: PosterType): boolean {
    return ['album', 'promo', 'film'].includes(posterType);
  }

  /**
   * Calculate confidence for venue extraction
   */
  private calculateVenueConfidence(
    venue?: VenueMatch,
    posterType?: PosterType
  ): number {
    // If venue is optional and not found, return moderate confidence
    if (!venue && posterType && this.isVenueOptionalForType(posterType)) {
      return 0.6;
    }

    if (!venue) return 0;

    let score = venue.confidence;

    // Bonus for having city
    if (venue.city) score += 0.1;

    // Bonus for existing match
    if (venue.existingVenueId) score += 0.15;

    // Bonus for validated name
    if (venue.validatedName) score += 0.1;

    return Math.min(score, 1.0);
  }

  /**
   * Generate warnings for venue extraction
   */
  private generateWarnings(
    venue?: VenueMatch,
    posterType?: PosterType
  ): string[] | undefined {
    const warnings: string[] = [];

    if (!venue && posterType && !this.isVenueOptionalForType(posterType)) {
      warnings.push('No venue information extracted');
    }

    if (venue && !venue.city) {
      warnings.push('City not identified for venue');
    }

    if (venue && venue.validatedName && venue.validatedName !== venue.extractedName) {
      warnings.push(`Venue may be "${venue.validatedName}" instead of "${venue.extractedName}"`);
    }

    return warnings.length > 0 ? warnings : undefined;
  }
}
