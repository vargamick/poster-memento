/**
 * Type Phase - Poster type classification
 *
 * First phase of iterative processing that classifies the poster type
 * and extracts visual cues to inform subsequent phases.
 */

import { BasePhase, PhaseInput } from './BasePhase.js';
import {
  TypePhaseResult,
  PosterType,
} from '../types.js';
import { TypeInference } from '../../types.js';
import { TYPE_CLASSIFICATION_PROMPT, getRefinementPrompt } from '../prompts.js';
import { VisionModelProvider } from '../../types.js';
import { PhaseManager } from '../PhaseManager.js';
import { SearchService } from '../../../core/services/SearchService.js';

/**
 * Valid poster types for validation
 */
const VALID_POSTER_TYPES: PosterType[] = [
  'concert', 'festival', 'comedy', 'theater', 'film',
  'album', 'promo', 'exhibition', 'hybrid', 'unknown'
];

/**
 * Type classification patterns based on visual and text cues
 */
const TYPE_PATTERNS: Record<PosterType, string[]> = {
  concert: ['venue', 'doors', 'show', 'tickets', 'live', 'with', 'featuring', 'opens'],
  festival: ['festival', 'fest', 'day 1', 'day 2', 'stages', 'lineup', 'gates'],
  album: ['out now', 'available', 'new album', 'new single', 'streaming', 'pre-order', 'release date'],
  film: ['in theaters', 'coming soon', 'directed by', 'starring', 'pg', 'pg-13', 'rated r', 'nc-17'],
  theater: ['broadway', 'off-broadway', 'now playing', 'written by', 'a play', 'musical'],
  comedy: ['comedy', 'stand-up', 'standup', 'comedian', 'laughs', 'funny'],
  promo: ['merchandise', 'tour dates', 'available at', 'shop', 'order now'],
  exhibition: ['exhibition', 'gallery', 'museum', 'on view', 'opening reception', 'curated'],
  hybrid: ['album release show', 'release party', 'record release'],
  unknown: [],
};

/**
 * Type Phase - Classifies poster type
 */
export class TypePhase extends BasePhase<TypePhaseResult> {
  readonly phaseName = 'type' as const;
  private searchService?: SearchService;

  constructor(
    visionProvider: VisionModelProvider,
    phaseManager: PhaseManager,
    searchService?: SearchService
  ) {
    super(visionProvider, phaseManager);
    this.searchService = searchService;
  }

  /**
   * Execute type classification phase
   */
  async execute(input: PhaseInput): Promise<TypePhaseResult> {
    const startTime = Date.now();

    try {
      this.log('info', `Starting type classification for ${input.posterId}`);

      // Step 1: Initial vision extraction
      const extraction = await this.visionProvider.extractFromImage(
        input.imagePath,
        TYPE_CLASSIFICATION_PROMPT
      );

      // Step 2: Parse the response
      const parsed = this.parseJsonResponse(extraction.extracted_text);

      // Step 3: Validate and normalize type
      let posterType = this.validatePosterType(parsed.poster_type);
      let confidence = this.normalizeConfidence(parsed.confidence);
      let evidence = this.normalizeStringArray(parsed.evidence);

      // Step 4: If low confidence, try refinement
      if (confidence < input.options.confidenceThreshold! && input.options.onLowConfidence !== 'skip') {
        this.log('info', `Low confidence (${confidence}), attempting refinement`);

        const refinedResult = await this.attemptRefinement(
          input.imagePath,
          posterType,
          confidence,
          evidence
        );

        if (refinedResult.confidence > confidence) {
          posterType = refinedResult.type;
          confidence = refinedResult.confidence;
          evidence = refinedResult.evidence;
        }
      }

      // Step 5: Apply pattern-based validation
      const patternConfidence = this.validateWithPatterns(
        extraction.extracted_text,
        posterType
      );

      // Blend extraction confidence with pattern confidence
      const blendedConfidence = (confidence * 0.7) + (patternConfidence * 0.3);

      // Step 6: Search for similar posters in knowledge base (if available)
      let kbValidation: { validated: boolean; matchingTypes?: PosterType[] } | undefined;
      if (this.searchService && input.options.validateTypes) {
        kbValidation = await this.validateWithKnowledgeBase(
          extraction.extracted_text,
          posterType
        );
      }

      // Step 7: Build visual cues
      const visualCues = this.extractVisualCues((parsed.visual_cues || {}) as Record<string, unknown>);

      // Step 8: Build inferred types for HAS_TYPE relationships
      const secondaryTypes = this.buildSecondaryTypes(
        posterType,
        blendedConfidence,
        extraction.model
      );

      // Step 9: Determine if ready for next phase
      const finalConfidence = kbValidation?.validated
        ? Math.min(blendedConfidence + 0.1, 1.0)
        : blendedConfidence;

      const readyForPhase2 = finalConfidence >= (input.options.confidenceThreshold ?? 0.5);

      const result: TypePhaseResult = {
        posterId: input.posterId,
        imagePath: input.imagePath,
        phase: 'type',
        status: readyForPhase2 ? 'completed' : 'needs_review',
        confidence: finalConfidence,
        processingTimeMs: Date.now() - startTime,
        primaryType: {
          type: posterType,
          confidence: finalConfidence,
          evidence,
        },
        secondaryTypes,
        visualCues,
        extractedText: extraction.extracted_text,
        readyForPhase2,
        warnings: finalConfidence < 0.7 ? [`Low confidence type classification: ${posterType}`] : undefined,
      };

      // Store result in phase manager
      this.phaseManager.storePhaseResult(input.context.sessionId, result);

      this.log('info', `Type classification complete: ${posterType} (${Math.round(finalConfidence * 100)}%)`);

      return result;
    } catch (error) {
      return this.handleError(input, error, startTime);
    }
  }

  /**
   * Validate poster type is a known value
   */
  private validatePosterType(type: unknown): PosterType {
    if (typeof type !== 'string') return 'unknown';

    const normalized = type.toLowerCase().trim();

    if (VALID_POSTER_TYPES.includes(normalized as PosterType)) {
      return normalized as PosterType;
    }

    // Handle common variations
    if (normalized.includes('concert') || normalized.includes('show')) return 'concert';
    if (normalized.includes('festival')) return 'festival';
    if (normalized.includes('album') || normalized.includes('release')) return 'album';
    if (normalized.includes('movie') || normalized.includes('film')) return 'film';
    if (normalized.includes('play') || normalized.includes('theater') || normalized.includes('theatre')) return 'theater';
    if (normalized.includes('comedy') || normalized.includes('stand')) return 'comedy';

    return 'unknown';
  }

  /**
   * Normalize confidence to 0-1 range
   */
  private normalizeConfidence(confidence: unknown): number {
    if (typeof confidence !== 'number') {
      if (typeof confidence === 'string') {
        const parsed = parseFloat(confidence);
        if (!isNaN(parsed)) {
          return parsed > 1 ? parsed / 100 : parsed;
        }
      }
      return 0.5; // Default confidence
    }

    // Handle percentage vs decimal
    return confidence > 1 ? confidence / 100 : confidence;
  }

  /**
   * Attempt type refinement with adjusted prompt
   */
  private async attemptRefinement(
    imagePath: string,
    previousType: PosterType,
    previousConfidence: number,
    previousEvidence: string[]
  ): Promise<{ type: PosterType; confidence: number; evidence: string[] }> {
    try {
      const refinementPrompt = getRefinementPrompt(
        previousType,
        previousConfidence,
        previousEvidence
      );

      const extraction = await this.visionProvider.extractFromImage(
        imagePath,
        refinementPrompt
      );

      const parsed = this.parseJsonResponse(extraction.extracted_text);

      return {
        type: this.validatePosterType(parsed.poster_type),
        confidence: this.normalizeConfidence(parsed.confidence),
        evidence: this.normalizeStringArray(parsed.evidence),
      };
    } catch (error) {
      this.log('warn', 'Refinement attempt failed', {
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        type: previousType,
        confidence: previousConfidence,
        evidence: previousEvidence,
      };
    }
  }

  /**
   * Validate type using text pattern matching
   */
  private validateWithPatterns(extractedText: string, detectedType: PosterType): number {
    const lowerText = extractedText.toLowerCase();
    let matchCount = 0;
    let totalPatterns = 0;

    // Check patterns for detected type
    const typePatterns = TYPE_PATTERNS[detectedType] || [];
    for (const pattern of typePatterns) {
      totalPatterns++;
      if (lowerText.includes(pattern)) {
        matchCount++;
      }
    }

    // Check patterns for competing types
    let competingMatches = 0;
    for (const [type, patterns] of Object.entries(TYPE_PATTERNS)) {
      if (type !== detectedType && type !== 'unknown') {
        for (const pattern of patterns) {
          if (lowerText.includes(pattern)) {
            competingMatches++;
          }
        }
      }
    }

    // Calculate confidence based on pattern matches
    if (totalPatterns === 0) return 0.5;

    const matchRatio = matchCount / totalPatterns;
    const competingPenalty = Math.min(competingMatches * 0.05, 0.3);

    return Math.max(0, matchRatio - competingPenalty);
  }

  /**
   * Validate type using knowledge base search
   */
  private async validateWithKnowledgeBase(
    extractedText: string,
    detectedType: PosterType
  ): Promise<{ validated: boolean; matchingTypes?: PosterType[] }> {
    if (!this.searchService) {
      return { validated: false };
    }

    try {
      // Search for similar posters - returns ScoredEntity[] directly
      const results = await this.searchService.search(extractedText.slice(0, 200), {
        entityTypes: ['Poster'],
        limit: 5,
      });

      if (!results || results.length === 0) {
        return { validated: false };
      }

      // Check types of similar posters (ScoredEntity extends Entity directly)
      const matchingTypes: PosterType[] = [];
      for (const entity of results) {
        if ('poster_type' in entity && entity.poster_type) {
          matchingTypes.push(entity.poster_type as PosterType);
        }
      }

      // Validate if similar posters have same type
      const validated = matchingTypes.includes(detectedType);

      return { validated, matchingTypes };
    } catch (error) {
      this.log('warn', 'Knowledge base validation failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return { validated: false };
    }
  }

  /**
   * Extract and normalize visual cues
   */
  private extractVisualCues(raw: Record<string, unknown>): TypePhaseResult['visualCues'] {
    return {
      hasArtistPhoto: raw.has_artist_photo === true,
      hasAlbumArtwork: raw.has_album_artwork === true,
      hasLogo: raw.has_logo === true,
      dominantColors: this.normalizeStringArray(raw.dominant_colors),
      style: this.normalizeVisualStyle(raw.style),
    };
  }

  /**
   * Normalize visual style value
   */
  private normalizeVisualStyle(
    style: unknown
  ): 'photographic' | 'illustrated' | 'typographic' | 'mixed' | 'other' | undefined {
    if (typeof style !== 'string') return undefined;

    const normalized = style.toLowerCase().trim();

    const validStyles = ['photographic', 'illustrated', 'typographic', 'mixed', 'other'] as const;
    if (validStyles.includes(normalized as typeof validStyles[number])) {
      return normalized as typeof validStyles[number];
    }

    // Handle variations
    if (normalized.includes('photo')) return 'photographic';
    if (normalized.includes('illustrat') || normalized.includes('drawn')) return 'illustrated';
    if (normalized.includes('typo') || normalized.includes('text')) return 'typographic';
    if (normalized.includes('mix')) return 'mixed';

    return 'other';
  }

  /**
   * Build secondary types for hybrid detection
   */
  private buildSecondaryTypes(
    primaryType: PosterType,
    confidence: number,
    model: string
  ): TypeInference[] {
    const types: TypeInference[] = [
      {
        type_key: primaryType,
        confidence,
        source: 'vision',
        evidence: `Vision model ${model} classification`,
        is_primary: true,
      },
    ];

    // Handle hybrid type
    if (primaryType === 'hybrid') {
      types.push({
        type_key: 'album',
        confidence: confidence * 0.9,
        source: 'vision',
        evidence: `Hybrid type includes album component`,
        is_primary: false,
      });
      types.push({
        type_key: 'concert',
        confidence: confidence * 0.85,
        source: 'vision',
        evidence: `Hybrid type includes concert component`,
        is_primary: false,
      });
    }

    return types;
  }
}
