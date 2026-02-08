/**
 * QA Validation Service
 *
 * Orchestrates the QA validation process for poster entities.
 * Manages validation jobs, coordinates validators, and generates reports.
 */

import { EntityService } from '../core/services/EntityService.js';
import { RelationService } from '../core/services/RelationService.js';
import { PosterEntity } from '../image-processor/types.js';
import {
  QAValidationConfig,
  QAValidationResult,
  QAJobStatus,
  QAJobPhase,
  QAJobStats,
  QAReport,
  QAReportSummary,
  QASuggestion,
  QARelationshipSuggestion,
  ValidatorResult,
  ValidatorName,
  ValidationContext,
  ValidationSource,
  DEFAULT_QA_CONFIG,
  EntityTypeSummary,
} from './types.js';
import { BaseValidator } from './validators/BaseValidator.js';
import { ArtistValidator } from './validators/ArtistValidator.js';
import { VenueValidator } from './validators/VenueValidator.js';
import { DateValidator } from './validators/DateValidator.js';
import { ReleaseValidator } from './validators/ReleaseValidator.js';
import { PosterTypeValidator } from './validators/PosterTypeValidator.js';
import { MusicBrainzClient } from './clients/MusicBrainzClient.js';
import { DiscogsClient } from './clients/DiscogsClient.js';
import { TMDBClient } from './clients/TMDBClient.js';
import {
  calculateOverallScore,
  determineOverallStatus,
  calculateBatchStatistics,
  identifyTopIssues,
  generateRecommendations,
} from './utils/confidenceScoring.js';
import { EnrichmentPhase } from '../image-processor/iterative/phases/EnrichmentPhase.js';
import { PhaseManager } from '../image-processor/iterative/PhaseManager.js';
import type { ArtistPhaseResult, ArtistMatch, ProcessingContext } from '../image-processor/iterative/types.js';

/**
 * Configuration for the QA Validation Service
 */
export interface QAServiceDependencies {
  entityService: EntityService;
  relationService?: RelationService;
  discogsToken?: string;
  tmdbApiKey?: string;
}

/**
 * Generate a unique job ID
 */
function generateJobId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `qa_${timestamp}_${random}`;
}

/**
 * Generate a unique report ID
 */
function generateReportId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `report_${timestamp}_${random}`;
}

/**
 * QA Validation Service
 */
export class QAValidationService {
  private entityService: EntityService;
  private relationService: RelationService | null;
  private validators: Map<ValidatorName, BaseValidator>;
  private jobs: Map<string, QAJobStatus>;
  private reports: Map<string, QAReport>;
  private runningJobs: Set<string>;
  private tmdbApiKey?: string;
  private discogsToken?: string;

  constructor(dependencies: QAServiceDependencies) {
    this.entityService = dependencies.entityService;
    this.relationService = dependencies.relationService ?? null;
    this.tmdbApiKey = dependencies.tmdbApiKey;
    this.discogsToken = dependencies.discogsToken;
    this.jobs = new Map();
    this.reports = new Map();
    this.runningJobs = new Set();

    // Initialize validators
    this.validators = this.initializeValidators(dependencies);
  }

  /**
   * Initialize all validators with their dependencies
   */
  private initializeValidators(dependencies: QAServiceDependencies): Map<ValidatorName, BaseValidator> {
    const validators = new Map<ValidatorName, BaseValidator>();

    // Create API clients
    const musicBrainz = new MusicBrainzClient();

    const discogs = dependencies.discogsToken
      ? new DiscogsClient(dependencies.discogsToken)
      : undefined;

    const tmdb = dependencies.tmdbApiKey
      ? new TMDBClient(dependencies.tmdbApiKey)
      : undefined;

    // Create validators
    validators.set('artist', new ArtistValidator(musicBrainz, discogs));
    validators.set('venue', new VenueValidator());
    validators.set('date', new DateValidator());
    validators.set('release', new ReleaseValidator(musicBrainz, discogs, tmdb));
    validators.set('poster_type', new PosterTypeValidator(musicBrainz, discogs, tmdb));

    return validators;
  }

  /**
   * Start a new validation job
   */
  async startValidationJob(config: QAValidationConfig = {}): Promise<string> {
    const jobId = generateJobId();
    const mergedConfig = { ...DEFAULT_QA_CONFIG, ...config };

    const jobStatus: QAJobStatus = {
      jobId,
      phase: 'pending',
      progress: 0,
      message: 'Job created, starting validation...',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      config: mergedConfig,
      stats: {
        totalEntities: 0,
        processedEntities: 0,
        validatedCount: 0,
        warningCount: 0,
        mismatchCount: 0,
        unverifiedCount: 0,
        averageScore: 0,
        apiCallsMade: 0,
        errors: [],
      },
    };

    this.jobs.set(jobId, jobStatus);

    // Run validation asynchronously
    this.runValidation(jobId, mergedConfig).catch(error => {
      this.updateJobStatus(jobId, {
        phase: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
    });

    return jobId;
  }

  /**
   * Get the status of a validation job
   */
  getJobStatus(jobId: string): QAJobStatus | null {
    return this.jobs.get(jobId) ?? null;
  }

  /**
   * Get all jobs
   */
  getAllJobs(): QAJobStatus[] {
    return Array.from(this.jobs.values());
  }

  /**
   * Cancel a running job
   */
  async cancelJob(jobId: string): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    if (this.runningJobs.has(jobId)) {
      this.runningJobs.delete(jobId);
      this.updateJobStatus(jobId, {
        phase: 'cancelled',
        message: 'Job cancelled by user',
      });
      return true;
    }

    return false;
  }

  /**
   * Get a validation report
   */
  getReport(jobId: string): QAReport | null {
    return this.reports.get(jobId) ?? null;
  }

  /**
   * Validate a single entity (preview mode)
   */
  async validateSingleEntity(entityName: string): Promise<QAValidationResult | null> {
    const entityResult = await this.entityService.getEntity(entityName);
    if (!entityResult.success || !entityResult.data) {
      return null;
    }

    const entity = entityResult.data as PosterEntity;
    return this.validateEntity(entity, DEFAULT_QA_CONFIG);
  }

  /**
   * Enrich a single entity using external APIs (preview mode)
   * Returns enrichment suggestions in the same QAValidationResult format
   * so the frontend can use the same accept/reject UI.
   */
  async enrichSingleEntity(entityName: string): Promise<QAValidationResult | null> {
    const entityResult = await this.entityService.getEntity(entityName);
    if (!entityResult.success || !entityResult.data) {
      return null;
    }

    const startTime = Date.now();
    const rawEntity = entityResult.data as PosterEntity;
    const entity = this.enrichEntityFromObservations(rawEntity);

    // Create EnrichmentPhase with a minimal PhaseManager (not used during execute)
    const phaseManager = new PhaseManager();
    const enrichmentPhase = new EnrichmentPhase(
      phaseManager,
      this.tmdbApiKey,
      this.discogsToken,
    );

    // Build a minimal ArtistPhaseResult from existing entity fields
    const buildArtistMatch = (name: string): ArtistMatch => ({
      extractedName: name,
      confidence: 1.0,
      source: 'internal' as ValidationSource,
    });

    const artistResult: ArtistPhaseResult = {
      posterId: entityName,
      imagePath: '',
      phase: 'artist',
      status: 'completed',
      confidence: 1.0,
      processingTimeMs: 0,
      posterType: (entity.poster_type || 'unknown') as ArtistPhaseResult['posterType'],
      headliner: entity.headliner ? buildArtistMatch(entity.headliner) : undefined,
      supportingActs: (entity.supporting_acts || []).map(buildArtistMatch),
      readyForPhase3: true,
    };

    // Build a minimal ProcessingContext (not used by enrichment methods internally)
    const context: ProcessingContext = {
      sessionId: `enrich_${Date.now()}`,
      imagePath: '',
      posterId: entityName,
      startedAt: new Date(),
      currentPhase: 'enrichment',
      phaseResults: new Map(),
      validationResults: [],
      suggestions: [],
    };

    try {
      const enrichResult = await enrichmentPhase.execute(entity, artistResult, context);

      // Transform EnrichmentPhaseResult into QAValidationResult format
      const suggestions: QASuggestion[] = [];
      for (const field of enrichResult.enrichedFields) {
        const original = enrichResult.originalValues[field];
        const enrichedValue = (enrichResult.enrichedEntity as Record<string, unknown>)[field];
        if (enrichedValue !== undefined && enrichedValue !== original) {
          const sourceInfo = enrichResult.sources[0];
          suggestions.push({
            field,
            currentValue: original != null ? String(original) : undefined,
            suggestedValue: String(enrichedValue),
            reason: `Enriched from ${enrichResult.sources.map(s => s.source).join(', ')}`,
            confidence: sourceInfo?.matchConfidence ?? 0.8,
            source: (sourceInfo?.source as ValidationSource) ?? 'internal',
            externalId: sourceInfo?.externalId,
          });
        }
      }

      const externalMatches = enrichResult.sources.map(s => ({
        source: s.source as ValidationSource,
        externalId: s.externalId,
        name: entity.title || entity.headliner || entityName,
        matchScore: s.matchConfidence,
        url: '',
      }));

      return {
        entityId: entityName,
        entityType: 'Poster',
        overallScore: Math.round(enrichResult.confidence * 100),
        status: suggestions.length > 0 ? 'warning' : 'validated',
        validatedAt: new Date().toISOString(),
        validatorResults: [],
        suggestions,
        externalMatches,
        processingTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        entityId: entityName,
        entityType: 'Poster',
        overallScore: 0,
        status: 'unverified',
        validatedAt: new Date().toISOString(),
        validatorResults: [],
        suggestions: [],
        externalMatches: [],
        processingTimeMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Check health of external APIs
   */
  async checkExternalAPIHealth(): Promise<Record<string, boolean>> {
    const health: Record<string, boolean> = {};

    for (const [name, validator] of this.validators) {
      try {
        health[name] = await validator.healthCheck();
      } catch {
        health[name] = false;
      }
    }

    return health;
  }

  /**
   * Run the validation job
   */
  private async runValidation(
    jobId: string,
    config: QAValidationConfig
  ): Promise<void> {
    this.runningJobs.add(jobId);

    try {
      // Phase 1: Fetch entities
      this.updateJobStatus(jobId, {
        phase: 'fetching_entities',
        message: 'Fetching entities to validate...',
      });

      const entities = await this.fetchEntitiesToValidate(config);

      if (entities.length === 0) {
        this.updateJobStatus(jobId, {
          phase: 'completed',
          message: 'No entities found to validate',
          completedAt: new Date().toISOString(),
        });
        return;
      }

      this.updateJobStats(jobId, { totalEntities: entities.length });

      // Phase 2-5: Run validators
      const results: QAValidationResult[] = [];
      const batchSize = config.batchSize ?? DEFAULT_QA_CONFIG.batchSize;
      const delayBetweenBatches = config.delayBetweenBatches ?? DEFAULT_QA_CONFIG.delayBetweenBatches;

      for (let i = 0; i < entities.length; i += batchSize) {
        // Check if job was cancelled
        if (!this.runningJobs.has(jobId)) {
          return;
        }

        const batch = entities.slice(i, i + batchSize);
        const batchNum = Math.floor(i / batchSize) + 1;
        const totalBatches = Math.ceil(entities.length / batchSize);

        this.updateJobStatus(jobId, {
          phase: 'validating_artists',
          message: `Processing batch ${batchNum}/${totalBatches}...`,
          progress: Math.round((i / entities.length) * 100),
        });

        // Process batch
        for (const entity of batch) {
          if (!this.runningJobs.has(jobId)) return;

          try {
            const result = await this.validateEntity(entity, config);
            results.push(result);

            // Update stats
            this.updateStatsFromResult(jobId, result);
          } catch (error) {
            const job = this.jobs.get(jobId);
            if (job) {
              job.stats.errors.push(
                `Error validating ${entity.name}: ${error instanceof Error ? error.message : String(error)}`
              );
            }
          }
        }

        // Rate limiting delay between batches
        if (i + batchSize < entities.length) {
          await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
        }
      }

      // Phase 6: Generate report
      this.updateJobStatus(jobId, {
        phase: 'generating_report',
        message: 'Generating validation report...',
        progress: 95,
      });

      const report = this.generateReport(jobId, config, results);
      this.reports.set(jobId, report);

      // Complete
      this.updateJobStatus(jobId, {
        phase: 'completed',
        message: `Validation complete. ${results.length} entities processed.`,
        progress: 100,
        completedAt: new Date().toISOString(),
      });
    } finally {
      this.runningJobs.delete(jobId);
    }
  }

  /**
   * Fetch entities to validate based on config
   */
  private async fetchEntitiesToValidate(config: QAValidationConfig): Promise<PosterEntity[]> {
    // If specific entity IDs provided, fetch those
    if (config.entityIds && config.entityIds.length > 0) {
      const entities: PosterEntity[] = [];
      for (const id of config.entityIds) {
        const result = await this.entityService.getEntity(id);
        if (result.success && result.data) {
          entities.push(result.data as PosterEntity);
        }
      }
      return entities;
    }

    // Otherwise, search for entities matching criteria
    const entityTypes = config.entityTypes ?? ['Poster'];
    const entities: PosterEntity[] = [];

    for (const entityType of entityTypes) {
      // searchEntities takes a query string and options object
      const searchResult = await this.entityService.searchEntities('', {
        entityTypes: [entityType],
        limit: 1000, // Adjust as needed
      });

      if (searchResult.success && searchResult.data) {
        // searchResult.data is a KnowledgeGraph with entities array
        const knowledgeGraph = searchResult.data;
        for (const entity of knowledgeGraph.entities) {
          const posterEntity = entity as PosterEntity;

          // Filter by poster type if specified
          if (
            config.posterTypes &&
            config.posterTypes.length > 0 &&
            posterEntity.poster_type &&
            !config.posterTypes.includes(posterEntity.poster_type)
          ) {
            continue;
          }

          entities.push(posterEntity);
        }
      }
    }

    return entities;
  }

  /**
   * Parse observations array into structured fields on the entity.
   * Observations are stored as strings like "Headliner: Artist Name"
   * This extracts them into direct properties for validators to use.
   */
  private enrichEntityFromObservations(entity: PosterEntity): PosterEntity {
    const enriched = { ...entity };
    const observations = entity.observations || [];

    for (const obs of observations) {
      // Match patterns like "Field name: value"
      const match = obs.match(/^([^:]+):\s*(.+)$/i);
      if (!match) continue;

      const rawKey = match[1].toLowerCase().trim();
      const value = match[2].trim();

      // Skip empty or placeholder values
      if (!value || value.toLowerCase() === 'not specified' ||
          value.toLowerCase() === 'not applicable' ||
          value.toLowerCase() === 'none' ||
          value.toLowerCase() === 'not visible' ||
          value.toLowerCase() === 'not shown') {
        continue;
      }

      // Map observation keys to entity properties
      switch (rawKey) {
        case 'poster type':
          // Cast to expected type (validation happens elsewhere)
          if (!enriched.poster_type) enriched.poster_type = value as PosterEntity['poster_type'];
          break;
        case 'title':
          if (!enriched.title) enriched.title = value;
          break;
        case 'headliner':
          if (!enriched.headliner) enriched.headliner = value;
          break;
        case 'supporting acts':
          if (!enriched.supporting_acts || enriched.supporting_acts.length === 0) {
            // Try to split by comma
            enriched.supporting_acts = value.split(',').map(s => s.trim()).filter(s => s);
          }
          break;
        case 'venue':
          if (!enriched.venue_name) enriched.venue_name = value;
          break;
        case 'city':
          if (!enriched.city) enriched.city = value;
          break;
        case 'state':
          if (!enriched.state) enriched.state = value;
          break;
        case 'event date':
          if (!enriched.event_date) enriched.event_date = value;
          break;
        case 'year': {
          // Parse year as number
          const yearNum = parseInt(value, 10);
          if (!isNaN(yearNum) && !enriched.year) enriched.year = yearNum;
          break;
        }
        case 'decade':
          if (!enriched.decade) enriched.decade = value;
          break;
        case 'ticket price':
          if (!enriched.ticket_price) enriched.ticket_price = value;
          break;
        case 'door time':
          if (!enriched.door_time) enriched.door_time = value;
          break;
        case 'show time':
          if (!enriched.show_time) enriched.show_time = value;
          break;
        case 'age restriction':
          if (!enriched.age_restriction) enriched.age_restriction = value;
          break;
        case 'visual style':
          if (!enriched.visual_elements) enriched.visual_elements = {} as PosterEntity['visual_elements'];
          if (enriched.visual_elements && !enriched.visual_elements.style) {
            enriched.visual_elements.style = value as NonNullable<PosterEntity['visual_elements']>['style'];
          }
          break;
      }
    }

    return enriched;
  }

  /**
   * Validate a single entity using all applicable validators
   */
  private async validateEntity(
    entity: PosterEntity,
    config: QAValidationConfig
  ): Promise<QAValidationResult> {
    const startTime = Date.now();
    const allResults: ValidatorResult[] = [];
    const suggestions: QASuggestion[] = [];

    // Enrich entity with structured fields from observations
    const enrichedEntity = this.enrichEntityFromObservations(entity);

    const context: ValidationContext = {
      config,
      posterType: enrichedEntity.poster_type,
    };

    // Determine which validators to run
    const validatorsToRun = config.validators ?? DEFAULT_QA_CONFIG.validators;

    // Run each validator
    for (const validatorName of validatorsToRun) {
      const validator = this.validators.get(validatorName);
      if (!validator) continue;

      // Check if validator supports this entity type
      if (!validator.supportsEntityType(enrichedEntity.entityType)) continue;

      try {
        const results = await validator.validate(enrichedEntity, context);
        allResults.push(...results);

        // Extract suggestions from mismatches and partial matches
        for (const result of results) {
          if (
            (result.status === 'mismatch' || result.status === 'partial') &&
            result.validatedValue &&
            result.validatedValue !== result.originalValue
          ) {
            suggestions.push({
              field: result.field,
              currentValue: result.originalValue,
              suggestedValue: result.validatedValue,
              reason: result.message ?? 'External source suggests different value',
              confidence: result.confidence,
              source: result.source,
              externalId: result.externalId,
            });
          }
        }
      } catch (error) {
        console.error(`Validator ${validatorName} failed for entity ${entity.name}:`, error);
      }
    }

    // Calculate overall score and status
    const overallScore = calculateOverallScore(allResults);
    const status = determineOverallStatus(allResults);

    // Extract external matches
    const externalMatches = allResults
      .filter(r => r.externalId && r.externalUrl)
      .map(r => ({
        source: r.source,
        externalId: r.externalId!,
        name: r.validatedValue ?? r.originalValue ?? '',
        matchScore: r.confidence,
        url: r.externalUrl!,
      }));

    return {
      entityId: entity.name,
      entityType: entity.entityType,
      overallScore,
      status,
      validatedAt: new Date().toISOString(),
      validatorResults: allResults,
      suggestions,
      externalMatches,
      processingTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Update job status
   */
  private updateJobStatus(
    jobId: string,
    updates: Partial<Omit<QAJobStatus, 'jobId' | 'config' | 'stats'>>
  ): void {
    const job = this.jobs.get(jobId);
    if (job) {
      Object.assign(job, updates, { updatedAt: new Date().toISOString() });
    }
  }

  /**
   * Update job statistics
   */
  private updateJobStats(jobId: string, updates: Partial<QAJobStats>): void {
    const job = this.jobs.get(jobId);
    if (job) {
      Object.assign(job.stats, updates);
      job.updatedAt = new Date().toISOString();
    }
  }

  /**
   * Update stats based on a validation result
   */
  private updateStatsFromResult(jobId: string, result: QAValidationResult): void {
    const job = this.jobs.get(jobId);
    if (!job) return;

    job.stats.processedEntities++;

    switch (result.status) {
      case 'validated':
        job.stats.validatedCount++;
        break;
      case 'warning':
        job.stats.warningCount++;
        break;
      case 'mismatch':
        job.stats.mismatchCount++;
        break;
      case 'unverified':
        job.stats.unverifiedCount++;
        break;
    }

    // Update average score
    const totalScore =
      job.stats.averageScore * (job.stats.processedEntities - 1) + result.overallScore;
    job.stats.averageScore = Math.round(totalScore / job.stats.processedEntities);

    job.updatedAt = new Date().toISOString();
  }

  /**
   * Apply a single fix to an entity
   */
  async applyFix(
    entityId: string,
    field: string,
    value: unknown
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Get the entity first to ensure it exists
      const entityResult = await this.entityService.getEntity(entityId);
      if (!entityResult.success || !entityResult.data) {
        return { success: false, error: `Entity not found: ${entityId}` };
      }

      // Update the entity with the new field value
      const updateResult = await this.entityService.updateEntity(entityId, {
        [field]: value,
      });

      if (!updateResult.success) {
        return { success: false, error: updateResult.errors?.join(', ') || 'Update failed' };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Apply multiple fixes in batch
   */
  async applyFixBatch(
    fixes: Array<{ entityId: string; field: string; value: unknown }>
  ): Promise<Array<{ entityId: string; field: string; success: boolean; error?: string }>> {
    const results: Array<{ entityId: string; field: string; success: boolean; error?: string }> = [];

    for (const fix of fixes) {
      const result = await this.applyFix(fix.entityId, fix.field, fix.value);
      results.push({
        entityId: fix.entityId,
        field: fix.field,
        success: result.success,
        error: result.error,
      });
    }

    return results;
  }

  /**
   * Apply a relationship fix (create, update, or delete a relationship)
   */
  async applyRelationshipFix(
    suggestion: QARelationshipSuggestion
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.relationService) {
      return { success: false, error: 'RelationService not configured' };
    }

    const now = Date.now();
    const relationData = {
      from: suggestion.fromEntity,
      to: suggestion.toEntity,
      relationType: suggestion.relationType,
      confidence: suggestion.suggestedMetadata?.confidence,
      metadata: {
        createdAt: now,
        updatedAt: now,
        source: suggestion.suggestedMetadata?.source,
        evidence: suggestion.suggestedMetadata?.evidence,
        inferred_by: suggestion.suggestedMetadata?.inferred_by || 'QAValidationService',
        inferred_at: new Date().toISOString(),
        is_primary: suggestion.suggestedMetadata?.is_primary ?? true,
      },
    };

    try {
      switch (suggestion.operation) {
        case 'create': {
          const createResult = await this.relationService.createRelations([relationData]);
          return createResult.success
            ? { success: true }
            : { success: false, error: createResult.errors?.join(', ') };
        }

        case 'update': {
          // For update, we delete the old relationship and create a new one
          // First, delete the existing relationship (if it exists)
          const existingRelation = await this.relationService.getRelation(
            suggestion.fromEntity,
            suggestion.toEntity,
            suggestion.relationType
          );

          if (existingRelation.success && existingRelation.data) {
            await this.relationService.deleteRelations([existingRelation.data]);
          }

          // Then create the new relationship
          const createResult = await this.relationService.createRelations([relationData]);
          return createResult.success
            ? { success: true }
            : { success: false, error: createResult.errors?.join(', ') };
        }

        case 'delete': {
          const existingRelation = await this.relationService.getRelation(
            suggestion.fromEntity,
            suggestion.toEntity,
            suggestion.relationType
          );

          if (!existingRelation.success || !existingRelation.data) {
            return { success: false, error: 'Relationship not found' };
          }

          const deleteResult = await this.relationService.deleteRelations([existingRelation.data]);
          return deleteResult.success
            ? { success: true }
            : { success: false, error: deleteResult.errors?.join(', ') };
        }

        default:
          return { success: false, error: `Unknown operation: ${suggestion.operation}` };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Apply multiple relationship fixes in batch
   */
  async applyRelationshipFixBatch(
    suggestions: QARelationshipSuggestion[]
  ): Promise<Array<{ fromEntity: string; toEntity: string; success: boolean; error?: string }>> {
    const results: Array<{ fromEntity: string; toEntity: string; success: boolean; error?: string }> = [];

    for (const suggestion of suggestions) {
      const result = await this.applyRelationshipFix(suggestion);
      results.push({
        fromEntity: suggestion.fromEntity,
        toEntity: suggestion.toEntity,
        success: result.success,
        error: result.error,
      });
    }

    return results;
  }

  /**
   * Generate a validation report
   */
  private generateReport(
    jobId: string,
    config: QAValidationConfig,
    results: QAValidationResult[]
  ): QAReport {
    const batchStats = calculateBatchStatistics(results);
    const topIssues = identifyTopIssues(results);
    const recommendations = generateRecommendations(results);

    // Calculate by entity type
    const byEntityType: Record<string, EntityTypeSummary> = {};
    const byPosterType: Record<string, EntityTypeSummary> = {};

    for (const result of results) {
      // By entity type
      if (!byEntityType[result.entityType]) {
        byEntityType[result.entityType] = {
          total: 0,
          validated: 0,
          warnings: 0,
          mismatches: 0,
          unverified: 0,
          averageScore: 0,
        };
      }
      const entityStats = byEntityType[result.entityType];
      entityStats.total++;
      if (result.status === 'validated') entityStats.validated++;
      else if (result.status === 'warning') entityStats.warnings++;
      else if (result.status === 'mismatch') entityStats.mismatches++;
      else entityStats.unverified++;
    }

    // Calculate average scores by type
    for (const type in byEntityType) {
      const typeResults = results.filter(r => r.entityType === type);
      const totalScore = typeResults.reduce((sum, r) => sum + r.overallScore, 0);
      byEntityType[type].averageScore = Math.round(totalScore / typeResults.length);
    }

    const summary: QAReportSummary = {
      totalEntities: batchStats.totalEntities,
      validatedCount: batchStats.validatedCount,
      warningCount: batchStats.warningCount,
      mismatchCount: batchStats.mismatchCount,
      unverifiedCount: batchStats.unverifiedCount,
      overallScore: batchStats.averageScore,
      byEntityType,
      byPosterType,
      topIssues,
      apiStats: {
        musicbrainz: { calls: 0, successes: 0, failures: 0 },
        discogs: { calls: 0, successes: 0, failures: 0 },
        tmdb: { calls: 0, successes: 0, failures: 0 },
      },
    };

    return {
      reportId: generateReportId(),
      jobId,
      generatedAt: new Date().toISOString(),
      config,
      summary,
      results,
      recommendations,
    };
  }
}
