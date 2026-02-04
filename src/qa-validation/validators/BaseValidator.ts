/**
 * Base Validator Abstract Class
 *
 * Provides common functionality for all validators in the QA system.
 */

import { PosterEntity } from '../../image-processor/types.js';
import {
  ValidatorResult,
  ValidationContext,
  ValidatorName,
  ValidationStatus,
  ValidationSource,
} from '../types.js';
import { getMatchStatus } from '../utils/stringMatching.js';

/**
 * Abstract base class for validators
 */
export abstract class BaseValidator {
  /** Unique name of this validator */
  abstract readonly name: ValidatorName;

  /** Entity types this validator can process */
  abstract readonly supportedEntityTypes: string[];

  /** Fields this validator checks */
  abstract readonly supportedFields: string[];

  /**
   * Validate an entity and return results for each validated field
   */
  abstract validate(
    entity: PosterEntity,
    context: ValidationContext
  ): Promise<ValidatorResult[]>;

  /**
   * Check if this validator's external dependencies are available
   */
  abstract healthCheck(): Promise<boolean>;

  /**
   * Check if this validator supports the given entity type
   */
  supportsEntityType(entityType: string): boolean {
    return this.supportedEntityTypes.includes(entityType);
  }

  /**
   * Check if this validator handles the given field
   */
  supportsField(field: string): boolean {
    return this.supportedFields.includes(field);
  }

  /**
   * Create a validator result object
   */
  protected createResult(
    field: string,
    originalValue: string | undefined,
    options: {
      validatedValue?: string;
      confidence: number;
      status: ValidationStatus;
      source: ValidationSource;
      externalId?: string;
      externalUrl?: string;
      message?: string;
      alternatives?: Array<{
        value: string;
        confidence: number;
        externalId?: string;
      }>;
    }
  ): ValidatorResult {
    return {
      validatorName: this.name,
      field,
      originalValue,
      validatedValue: options.validatedValue,
      confidence: options.confidence,
      status: options.status,
      source: options.source,
      externalId: options.externalId,
      externalUrl: options.externalUrl,
      message: options.message,
      alternatives: options.alternatives,
    };
  }

  /**
   * Create an unverified result (couldn't find external data)
   */
  protected createUnverifiedResult(
    field: string,
    originalValue: string | undefined,
    source: ValidationSource,
    message?: string
  ): ValidatorResult {
    return this.createResult(field, originalValue, {
      confidence: 0,
      status: 'unverified',
      source,
      message: message ?? `Could not verify "${field}" against external sources`,
    });
  }

  /**
   * Create a match result
   */
  protected createMatchResult(
    field: string,
    originalValue: string | undefined,
    validatedValue: string,
    confidence: number,
    source: ValidationSource,
    options?: {
      externalId?: string;
      externalUrl?: string;
      message?: string;
    }
  ): ValidatorResult {
    const status = getMatchStatus(confidence);
    return this.createResult(field, originalValue, {
      validatedValue,
      confidence,
      status,
      source,
      ...options,
    });
  }

  /**
   * Create a mismatch result with suggestion
   */
  protected createMismatchResult(
    field: string,
    originalValue: string | undefined,
    suggestedValue: string,
    confidence: number,
    source: ValidationSource,
    options?: {
      externalId?: string;
      externalUrl?: string;
      message?: string;
      alternatives?: Array<{
        value: string;
        confidence: number;
        externalId?: string;
      }>;
    }
  ): ValidatorResult {
    return this.createResult(field, originalValue, {
      validatedValue: suggestedValue,
      confidence,
      status: 'mismatch',
      source,
      message: options?.message ?? `Possible correction: "${suggestedValue}"`,
      ...options,
    });
  }

  /**
   * Check if a value is empty or undefined
   */
  protected isEmpty(value: unknown): boolean {
    if (value === undefined || value === null) return true;
    if (typeof value === 'string') return value.trim() === '';
    if (Array.isArray(value)) return value.length === 0;
    return false;
  }

  /**
   * Get a safe string value from an entity field
   */
  protected getStringValue(value: unknown): string | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'string') return value.trim() || undefined;
    if (typeof value === 'number') return String(value);
    return undefined;
  }

  /**
   * Get array value from an entity field
   */
  protected getArrayValue(value: unknown): string[] {
    if (!value) return [];
    if (Array.isArray(value)) {
      return value
        .map(v => (typeof v === 'string' ? v.trim() : String(v)))
        .filter(v => v.length > 0);
    }
    if (typeof value === 'string') {
      return value
        .split(/[,;&]/)
        .map(v => v.trim())
        .filter(v => v.length > 0);
    }
    return [];
  }

  /**
   * Log validation activity (can be overridden for custom logging)
   */
  protected log(level: 'debug' | 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>): void {
    const prefix = `[${this.name}Validator]`;
    switch (level) {
      case 'debug':
        console.debug(prefix, message, meta ?? '');
        break;
      case 'info':
        console.info(prefix, message, meta ?? '');
        break;
      case 'warn':
        console.warn(prefix, message, meta ?? '');
        break;
      case 'error':
        console.error(prefix, message, meta ?? '');
        break;
    }
  }
}
