/**
 * Phase Manager
 *
 * Manages state between processing phases, handles phase transitions,
 * and persists intermediate results.
 */

import {
  ProcessingPhaseName,
  PhaseResult,
  ProcessingContext,
  IterativeJobStatus,
  PhaseStatus,
  TypePhaseResult,
  ArtistPhaseResult,
  VenuePhaseResult,
  EventPhaseResult,
  AssemblyPhaseResult,
  IterativeProcessingConfig,
  DEFAULT_PHASE_CONFIG,
  PosterType,
} from './types.js';
import { ValidatorResult, QASuggestion } from '../../qa-validation/types.js';
import * as crypto from 'crypto';

/**
 * Generate a unique session ID
 */
function generateSessionId(): string {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(4).toString('hex');
  return `iter_${timestamp}_${random}`;
}

/**
 * Generate a unique job ID
 */
function generateJobId(): string {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(4).toString('hex');
  return `job_${timestamp}_${random}`;
}

/**
 * Phase execution order
 */
const PHASE_ORDER: ProcessingPhaseName[] = ['type', 'artist', 'venue', 'event', 'assembly'];

/**
 * Phase Manager - Coordinates iterative processing phases
 */
export class PhaseManager {
  private contexts: Map<string, ProcessingContext> = new Map();
  private jobs: Map<string, IterativeJobStatus> = new Map();
  private config: IterativeProcessingConfig;

  constructor(config?: Partial<IterativeProcessingConfig>) {
    this.config = { ...DEFAULT_PHASE_CONFIG, ...config };
  }

  // ============================================================================
  // Session Management
  // ============================================================================

  /**
   * Create a new processing context for an image
   */
  createContext(imagePath: string, posterId: string): ProcessingContext {
    const sessionId = generateSessionId();

    const context: ProcessingContext = {
      sessionId,
      imagePath,
      posterId,
      startedAt: new Date(),
      currentPhase: 'type',
      phaseResults: new Map(),
      validationResults: [],
      suggestions: [],
    };

    this.contexts.set(sessionId, context);
    return context;
  }

  /**
   * Get a processing context by session ID
   */
  getContext(sessionId: string): ProcessingContext | undefined {
    return this.contexts.get(sessionId);
  }

  /**
   * Remove a processing context
   */
  removeContext(sessionId: string): void {
    this.contexts.delete(sessionId);
  }

  /**
   * Get all active contexts
   */
  getActiveContexts(): ProcessingContext[] {
    return Array.from(this.contexts.values());
  }

  // ============================================================================
  // Job Management
  // ============================================================================

  /**
   * Create a new batch processing job
   */
  createJob(imagePaths: string[]): IterativeJobStatus {
    const jobId = generateJobId();

    const job: IterativeJobStatus = {
      jobId,
      status: 'pending',
      currentPhase: 'type',
      progress: {
        totalImages: imagePaths.length,
        processedImages: 0,
        currentImageIndex: 0,
      },
      phaseProgress: {
        type: { completed: 0, total: imagePaths.length },
        artist: { completed: 0, total: imagePaths.length },
        venue: { completed: 0, total: imagePaths.length },
        event: { completed: 0, total: imagePaths.length },
        assembly: { completed: 0, total: imagePaths.length },
      },
      stats: {
        successCount: 0,
        failureCount: 0,
        lowConfidenceCount: 0,
        needsReviewCount: 0,
        averageConfidence: 0,
      },
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.jobs.set(jobId, job);
    return job;
  }

  /**
   * Get job status
   */
  getJob(jobId: string): IterativeJobStatus | undefined {
    return this.jobs.get(jobId);
  }

  /**
   * Update job status
   */
  updateJob(jobId: string, updates: Partial<IterativeJobStatus>): void {
    const job = this.jobs.get(jobId);
    if (job) {
      Object.assign(job, updates, { updatedAt: new Date().toISOString() });
    }
  }

  /**
   * Get all jobs
   */
  getAllJobs(): IterativeJobStatus[] {
    return Array.from(this.jobs.values());
  }

  // ============================================================================
  // Phase Execution
  // ============================================================================

  /**
   * Store a phase result
   */
  storePhaseResult(sessionId: string, result: PhaseResult): void {
    const context = this.contexts.get(sessionId);
    if (!context) {
      throw new Error(`Context not found: ${sessionId}`);
    }

    context.phaseResults.set(result.phase, result);

    // Aggregate validation results
    if ('validationResults' in result && Array.isArray(result.validationResults)) {
      context.validationResults.push(...result.validationResults);
    }
  }

  /**
   * Get a specific phase result
   */
  getPhaseResult<T extends PhaseResult>(
    sessionId: string,
    phase: ProcessingPhaseName
  ): T | undefined {
    const context = this.contexts.get(sessionId);
    if (!context) return undefined;
    return context.phaseResults.get(phase) as T | undefined;
  }

  /**
   * Get all phase results for a session
   */
  getAllPhaseResults(sessionId: string): Map<ProcessingPhaseName, PhaseResult> | undefined {
    const context = this.contexts.get(sessionId);
    return context?.phaseResults;
  }

  /**
   * Determine the next phase based on current state
   */
  getNextPhase(sessionId: string): ProcessingPhaseName | null {
    const context = this.contexts.get(sessionId);
    if (!context) return null;

    const currentIndex = PHASE_ORDER.indexOf(context.currentPhase);
    if (currentIndex === -1 || currentIndex >= PHASE_ORDER.length - 1) {
      return null;
    }

    // Check if current phase is complete
    const currentResult = context.phaseResults.get(context.currentPhase);
    if (!currentResult || currentResult.status !== 'completed') {
      return null; // Current phase not complete
    }

    // Check readiness flags
    if (!this.isReadyForNextPhase(currentResult)) {
      return null;
    }

    return PHASE_ORDER[currentIndex + 1];
  }

  /**
   * Advance to the next phase
   */
  advancePhase(sessionId: string): ProcessingPhaseName | null {
    const nextPhase = this.getNextPhase(sessionId);
    if (!nextPhase) return null;

    const context = this.contexts.get(sessionId);
    if (context) {
      context.currentPhase = nextPhase;
    }

    return nextPhase;
  }

  /**
   * Check if a phase result indicates readiness for next phase
   */
  private isReadyForNextPhase(result: PhaseResult): boolean {
    switch (result.phase) {
      case 'type':
        return (result as TypePhaseResult).readyForPhase2;
      case 'artist':
        return (result as ArtistPhaseResult).readyForPhase3;
      case 'venue':
        return (result as VenuePhaseResult).readyForPhase4;
      case 'event':
        return (result as EventPhaseResult).readyForAssembly;
      case 'assembly':
        return true; // Assembly is final
      default:
        return false;
    }
  }

  // ============================================================================
  // Validation & Confidence
  // ============================================================================

  /**
   * Add validation results to context
   */
  addValidationResults(sessionId: string, results: ValidatorResult[]): void {
    const context = this.contexts.get(sessionId);
    if (context) {
      context.validationResults.push(...results);
    }
  }

  /**
   * Add suggestions to context
   */
  addSuggestions(sessionId: string, suggestions: QASuggestion[]): void {
    const context = this.contexts.get(sessionId);
    if (context) {
      context.suggestions.push(...suggestions);
    }
  }

  /**
   * Check if phase meets confidence threshold
   */
  meetsConfidenceThreshold(phase: ProcessingPhaseName, confidence: number): boolean {
    const phaseConfig = this.config[phase as keyof IterativeProcessingConfig];
    if (typeof phaseConfig === 'object' && 'confidenceThreshold' in phaseConfig) {
      return confidence >= phaseConfig.confidenceThreshold;
    }
    return confidence >= 0.5; // Default threshold
  }

  /**
   * Determine if phase should be retried based on confidence
   */
  shouldRetryPhase(phase: ProcessingPhaseName, confidence: number, attempts: number): boolean {
    const phaseConfig = this.config[phase as keyof IterativeProcessingConfig];
    if (typeof phaseConfig === 'object' && 'retryOnLowConfidence' in phaseConfig) {
      return (
        phaseConfig.retryOnLowConfidence &&
        !this.meetsConfidenceThreshold(phase, confidence) &&
        attempts < phaseConfig.maxRetries
      );
    }
    return false;
  }

  // ============================================================================
  // Context Aggregation
  // ============================================================================

  /**
   * Get the detected poster type from context
   */
  getPosterType(sessionId: string): PosterType | undefined {
    const typeResult = this.getPhaseResult<TypePhaseResult>(sessionId, 'type');
    return typeResult?.primaryType.type;
  }

  /**
   * Get accumulated context for a phase
   * Provides previous phase results to inform current phase
   */
  getPhaseContext(sessionId: string, phase: ProcessingPhaseName): {
    posterType?: PosterType;
    headliner?: string;
    venue?: string;
    city?: string;
    year?: number;
  } {
    const context = this.contexts.get(sessionId);
    if (!context) return {};

    const typeResult = context.phaseResults.get('type') as TypePhaseResult | undefined;
    const artistResult = context.phaseResults.get('artist') as ArtistPhaseResult | undefined;
    const venueResult = context.phaseResults.get('venue') as VenuePhaseResult | undefined;
    const eventResult = context.phaseResults.get('event') as EventPhaseResult | undefined;

    return {
      posterType: typeResult?.primaryType.type,
      headliner: artistResult?.headliner?.validatedName ?? artistResult?.headliner?.extractedName,
      venue: venueResult?.venue?.validatedName ?? venueResult?.venue?.extractedName,
      city: venueResult?.venue?.city,
      year: eventResult?.year,
    };
  }

  /**
   * Calculate overall confidence from all phases
   */
  calculateOverallConfidence(sessionId: string): number {
    const context = this.contexts.get(sessionId);
    if (!context) return 0;

    const confidences: number[] = [];

    for (const result of context.phaseResults.values()) {
      if (result.confidence > 0) {
        confidences.push(result.confidence);
      }
    }

    if (confidences.length === 0) return 0;
    return confidences.reduce((sum, c) => sum + c, 0) / confidences.length;
  }

  /**
   * Get fields that need review (below threshold)
   */
  getFieldsNeedingReview(sessionId: string): string[] {
    const context = this.contexts.get(sessionId);
    if (!context) return [];

    const fieldsNeedingReview: string[] = [];

    // Check validation results for low confidence
    for (const result of context.validationResults) {
      if (result.status === 'partial' || result.status === 'mismatch') {
        fieldsNeedingReview.push(result.field);
      }
    }

    // Check phase results
    for (const [phase, result] of context.phaseResults) {
      const phaseConfig = this.config[phase as keyof IterativeProcessingConfig];
      if (typeof phaseConfig === 'object' && 'confidenceThreshold' in phaseConfig) {
        if (result.confidence < phaseConfig.confidenceThreshold) {
          fieldsNeedingReview.push(`${phase}_phase`);
        }
      }
    }

    return [...new Set(fieldsNeedingReview)];
  }

  // ============================================================================
  // State Persistence
  // ============================================================================

  /**
   * Export context state for persistence
   */
  exportContextState(sessionId: string): object | undefined {
    const context = this.contexts.get(sessionId);
    if (!context) return undefined;

    return {
      sessionId: context.sessionId,
      imagePath: context.imagePath,
      posterId: context.posterId,
      startedAt: context.startedAt.toISOString(),
      currentPhase: context.currentPhase,
      phaseResults: Object.fromEntries(context.phaseResults),
      validationResults: context.validationResults,
      suggestions: context.suggestions,
    };
  }

  /**
   * Import context state from persistence
   */
  importContextState(state: {
    sessionId: string;
    imagePath: string;
    posterId: string;
    startedAt: string;
    currentPhase: ProcessingPhaseName;
    phaseResults: Record<string, PhaseResult>;
    validationResults: ValidatorResult[];
    suggestions: QASuggestion[];
  }): ProcessingContext {
    const context: ProcessingContext = {
      sessionId: state.sessionId,
      imagePath: state.imagePath,
      posterId: state.posterId,
      startedAt: new Date(state.startedAt),
      currentPhase: state.currentPhase,
      phaseResults: new Map(Object.entries(state.phaseResults) as [ProcessingPhaseName, PhaseResult][]),
      validationResults: state.validationResults,
      suggestions: state.suggestions,
    };

    this.contexts.set(state.sessionId, context);
    return context;
  }

  // ============================================================================
  // Cleanup
  // ============================================================================

  /**
   * Clear completed contexts older than specified age
   */
  cleanupOldContexts(maxAgeMs: number = 3600000): number {
    const now = Date.now();
    let removed = 0;

    for (const [sessionId, context] of this.contexts) {
      const age = now - context.startedAt.getTime();
      const lastResult = Array.from(context.phaseResults.values()).pop();

      // Only remove if old AND (completed or failed)
      if (
        age > maxAgeMs &&
        lastResult &&
        (lastResult.status === 'completed' || lastResult.status === 'failed')
      ) {
        this.contexts.delete(sessionId);
        removed++;
      }
    }

    return removed;
  }

  /**
   * Clear all contexts (for testing)
   */
  clearAll(): void {
    this.contexts.clear();
    this.jobs.clear();
  }
}
