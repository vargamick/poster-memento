/**
 * Base Phase - Abstract base class for processing phases
 */

import {
  ProcessingPhaseName,
  PhaseResult,
  PhaseStatus,
  ProcessingContext,
  IterativeProcessingOptions,
  PosterType,
} from '../types.js';
import { VisionModelProvider } from '../../types.js';
import { PhaseManager } from '../PhaseManager.js';

/**
 * Phase input containing all necessary context
 */
export interface PhaseInput {
  imagePath: string;
  posterId: string;
  context: ProcessingContext;
  options: IterativeProcessingOptions;
}

/**
 * Abstract base class for processing phases
 */
export abstract class BasePhase<T extends PhaseResult> {
  abstract readonly phaseName: ProcessingPhaseName;
  protected visionProvider: VisionModelProvider;
  protected phaseManager: PhaseManager;

  constructor(visionProvider: VisionModelProvider, phaseManager: PhaseManager) {
    this.visionProvider = visionProvider;
    this.phaseManager = phaseManager;
  }

  /**
   * Execute the phase
   */
  abstract execute(input: PhaseInput): Promise<T>;

  /**
   * Parse JSON response from vision model, handling common issues
   */
  protected parseJsonResponse(response: string): Record<string, unknown> {
    // Try to find JSON in the response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    try {
      return JSON.parse(jsonMatch[0]);
    } catch {
      // Try to fix common JSON issues
      let fixed = jsonMatch[0]
        // Remove trailing commas
        .replace(/,\s*([\]}])/g, '$1')
        // Fix unquoted keys
        .replace(/(\{|,)\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":')
        // Fix single quotes
        .replace(/'/g, '"');

      return JSON.parse(fixed);
    }
  }

  /**
   * Create a base result object
   */
  protected createBaseResult(
    input: PhaseInput,
    status: PhaseStatus,
    confidence: number,
    startTime: number
  ): Omit<T, 'phase'> {
    return {
      posterId: input.posterId,
      imagePath: input.imagePath,
      status,
      confidence,
      processingTimeMs: Date.now() - startTime,
    } as Omit<T, 'phase'>;
  }

  /**
   * Handle errors in phase execution
   */
  protected handleError(
    input: PhaseInput,
    error: unknown,
    startTime: number
  ): T {
    const errorMessage = error instanceof Error ? error.message : String(error);

    return {
      posterId: input.posterId,
      imagePath: input.imagePath,
      phase: this.phaseName,
      status: 'failed' as PhaseStatus,
      confidence: 0,
      processingTimeMs: Date.now() - startTime,
      errors: [errorMessage],
    } as T;
  }

  /**
   * Get poster type from context or default to unknown
   */
  protected getPosterType(context: ProcessingContext): PosterType {
    const typeResult = context.phaseResults.get('type');
    if (typeResult && 'primaryType' in typeResult) {
      return (typeResult as { primaryType: { type: PosterType } }).primaryType.type;
    }
    return 'unknown';
  }

  /**
   * Log phase activity
   */
  protected log(level: 'info' | 'warn' | 'error', message: string, data?: Record<string, unknown>): void {
    const prefix = `[${this.phaseName.toUpperCase()}]`;
    const logData = data ? ` ${JSON.stringify(data)}` : '';

    switch (level) {
      case 'info':
        console.log(`${prefix} ${message}${logData}`);
        break;
      case 'warn':
        console.warn(`${prefix} ${message}${logData}`);
        break;
      case 'error':
        console.error(`${prefix} ${message}${logData}`);
        break;
    }
  }

  /**
   * Normalize a string value (trim, handle nullish)
   */
  protected normalizeString(value: unknown): string | undefined {
    if (value === null || value === undefined) return undefined;
    const str = String(value).trim();
    return str.length > 0 ? str : undefined;
  }

  /**
   * Normalize an array of strings
   */
  protected normalizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      if (typeof value === 'string') {
        // Split by comma if single string
        return value.split(',').map(s => s.trim()).filter(s => s.length > 0);
      }
      return [];
    }
    return value
      .map(v => this.normalizeString(v))
      .filter((v): v is string => v !== undefined);
  }

  /**
   * Calculate confidence based on field completeness and validation
   */
  protected calculateConfidence(
    extractedFields: Record<string, unknown>,
    requiredFields: string[],
    optionalFields: string[] = []
  ): number {
    let score = 0;
    let maxScore = 0;

    // Required fields have higher weight
    for (const field of requiredFields) {
      maxScore += 2;
      if (extractedFields[field] !== undefined && extractedFields[field] !== null) {
        const value = extractedFields[field];
        if (typeof value === 'string' && value.trim().length > 0) {
          score += 2;
        } else if (Array.isArray(value) && value.length > 0) {
          score += 2;
        } else if (typeof value === 'number' || typeof value === 'boolean') {
          score += 2;
        }
      }
    }

    // Optional fields have lower weight
    for (const field of optionalFields) {
      maxScore += 1;
      if (extractedFields[field] !== undefined && extractedFields[field] !== null) {
        const value = extractedFields[field];
        if (typeof value === 'string' && value.trim().length > 0) {
          score += 1;
        } else if (Array.isArray(value) && value.length > 0) {
          score += 1;
        } else if (typeof value === 'number' || typeof value === 'boolean') {
          score += 1;
        }
      }
    }

    return maxScore > 0 ? score / maxScore : 0;
  }
}
