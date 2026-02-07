/**
 * Review Phase - LLM Self-Review of Extracted Data
 *
 * This phase takes the extracted poster data and asks the LLM to review it
 * for obvious errors. The LLM sees both the original image and the extracted
 * data, allowing it to catch semantic errors that pattern matching can't.
 *
 * Examples of errors this catches:
 * - "Sunday 27 January Prince of Wales" labeled as artist (actually date + venue)
 * - "Not applicable as it's an album poster" labeled as venue
 * - Film actors listed as musicians
 * - Venue and artist names swapped
 */

import * as fs from 'fs';
import { VisionModelProvider, PosterEntity, VisionExtractionResult } from './types.js';

// ============================================================================
// Types
// ============================================================================

export interface ReviewResult {
  /** Whether the extraction passed review */
  passed: boolean;
  /** Overall confidence in the extraction (0-1) */
  overallConfidence: number;
  /** Fields that need correction */
  corrections: FieldCorrection[];
  /** Fields that are flagged for manual review */
  flaggedForReview: string[];
  /** Reasoning provided by the LLM */
  reasoning: string;
  /** Processing time in ms */
  processingTimeMs: number;
}

export interface FieldCorrection {
  field: string;
  originalValue: string | null;
  correctedValue: string | null;
  reason: string;
  confidence: number;
}

export interface ReviewPhaseOptions {
  /** Minimum confidence to pass without flagging for review */
  confidenceThreshold?: number;
  /** Whether to attempt auto-correction or just flag issues */
  autoCorrect?: boolean;
  /** Maximum tokens for response */
  maxTokens?: number;
}

const DEFAULT_OPTIONS: Required<ReviewPhaseOptions> = {
  confidenceThreshold: 0.7,
  autoCorrect: true,
  maxTokens: 2048,
};

// ============================================================================
// Review Prompt
// ============================================================================

const REVIEW_PROMPT = `You are a QA reviewer for poster metadata extraction. Review the following extracted data against the poster image.

EXTRACTED DATA:
{{extractedData}}

YOUR TASK:
1. Compare each field against what you see in the image
2. Identify any OBVIOUS ERRORS such as:
   - Date/venue information labeled as artist name
   - Artist name that is actually a date (e.g., "Sunday 27 January")
   - Venue that contains explanatory text instead of an actual venue name
   - Fields that are clearly swapped (venue in artist field, etc.)
   - Film actors incorrectly labeled as musicians
   - Verbose explanations instead of actual values

3. For each error found, provide a correction

RESPONSE FORMAT (JSON):
{
  "passed": true|false,
  "overallConfidence": 0.0-1.0,
  "reasoning": "Brief explanation of your assessment",
  "corrections": [
    {
      "field": "field_name",
      "originalValue": "what was extracted",
      "correctedValue": "what it should be (or null if should be empty)",
      "reason": "why this is wrong",
      "confidence": 0.0-1.0
    }
  ],
  "flaggedForReview": ["field1", "field2"]
}

IMPORTANT RULES:
- If a field should be EMPTY (no valid data), set correctedValue to null
- Only flag real errors, not minor formatting issues
- "passed" should be true if no corrections needed or all corrections are minor
- "passed" should be false if there are major errors that change the meaning

Examples of what to catch:
- headliner: "Sunday 27 January Prince of Wales" → This is a DATE + VENUE, not an artist. Correct to null.
- venue: "Not applicable as it's an album poster" → This is an explanation, not a venue. Correct to null.
- headliner: "Robert De Niro (actor's name prominently displayed)" → Strip the parenthetical, just "Robert De Niro"

Return ONLY the JSON response, no additional text.`;

// ============================================================================
// Review Phase Implementation
// ============================================================================

/**
 * Execute the review phase on extracted poster data
 */
export async function reviewExtractedData(
  imagePath: string,
  extractedEntity: Partial<PosterEntity>,
  visionProvider: VisionModelProvider,
  options: ReviewPhaseOptions = {}
): Promise<ReviewResult> {
  const startTime = Date.now();
  const mergedOptions = { ...DEFAULT_OPTIONS, ...options };

  // Format the extracted data for the prompt
  const extractedDataStr = formatExtractedData(extractedEntity);

  // Build the review prompt
  const prompt = REVIEW_PROMPT.replace('{{extractedData}}', extractedDataStr);

  try {
    // Call the vision model with the image and review prompt
    const response = await visionProvider.extractFromImage(imagePath, prompt);

    // Parse the response
    const result = parseReviewResponse(response.extracted_text, mergedOptions);

    return {
      ...result,
      processingTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    // If review fails, return a conservative result that flags for manual review
    return {
      passed: false,
      overallConfidence: 0.3,
      corrections: [],
      flaggedForReview: ['headliner', 'venue_name', 'supporting_acts'],
      reasoning: `Review failed: ${error instanceof Error ? error.message : String(error)}`,
      processingTimeMs: Date.now() - startTime,
    };
  }
}

/**
 * Format extracted entity data for the review prompt
 */
function formatExtractedData(entity: Partial<PosterEntity>): string {
  const lines: string[] = [];

  lines.push(`Poster Type: ${entity.poster_type || '(not specified)'}`);
  lines.push(`Title: ${entity.title || '(not specified)'}`);
  lines.push(`Headliner: ${entity.headliner || '(not specified)'}`);

  if (entity.supporting_acts && entity.supporting_acts.length > 0) {
    lines.push(`Supporting Acts: ${entity.supporting_acts.join(', ')}`);
  } else {
    lines.push(`Supporting Acts: (none)`);
  }

  lines.push(`Venue: ${entity.venue_name || '(not specified)'}`);
  lines.push(`City: ${entity.city || '(not specified)'}`);
  lines.push(`State: ${entity.state || '(not specified)'}`);
  lines.push(`Event Date: ${entity.event_date || '(not specified)'}`);
  lines.push(`Year: ${entity.year || '(not specified)'}`);

  if (entity.tour_name) lines.push(`Tour Name: ${entity.tour_name}`);
  if (entity.record_label) lines.push(`Record Label: ${entity.record_label}`);
  if (entity.ticket_price) lines.push(`Ticket Price: ${entity.ticket_price}`);

  return lines.join('\n');
}

/**
 * Parse the LLM's review response
 */
function parseReviewResponse(
  responseText: string,
  options: Required<ReviewPhaseOptions>
): Omit<ReviewResult, 'processingTimeMs'> {
  try {
    // Try to extract JSON from the response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate and normalize the response
    const corrections: FieldCorrection[] = [];
    if (Array.isArray(parsed.corrections)) {
      for (const c of parsed.corrections) {
        if (c.field && typeof c.field === 'string') {
          corrections.push({
            field: c.field,
            originalValue: c.originalValue ?? null,
            correctedValue: c.correctedValue ?? null,
            reason: c.reason || 'No reason provided',
            confidence: typeof c.confidence === 'number' ? c.confidence : 0.7,
          });
        }
      }
    }

    const flaggedForReview: string[] = [];
    if (Array.isArray(parsed.flaggedForReview)) {
      for (const f of parsed.flaggedForReview) {
        if (typeof f === 'string') {
          flaggedForReview.push(f);
        }
      }
    }

    const overallConfidence = typeof parsed.overallConfidence === 'number'
      ? Math.max(0, Math.min(1, parsed.overallConfidence))
      : 0.5;

    return {
      passed: parsed.passed === true && overallConfidence >= options.confidenceThreshold,
      overallConfidence,
      corrections,
      flaggedForReview,
      reasoning: parsed.reasoning || 'No reasoning provided',
    };
  } catch (error) {
    // If parsing fails, return a conservative result
    return {
      passed: false,
      overallConfidence: 0.4,
      corrections: [],
      flaggedForReview: ['headliner', 'venue_name'],
      reasoning: `Failed to parse review response: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Apply corrections from the review to the entity
 */
export function applyCorrections(
  entity: Partial<PosterEntity>,
  reviewResult: ReviewResult
): Partial<PosterEntity> {
  if (reviewResult.corrections.length === 0) {
    return entity;
  }

  const corrected = { ...entity };

  for (const correction of reviewResult.corrections) {
    // Only apply corrections with reasonable confidence
    if (correction.confidence < 0.5) continue;

    switch (correction.field) {
      case 'headliner':
        corrected.headliner = correction.correctedValue ?? undefined;
        break;
      case 'venue_name':
      case 'venue':
        corrected.venue_name = correction.correctedValue ?? undefined;
        break;
      case 'title':
        corrected.title = correction.correctedValue ?? undefined;
        break;
      case 'city':
        corrected.city = correction.correctedValue ?? undefined;
        break;
      case 'state':
        corrected.state = correction.correctedValue ?? undefined;
        break;
      case 'event_date':
        corrected.event_date = correction.correctedValue ?? undefined;
        break;
      case 'supporting_acts':
        if (correction.correctedValue === null) {
          corrected.supporting_acts = undefined;
        } else if (typeof correction.correctedValue === 'string') {
          // If corrected value is a comma-separated string, split it
          corrected.supporting_acts = correction.correctedValue
            .split(',')
            .map(s => s.trim())
            .filter(s => s.length > 0);
        }
        break;
      // Add more fields as needed
    }
  }

  return corrected;
}

/**
 * Determine if entity should be processed based on review result
 */
export function shouldProcessEntity(reviewResult: ReviewResult): {
  shouldProcess: boolean;
  reason: string;
} {
  // If review passed with high confidence, process normally
  if (reviewResult.passed && reviewResult.overallConfidence >= 0.7) {
    return { shouldProcess: true, reason: 'Review passed' };
  }

  // If there are corrections, process with corrections applied
  if (reviewResult.corrections.length > 0) {
    return { shouldProcess: true, reason: 'Processing with corrections applied' };
  }

  // If flagged for review but no corrections, process with caution
  if (reviewResult.flaggedForReview.length > 0) {
    return {
      shouldProcess: true,
      reason: `Flagged for review: ${reviewResult.flaggedForReview.join(', ')}`,
    };
  }

  // If confidence is very low, don't process
  if (reviewResult.overallConfidence < 0.3) {
    return { shouldProcess: false, reason: 'Confidence too low' };
  }

  return { shouldProcess: true, reason: 'Default processing' };
}
