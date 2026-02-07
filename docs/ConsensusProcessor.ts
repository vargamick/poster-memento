/**

 * Consensus Processor - Multi-Model "Triple-Keying" for Poster Extraction
 *
 * Runs the same image through multiple vision models and merges results
 * to improve accuracy and field coverage through consensus.
 *
 * Strategies:
 * 1. Majority voting for categorical fields (poster_type)
 * 2. Union merge for non-conflicting fields (fill gaps)
 * 3. Confidence-weighted selection for conflicting fields
 * 4. Optional LLM arbitration for low-confidence conflicts
 */

import { VisionModelProvider, PosterEntity, VisionExtractionResult } from '../types.js';
import { VisionModelFactory, VisionModelConfig } from '../VisionModelFactory.js';
import { PosterType } from '../iterative/types.js';

// ============================================================================
// Types
// ============================================================================

export interface ModelResult {
  modelKey: string;
  modelName: string;
  result: Partial<PosterEntity>;
  rawResponse: string;
  confidence: number;
  processingTimeMs: number;
  error?: string;
}

export interface FieldConsensus {
  field: string;
  finalValue: unknown;
  confidence: number;
  strategy: 'majority' | 'union' | 'weighted' | 'arbitration' | 'single';
  votes: Array<{
    modelKey: string;
    value: unknown;
    confidence: number;
  }>;
  conflict: boolean;
}

export interface ConsensusResult {
  success: boolean;
  entity: Partial<PosterEntity>;
  modelResults: ModelResult[];
  fieldConsensus: FieldConsensus[];
  overallConfidence: number;
  agreementScore: number; // 0-1, how much models agreed
  processingTimeMs: number;
  modelsUsed: string[];
  errors: string[];
}

export interface ConsensusConfig {
  /** Models to use for consensus (at least 2 recommended) */
  models: string[];
  /** Minimum agreement ratio to accept a value (default: 0.5 = majority) */
  minAgreementRatio: number;
  /** Minimum confidence to include a model's vote */
  minVoteConfidence: number;
  /** Run models in parallel (faster) or sequential (less resource intensive) */
  parallel: boolean;
  /** Fields that require strict majority (no single-model fallback) */
  strictMajorityFields: string[];
  /** Enable LLM arbitration for conflicts */
  enableArbitration: boolean;
  /** Timeout per model in ms */
  modelTimeoutMs: number;
}

const DEFAULT_CONFIG: ConsensusConfig = {
  models: ['minicpm-v', 'llava:13b'],
  minAgreementRatio: 0.5,
  minVoteConfidence: 0.3,
  parallel: true,
  strictMajorityFields: ['poster_type'],
  enableArbitration: false,
  modelTimeoutMs: 120000,
};

// Fields that are categorical (use voting)
const CATEGORICAL_FIELDS = ['poster_type'];

// Fields that are arrays (use union)
const ARRAY_FIELDS = ['supporting_acts', 'observations', 'dominant_colors'];

// Fields where we prefer non-null over null
const PREFER_VALUE_FIELDS = [
  'title', 'headliner', 'venue_name', 'city', 'state', 'country',
  'event_date', 'year', 'ticket_price', 'door_time', 'show_time',
  'age_restriction', 'tour_name', 'record_label', 'promoter'
];

// ============================================================================
// Consensus Processor
// ============================================================================

export class ConsensusProcessor {
  private config: ConsensusConfig;
  private modelProviders: Map<string, VisionModelProvider> = new Map();

  constructor(config: Partial<ConsensusConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Process an image through multiple models and merge results
   */
  async processWithConsensus(
    imagePath: string,
    customPrompt?: string
  ): Promise<ConsensusResult> {
    const startTime = Date.now();
    const errors: string[] = [];

    // Initialize model providers
    await this.initializeProviders();

    // Run extraction on all models
    console.log(`[CONSENSUS] Processing ${imagePath} with ${this.config.models.length} models...`);
    const modelResults = await this.runAllModels(imagePath, customPrompt);

    // Filter successful results
    const successfulResults = modelResults.filter(r => !r.error && r.result);

    if (successfulResults.length === 0) {
      return {
        success: false,
        entity: {},
        modelResults,
        fieldConsensus: [],
        overallConfidence: 0,
        agreementScore: 0,
        processingTimeMs: Date.now() - startTime,
        modelsUsed: this.config.models,
        errors: ['All models failed to extract data'],
      };
    }

    console.log(`[CONSENSUS] ${successfulResults.length}/${modelResults.length} models succeeded`);

    // Merge results using consensus strategies
    const { entity, fieldConsensus, agreementScore } = this.mergeResults(successfulResults);

    // Calculate overall confidence
    const overallConfidence = this.calculateOverallConfidence(fieldConsensus, agreementScore);

    return {
      success: true,
      entity,
      modelResults,
      fieldConsensus,
      overallConfidence,
      agreementScore,
      processingTimeMs: Date.now() - startTime,
      modelsUsed: this.config.models,
      errors,
    };
  }

  /**
   * Initialize vision model providers for all configured models
   */
  private async initializeProviders(): Promise<void> {
    for (const modelKey of this.config.models) {
      if (!this.modelProviders.has(modelKey)) {
        try {
          const provider = VisionModelFactory.createByName(modelKey);
          this.modelProviders.set(modelKey, provider);
        } catch (error) {
          console.warn(`[CONSENSUS] Failed to initialize model ${modelKey}:`, error);
        }
      }
    }
  }

  /**
   * Run extraction on all models (parallel or sequential)
   */
  private async runAllModels(
    imagePath: string,
    customPrompt?: string
  ): Promise<ModelResult[]> {
    const tasks = this.config.models.map(modelKey =>
      this.runSingleModel(modelKey, imagePath, customPrompt)
    );

    if (this.config.parallel) {
      return Promise.all(tasks);
    } else {
      const results: ModelResult[] = [];
      for (const task of tasks) {
        results.push(await task);
      }
      return results;
    }
  }

  /**
   * Run extraction on a single model with timeout
   */
  private async runSingleModel(
    modelKey: string,
    imagePath: string,
    customPrompt?: string
  ): Promise<ModelResult> {
    const startTime = Date.now();
    const provider = this.modelProviders.get(modelKey);

    if (!provider) {
      return {
        modelKey,
        modelName: modelKey,
        result: {},
        rawResponse: '',
        confidence: 0,
        processingTimeMs: 0,
        error: `Model provider not initialized: ${modelKey}`,
      };
    }

    try {
      console.log(`[CONSENSUS] Running model: ${modelKey}`);

      // Create timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Model timeout')), this.config.modelTimeoutMs);
      });

      // Run extraction with timeout
      const extractionPromise = provider.extractFromImage(imagePath, customPrompt);
      const response = await Promise.race([extractionPromise, timeoutPromise]);

      // Parse the response into entity fields
      const result = this.parseModelResponse(response);
      const confidence = this.estimateResultConfidence(result);

      console.log(`[CONSENSUS] Model ${modelKey} completed in ${Date.now() - startTime}ms (confidence: ${confidence.toFixed(2)})`);

      return {
        modelKey,
        modelName: provider.getModelInfo().name,
        result,
        rawResponse: response.extracted_text,
        confidence,
        processingTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      console.warn(`[CONSENSUS] Model ${modelKey} failed:`, error);
      return {
        modelKey,
        modelName: modelKey,
        result: {},
        rawResponse: '',
        confidence: 0,
        processingTimeMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Parse model response into entity fields
   */
  private parseModelResponse(response: VisionExtractionResult): Partial<PosterEntity> {
    // The response should already have parsed fields from the vision provider
    const entity: Partial<PosterEntity> = {};

    // Copy over all relevant fields
    if (response.poster_type) entity.poster_type = response.poster_type as PosterType;
    if (response.title) entity.title = response.title;
    if (response.headliner) entity.headliner = response.headliner;
    if (response.supporting_acts) entity.supporting_acts = response.supporting_acts;
    if (response.venue) entity.venue_name = response.venue;
    if (response.city) entity.city = response.city;
    if (response.state) entity.state = response.state;
    if (response.date) entity.event_date = response.date;
    if (response.year) entity.year = response.year;
    if (response.ticket_price) entity.ticket_price = response.ticket_price;
    if (response.door_time) entity.door_time = response.door_time;
    if (response.show_time) entity.show_time = response.show_time;
    if (response.age_restriction) entity.age_restriction = response.age_restriction;
    if (response.tour_name) entity.tour_name = response.tour_name;
    if (response.record_label) entity.record_label = response.record_label;
    if (response.promoter) entity.promoter = response.promoter;

    return entity;
  }

  /**
   * Estimate confidence of a result based on field completeness
   */
  private estimateResultConfidence(result: Partial<PosterEntity>): number {
    const coreFields = ['poster_type', 'title', 'headliner'];
    const optionalFields = ['venue_name', 'city', 'event_date', 'year'];

    let score = 0;
    let maxScore = 0;

    // Core fields worth more
    for (const field of coreFields) {
      maxScore += 2;
      if (result[field as keyof PosterEntity]) score += 2;
    }

    // Optional fields
    for (const field of optionalFields) {
      maxScore += 1;
      if (result[field as keyof PosterEntity]) score += 1;
    }

    return maxScore > 0 ? score / maxScore : 0;
  }

  /**
   * Merge results from all models using consensus strategies
   */
  private mergeResults(modelResults: ModelResult[]): {
    entity: Partial<PosterEntity>;
    fieldConsensus: FieldConsensus[];
    agreementScore: number;
  } {
    const entity: Partial<PosterEntity> = {};
    const fieldConsensus: FieldConsensus[] = [];
    let totalAgreements = 0;
    let totalFields = 0;

    // Get all unique fields across all results
    const allFields = new Set<string>();
    for (const result of modelResults) {
      for (const field of Object.keys(result.result)) {
        allFields.add(field);
      }
    }

    // Process each field
    for (const field of allFields) {
      const consensus = this.resolveFieldConsensus(field, modelResults);
      fieldConsensus.push(consensus);

      if (consensus.finalValue !== null && consensus.finalValue !== undefined) {
        (entity as Record<string, unknown>)[field] = consensus.finalValue;
      }

      // Track agreement
      totalFields++;
      if (!consensus.conflict) {
        totalAgreements++;
      }
    }

    const agreementScore = totalFields > 0 ? totalAgreements / totalFields : 0;

    return { entity, fieldConsensus, agreementScore };
  }

  /**
   * Resolve consensus for a single field
   */
  private resolveFieldConsensus(field: string, modelResults: ModelResult[]): FieldConsensus {
    // Collect votes from each model
    const votes: FieldConsensus['votes'] = [];

    for (const result of modelResults) {
      const value = (result.result as Record<string, unknown>)[field];
      if (value !== null && value !== undefined && value !== '') {
        votes.push({
          modelKey: result.modelKey,
          value,
          confidence: result.confidence,
        });
      }
    }

    // No votes = no value
    if (votes.length === 0) {
      return {
        field,
        finalValue: null,
        confidence: 0,
        strategy: 'single',
        votes: [],
        conflict: false,
      };
    }

    // Single vote = use it (unless strict majority required)
    if (votes.length === 1) {
      const isStrict = this.config.strictMajorityFields.includes(field);
      return {
        field,
        finalValue: isStrict ? null : votes[0].value,
        confidence: isStrict ? 0 : votes[0].confidence,
        strategy: 'single',
        votes,
        conflict: false,
      };
    }

    // Multiple votes - apply appropriate strategy
    if (CATEGORICAL_FIELDS.includes(field)) {
      return this.resolveCategoricalField(field, votes);
    } else if (ARRAY_FIELDS.includes(field)) {
      return this.resolveArrayField(field, votes);
    } else {
      return this.resolveValueField(field, votes);
    }
  }

  /**
   * Resolve categorical field using majority voting
   */
  private resolveCategoricalField(field: string, votes: FieldConsensus['votes']): FieldConsensus {
    // Count occurrences of each value
    const valueCounts = new Map<string, { count: number; totalConfidence: number }>();

    for (const vote of votes) {
      const key = String(vote.value);
      const existing = valueCounts.get(key) || { count: 0, totalConfidence: 0 };
      valueCounts.set(key, {
        count: existing.count + 1,
        totalConfidence: existing.totalConfidence + vote.confidence,
      });
    }

    // Find majority
    let winner: string | null = null;
    let winnerCount = 0;
    let winnerConfidence = 0;

    for (const [value, stats] of valueCounts) {
      if (stats.count > winnerCount ||
          (stats.count === winnerCount && stats.totalConfidence > winnerConfidence)) {
        winner = value;
        winnerCount = stats.count;
        winnerConfidence = stats.totalConfidence / stats.count;
      }
    }

    const agreementRatio = winnerCount / votes.length;
    const conflict = valueCounts.size > 1;

    return {
      field,
      finalValue: agreementRatio >= this.config.minAgreementRatio ? winner : null,
      confidence: winnerConfidence * agreementRatio,
      strategy: 'majority',
      votes,
      conflict,
    };
  }

  /**
   * Resolve array field using union strategy
   */
  private resolveArrayField(field: string, votes: FieldConsensus['votes']): FieldConsensus {
    const allValues = new Set<string>();

    for (const vote of votes) {
      const arr = vote.value as unknown[];
      if (Array.isArray(arr)) {
        for (const item of arr) {
          if (item) allValues.add(String(item).trim());
        }
      }
    }

    const unionArray = Array.from(allValues);
    const avgConfidence = votes.reduce((sum, v) => sum + v.confidence, 0) / votes.length;

    return {
      field,
      finalValue: unionArray.length > 0 ? unionArray : null,
      confidence: avgConfidence,
      strategy: 'union',
      votes,
      conflict: false, // Union doesn't really conflict
    };
  }

  /**
   * Resolve value field using confidence-weighted selection
   */
  private resolveValueField(field: string, votes: FieldConsensus['votes']): FieldConsensus {
    // Check if all votes agree
    const uniqueValues = new Set(votes.map(v => this.normalizeValue(v.value)));

    if (uniqueValues.size === 1) {
      // All agree - use highest confidence
      const bestVote = votes.reduce((best, v) => v.confidence > best.confidence ? v : best);
      return {
        field,
        finalValue: bestVote.value,
        confidence: bestVote.confidence,
        strategy: 'weighted',
        votes,
        conflict: false,
      };
    }

    // Conflict - use confidence-weighted selection
    const bestVote = votes.reduce((best, v) => v.confidence > best.confidence ? v : best);

    // For prefer-value fields, pick the most complete value
    if (PREFER_VALUE_FIELDS.includes(field)) {
      const longestVote = votes.reduce((best, v) => {
        const len = String(v.value || '').length;
        const bestLen = String(best.value || '').length;
        return len > bestLen ? v : best;
      });

      // Use longest if it's reasonably confident
      if (longestVote.confidence >= this.config.minVoteConfidence) {
        return {
          field,
          finalValue: longestVote.value,
          confidence: longestVote.confidence * 0.8, // Slight penalty for conflict
          strategy: 'weighted',
          votes,
          conflict: true,
        };
      }
    }

    return {
      field,
      finalValue: bestVote.value,
      confidence: bestVote.confidence * 0.7, // Penalty for conflict
      strategy: 'weighted',
      votes,
      conflict: true,
    };
  }

  /**
   * Normalize a value for comparison
   */
  private normalizeValue(value: unknown): string {
    if (value === null || value === undefined) return '';
    return String(value).toLowerCase().trim().replace(/\s+/g, ' ');
  }

  /**
   * Calculate overall confidence from field consensus and agreement
   */
  private calculateOverallConfidence(
    fieldConsensus: FieldConsensus[],
    agreementScore: number
  ): number {
    if (fieldConsensus.length === 0) return 0;

    const avgFieldConfidence = fieldConsensus.reduce((sum, fc) => sum + fc.confidence, 0) / fieldConsensus.length;

    // Weight: 60% field confidence, 40% agreement
    return avgFieldConfidence * 0.6 + agreementScore * 0.4;
  }

  /**
   * Get available models
   */
  getAvailableModels(): string[] {
    return Array.from(this.modelProviders.keys());
  }

  /**
   * Health check all configured models
   */
  async healthCheck(): Promise<Record<string, boolean>> {
    await this.initializeProviders();

    const health: Record<string, boolean> = {};

    for (const [key, provider] of this.modelProviders) {
      try {
        health[key] = await provider.healthCheck();
      } catch {
        health[key] = false;
      }
    }

    return health;
  }
}
