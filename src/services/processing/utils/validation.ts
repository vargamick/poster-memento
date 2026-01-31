/**
 * Validation Utility for Schema v2.1.0
 *
 * Validates product entities against schema requirements.
 *
 * Adapted from scripts/agar-processing/utils/validation.ts
 * for use within the processing service.
 */

import type { StructuredProductData } from './observation-parser.js';

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  dataQualityScore: number;
}

/**
 * Validation error
 */
export interface ValidationError {
  field: string;
  message: string;
  value?: unknown;
}

/**
 * Validation warning
 */
export interface ValidationWarning {
  field: string;
  message: string;
  suggestion?: string;
}

/**
 * Validation rules from schema
 */
const REQUIRED_FIELDS = [
  'product_name',
  'product_code',
  'overview',
  'description',
  'container_sizes'
];

const MIN_LENGTHS: Record<string, number> = {
  overview: 50,
  description: 100
};

/**
 * Product validation class
 */
export class ProductValidator {

  /**
   * Validate a product entity against schema v2.1.0
   */
  static validate(product: Partial<StructuredProductData>): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // Check required fields
    for (const field of REQUIRED_FIELDS) {
      const value = product[field as keyof StructuredProductData];

      if (value === undefined || value === null) {
        errors.push({
          field,
          message: `Missing required field: ${field}`
        });
      } else if (typeof value === 'string' && value.trim() === '') {
        errors.push({
          field,
          message: `Required field is empty: ${field}`
        });
      } else if (Array.isArray(value) && value.length === 0) {
        errors.push({
          field,
          message: `Required array field is empty: ${field}`
        });
      }
    }

    // Check minimum lengths
    for (const [field, minLength] of Object.entries(MIN_LENGTHS)) {
      const value = product[field as keyof StructuredProductData];
      if (typeof value === 'string' && value.length < minLength) {
        warnings.push({
          field,
          message: `${field} is shorter than recommended (${value.length} < ${minLength} chars)`,
          suggestion: `Consider adding more detail to ${field}`
        });
      }
    }

    // Validate product_code format
    if (product.product_code) {
      if (!/^[A-Z0-9-]+$/i.test(product.product_code)) {
        warnings.push({
          field: 'product_code',
          message: 'Product code contains non-alphanumeric characters',
          suggestion: 'Product codes should be uppercase alphanumeric'
        });
      }
    }

    // Validate pH range
    if (product.ph !== undefined) {
      if (product.ph < 0 || product.ph > 14) {
        errors.push({
          field: 'ph',
          message: `pH value ${product.ph} is out of range (0-14)`,
          value: product.ph
        });
      }
    }

    if (product.ph_min !== undefined) {
      if (product.ph_min < 0 || product.ph_min > 14) {
        errors.push({
          field: 'ph_min',
          message: `pH min value ${product.ph_min} is out of range (0-14)`,
          value: product.ph_min
        });
      }
    }

    if (product.ph_max !== undefined) {
      if (product.ph_max < 0 || product.ph_max > 14) {
        errors.push({
          field: 'ph_max',
          message: `pH max value ${product.ph_max} is out of range (0-14)`,
          value: product.ph_max
        });
      }
    }

    // Check pH range consistency
    if (product.ph_min !== undefined && product.ph_max !== undefined) {
      if (product.ph_min > product.ph_max) {
        warnings.push({
          field: 'ph_min/ph_max',
          message: `pH min (${product.ph_min}) is greater than pH max (${product.ph_max})`,
          suggestion: 'Values may need to be swapped'
        });
      }
    }

    // Check for potential missing safety data
    if (product.description) {
      const lowerDesc = product.description.toLowerCase();

      if ((lowerDesc.includes('do not') || lowerDesc.includes('caution') ||
           lowerDesc.includes('warning')) &&
          (!product.safety_warnings || product.safety_warnings.length === 0)) {
        warnings.push({
          field: 'safety_warnings',
          message: 'Description contains safety keywords but safety_warnings is empty',
          suggestion: 'Review description for safety warnings to extract'
        });
      }

      if ((lowerDesc.includes('not suitable') || lowerDesc.includes('do not use on')) &&
          (!product.incompatible_surfaces || product.incompatible_surfaces.length === 0)) {
        warnings.push({
          field: 'incompatible_surfaces',
          message: 'Description contains incompatibility info but incompatible_surfaces is empty',
          suggestion: 'Extract incompatible surfaces for relationship creation'
        });
      }
    }

    // Validate container sizes format
    if (product.container_sizes && product.container_sizes.length > 0) {
      for (const size of product.container_sizes) {
        if (!/^\d+[A-Za-z]+$/.test(size)) {
          warnings.push({
            field: 'container_sizes',
            message: `Container size "${size}" may not be in standard format`,
            suggestion: 'Use format like "5L", "20L", "500ML"'
          });
        }
      }
    }

    // Calculate data quality score
    const dataQualityScore = this.calculateDataQualityScore(product, errors);

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      dataQualityScore
    };
  }

  /**
   * Calculate data quality score (0-100)
   */
  static calculateDataQualityScore(
    product: Partial<StructuredProductData>,
    errors: ValidationError[]
  ): number {
    let score = 100;

    // Deduct for missing required fields
    const requiredFieldPenalty = 15;
    for (const field of REQUIRED_FIELDS) {
      const value = product[field as keyof StructuredProductData];
      if (!value || (Array.isArray(value) && value.length === 0)) {
        score -= requiredFieldPenalty;
      }
    }

    // Bonus for optional fields that are populated
    const optionalFields = [
      'ph', 'color', 'odor', 'foam_level', 'dilution_ratios',
      'safety_warnings', 'incompatible_surfaces', 'key_benefits',
      'application_methods', 'environmental_certifications'
    ];

    const optionalBonus = 2;
    for (const field of optionalFields) {
      const value = product[field as keyof StructuredProductData];
      if (value !== undefined && value !== null) {
        if (Array.isArray(value) && value.length > 0) {
          score = Math.min(100, score + optionalBonus);
        } else if (!Array.isArray(value)) {
          score = Math.min(100, score + optionalBonus);
        }
      }
    }

    // Deduct for validation errors
    score -= errors.length * 5;

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Validate a batch of products and return summary
   */
  static validateBatch(products: Partial<StructuredProductData>[]): BatchValidationResult {
    const results = products.map(p => ({
      product_name: p.product_name || 'Unknown',
      result: this.validate(p)
    }));

    const valid = results.filter(r => r.result.valid).length;
    const invalid = results.length - valid;
    const totalErrors = results.reduce((sum, r) => sum + r.result.errors.length, 0);
    const totalWarnings = results.reduce((sum, r) => sum + r.result.warnings.length, 0);
    const avgQualityScore = results.reduce((sum, r) => sum + r.result.dataQualityScore, 0) / results.length;

    return {
      totalProducts: results.length,
      validProducts: valid,
      invalidProducts: invalid,
      totalErrors,
      totalWarnings,
      averageQualityScore: Math.round(avgQualityScore),
      results
    };
  }
}

/**
 * Batch validation result
 */
export interface BatchValidationResult {
  totalProducts: number;
  validProducts: number;
  invalidProducts: number;
  totalErrors: number;
  totalWarnings: number;
  averageQualityScore: number;
  results: Array<{
    product_name: string;
    result: ValidationResult;
  }>;
}

/**
 * Entity validation for v2.1 schema compliance
 */
export class EntityValidator {

  /**
   * Validate an entity object before API submission
   */
  static validateEntity(entity: Record<string, unknown>): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // Check required entity fields
    if (!entity.name) {
      errors.push({ field: 'name', message: 'Entity name is required' });
    } else if (typeof entity.name === 'string' && !/^agar_product_[a-z0-9_]+$/.test(entity.name)) {
      warnings.push({
        field: 'name',
        message: 'Entity name does not match expected pattern',
        suggestion: 'Use format: agar_product_<lowercase_name>'
      });
    }

    if (!entity.entityType) {
      errors.push({ field: 'entityType', message: 'Entity type is required' });
    }

    // For agar_product entities, check structured fields
    if (entity.entityType === 'agar_product') {
      // Check for new required fields
      const requiredFields = ['product_name', 'product_code', 'overview', 'description', 'container_sizes'];

      for (const field of requiredFields) {
        if (!entity[field]) {
          errors.push({
            field,
            message: `Required field missing: ${field}`
          });
        }
      }

      // Check that container_sizes is an array
      if (entity.container_sizes && !Array.isArray(entity.container_sizes)) {
        errors.push({
          field: 'container_sizes',
          message: 'container_sizes must be an array'
        });
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      dataQualityScore: errors.length === 0 ? 100 : 50
    };
  }
}

export default ProductValidator;
