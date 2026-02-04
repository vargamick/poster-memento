/**
 * Confidence Scoring Utilities for QA Validation
 *
 * Provides functions for calculating overall confidence scores
 * from individual validation results.
 */

import { ValidatorResult, QAValidationResult, OverallStatus } from '../types.js';

/**
 * Field weights for calculating overall confidence score
 * Higher weights mean the field contributes more to the overall score
 */
export const DEFAULT_FIELD_WEIGHTS: Record<string, number> = {
  // High priority fields (30%)
  headliner: 0.20,
  title: 0.10,

  // Medium priority fields (40%)
  supporting_acts: 0.10,
  venue_name: 0.15,
  event_date: 0.10,
  year: 0.05,

  // Lower priority fields (20%)
  city: 0.05,
  state: 0.05,
  country: 0.05,
  record_label: 0.05,

  // Minimal weight fields (10%)
  tour_name: 0.03,
  promoter: 0.03,
  door_time: 0.02,
  show_time: 0.02,
};

/**
 * Options for confidence calculation
 */
export interface ConfidenceCalculationOptions {
  fieldWeights?: Record<string, number>;
  penalizeUnverified?: boolean;
  unverifiedPenalty?: number;
  mismatchPenalty?: number;
  warningThreshold?: number;
  mismatchThreshold?: number;
}

const DEFAULT_OPTIONS: Required<ConfidenceCalculationOptions> = {
  fieldWeights: DEFAULT_FIELD_WEIGHTS,
  penalizeUnverified: false,
  unverifiedPenalty: 0.1,
  mismatchPenalty: 0.3,
  warningThreshold: 0.7,
  mismatchThreshold: 0.5,
};

/**
 * Calculate overall confidence score from validator results
 * Returns a score between 0 and 100
 */
export function calculateOverallScore(
  results: ValidatorResult[],
  options: ConfidenceCalculationOptions = {}
): number {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  if (!results.length) return 0;

  let totalWeight = 0;
  let weightedScore = 0;

  for (const result of results) {
    // Skip unverified if not penalizing
    if (result.status === 'unverified' && !opts.penalizeUnverified) {
      continue;
    }

    const weight = opts.fieldWeights[result.field] ?? 0.05;
    totalWeight += weight;

    // Calculate score for this result
    let resultScore = result.confidence;

    // Apply penalties
    if (result.status === 'unverified') {
      resultScore = Math.max(0, resultScore - opts.unverifiedPenalty);
    } else if (result.status === 'mismatch') {
      resultScore = Math.max(0, resultScore - opts.mismatchPenalty);
    }

    weightedScore += resultScore * weight;
  }

  // If no weighted results, return 0
  if (totalWeight === 0) return 0;

  // Convert to 0-100 scale
  return Math.round((weightedScore / totalWeight) * 100);
}

/**
 * Determine overall status from validator results
 */
export function determineOverallStatus(
  results: ValidatorResult[],
  options: ConfidenceCalculationOptions = {}
): OverallStatus {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  if (!results.length) return 'unverified';

  // Count results by status
  const statusCounts = {
    match: 0,
    partial: 0,
    mismatch: 0,
    unverified: 0,
  };

  for (const result of results) {
    statusCounts[result.status]++;
  }

  // Determine overall status
  // If any mismatch, overall is mismatch
  if (statusCounts.mismatch > 0) {
    return 'mismatch';
  }

  // If mostly partial matches, it's a warning
  if (statusCounts.partial > statusCounts.match) {
    return 'warning';
  }

  // If all unverified, return unverified
  if (statusCounts.unverified === results.length) {
    return 'unverified';
  }

  // If at least one match and no mismatches, validated
  if (statusCounts.match > 0) {
    return 'validated';
  }

  // Default to warning if we have partial matches
  if (statusCounts.partial > 0) {
    return 'warning';
  }

  return 'unverified';
}

/**
 * Calculate statistics for a batch of validation results
 */
export function calculateBatchStatistics(results: QAValidationResult[]): {
  totalEntities: number;
  validatedCount: number;
  warningCount: number;
  mismatchCount: number;
  unverifiedCount: number;
  averageScore: number;
  scoreDistribution: {
    excellent: number;  // 90-100
    good: number;       // 70-89
    fair: number;       // 50-69
    poor: number;       // 0-49
  };
} {
  const stats = {
    totalEntities: results.length,
    validatedCount: 0,
    warningCount: 0,
    mismatchCount: 0,
    unverifiedCount: 0,
    averageScore: 0,
    scoreDistribution: {
      excellent: 0,
      good: 0,
      fair: 0,
      poor: 0,
    },
  };

  if (!results.length) return stats;

  let totalScore = 0;

  for (const result of results) {
    // Count by status
    switch (result.status) {
      case 'validated':
        stats.validatedCount++;
        break;
      case 'warning':
        stats.warningCount++;
        break;
      case 'mismatch':
        stats.mismatchCount++;
        break;
      case 'unverified':
        stats.unverifiedCount++;
        break;
    }

    // Accumulate score
    totalScore += result.overallScore;

    // Score distribution
    if (result.overallScore >= 90) {
      stats.scoreDistribution.excellent++;
    } else if (result.overallScore >= 70) {
      stats.scoreDistribution.good++;
    } else if (result.overallScore >= 50) {
      stats.scoreDistribution.fair++;
    } else {
      stats.scoreDistribution.poor++;
    }
  }

  stats.averageScore = Math.round(totalScore / results.length);

  return stats;
}

/**
 * Identify top issues from validation results
 */
export function identifyTopIssues(
  results: QAValidationResult[],
  maxIssues: number = 5
): Array<{
  field: string;
  count: number;
  examples: Array<{
    entityId: string;
    currentValue: string;
    suggestedValue?: string;
  }>;
}> {
  // Collect issues by field
  const issuesByField = new Map<string, Array<{
    entityId: string;
    currentValue: string;
    suggestedValue?: string;
  }>>();

  for (const result of results) {
    // Look at suggestions for issues
    for (const suggestion of result.suggestions) {
      const field = suggestion.field;
      if (!issuesByField.has(field)) {
        issuesByField.set(field, []);
      }
      issuesByField.get(field)!.push({
        entityId: result.entityId,
        currentValue: suggestion.currentValue ?? '',
        suggestedValue: suggestion.suggestedValue,
      });
    }

    // Also consider mismatches from validator results
    for (const validatorResult of result.validatorResults) {
      if (validatorResult.status === 'mismatch' || validatorResult.status === 'partial') {
        const field = validatorResult.field;
        if (!issuesByField.has(field)) {
          issuesByField.set(field, []);
        }

        // Avoid duplicates
        const existing = issuesByField.get(field)!;
        if (!existing.some(e => e.entityId === result.entityId && e.currentValue === validatorResult.originalValue)) {
          existing.push({
            entityId: result.entityId,
            currentValue: validatorResult.originalValue ?? '',
            suggestedValue: validatorResult.validatedValue,
          });
        }
      }
    }
  }

  // Sort by count and take top N
  const sortedIssues = Array.from(issuesByField.entries())
    .map(([field, examples]) => ({
      field,
      count: examples.length,
      examples: examples.slice(0, 3), // Limit examples per issue
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, maxIssues);

  return sortedIssues;
}

/**
 * Generate recommendations based on validation results
 */
export function generateRecommendations(
  results: QAValidationResult[],
  threshold: number = 0.7
): string[] {
  const recommendations: string[] = [];
  const stats = calculateBatchStatistics(results);

  // Overall quality recommendation
  if (stats.averageScore < 50) {
    recommendations.push(
      'Overall data quality is low. Consider re-processing images with better OCR settings or manual review.'
    );
  } else if (stats.averageScore < 70) {
    recommendations.push(
      'Data quality is moderate. Review entities with low confidence scores for potential corrections.'
    );
  }

  // Mismatch recommendations
  if (stats.mismatchCount > 0) {
    const mismatchPercent = Math.round((stats.mismatchCount / stats.totalEntities) * 100);
    recommendations.push(
      `${stats.mismatchCount} entities (${mismatchPercent}%) have mismatched data. Review suggested corrections.`
    );
  }

  // Unverified recommendations
  if (stats.unverifiedCount > stats.totalEntities * 0.5) {
    recommendations.push(
      'Many entities could not be verified against external sources. This may indicate uncommon or local artists/venues.'
    );
  }

  // Field-specific recommendations
  const topIssues = identifyTopIssues(results, 3);
  for (const issue of topIssues) {
    if (issue.count >= 3) {
      recommendations.push(
        `Frequent issues with "${issue.field}" field (${issue.count} occurrences). Consider reviewing extraction patterns.`
      );
    }
  }

  return recommendations;
}

/**
 * Convert confidence (0-1) to percentage string
 */
export function confidenceToPercent(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

/**
 * Get human-readable confidence level
 */
export function getConfidenceLevel(score: number): 'high' | 'medium' | 'low' | 'very-low' {
  if (score >= 90) return 'high';
  if (score >= 70) return 'medium';
  if (score >= 50) return 'low';
  return 'very-low';
}
