/**
 * Iterative Processor
 *
 * Main orchestrator for the iterative poster processing pipeline.
 * Coordinates phase execution, manages state, and assembles final entities.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import {
  IterativeProcessingOptions,
  IterativeProcessingResult,
  IterativeBatchResult,
  ProcessingContext,
  TypePhaseResult,
  ArtistPhaseResult,
  VenuePhaseResult,
  EventPhaseResult,
  AssemblyPhaseResult,
  DEFAULT_ITERATIVE_OPTIONS,
  PosterType,
} from './types.js';
import { PosterEntity, TypeInference, VisionModelProvider } from '../types.js';
import { VisionModelFactory } from '../VisionModelFactory.js';
import { PhaseManager } from './PhaseManager.js';
import { TypePhase } from './phases/TypePhase.js';
import { ArtistPhase } from './phases/ArtistPhase.js';
import { VenuePhase } from './phases/VenuePhase.js';
import { EventPhase } from './phases/EventPhase.js';
import { PhaseInput } from './phases/BasePhase.js';
import { EntityService } from '../../core/services/EntityService.js';
import { RelationService } from '../../core/services/RelationService.js';
import { SearchService } from '../../core/services/SearchService.js';
import { ArtistValidator } from '../../qa-validation/validators/ArtistValidator.js';
import { MusicBrainzClient } from '../../qa-validation/clients/MusicBrainzClient.js';
import { DiscogsClient } from '../../qa-validation/clients/DiscogsClient.js';

/**
 * Dependencies for IterativeProcessor
 */
export interface IterativeProcessorDependencies {
  entityService?: EntityService;
  relationService?: RelationService;
  searchService?: SearchService;
  discogsToken?: string;
}

/**
 * Iterative Processor - Orchestrates multi-phase poster processing
 */
export class IterativeProcessor {
  private visionProvider: VisionModelProvider;
  private phaseManager: PhaseManager;
  private entityService?: EntityService;
  private relationService?: RelationService;
  private searchService?: SearchService;

  // Phase executors
  private typePhase: TypePhase;
  private artistPhase: ArtistPhase;
  private venuePhase: VenuePhase;
  private eventPhase: EventPhase;

  // Validators
  private artistValidator?: ArtistValidator;

  constructor(
    visionProvider?: VisionModelProvider,
    dependencies?: IterativeProcessorDependencies
  ) {
    this.visionProvider = visionProvider || VisionModelFactory.createDefault();
    this.phaseManager = new PhaseManager();
    this.entityService = dependencies?.entityService;
    this.relationService = dependencies?.relationService;
    this.searchService = dependencies?.searchService;

    // Initialize validators
    this.initializeValidators(dependencies?.discogsToken);

    // Initialize phase executors
    this.typePhase = new TypePhase(
      this.visionProvider,
      this.phaseManager,
      this.searchService
    );

    this.artistPhase = new ArtistPhase(
      this.visionProvider,
      this.phaseManager,
      this.entityService,
      this.artistValidator
    );

    this.venuePhase = new VenuePhase(
      this.visionProvider,
      this.phaseManager,
      this.entityService,
      this.searchService
    );

    this.eventPhase = new EventPhase(
      this.visionProvider,
      this.phaseManager,
      this.searchService
    );
  }

  /**
   * Initialize validators with API clients
   */
  private initializeValidators(discogsToken?: string): void {
    const musicBrainz = new MusicBrainzClient();
    const discogs = discogsToken ? new DiscogsClient(discogsToken) : undefined;

    this.artistValidator = new ArtistValidator(musicBrainz, discogs);
  }

  /**
   * Process a single image iteratively through all phases
   */
  async processImage(
    imagePath: string,
    options: Partial<IterativeProcessingOptions> = {}
  ): Promise<IterativeProcessingResult> {
    const startTime = Date.now();
    const mergedOptions: IterativeProcessingOptions = {
      ...DEFAULT_ITERATIVE_OPTIONS,
      ...options,
    };

    // Generate poster ID from file hash
    const posterId = this.generatePosterId(imagePath);

    // Check if file exists
    if (!fs.existsSync(imagePath)) {
      return {
        success: false,
        posterId,
        imagePath,
        phases: {},
        overallConfidence: 0,
        fieldsNeedingReview: [],
        processingTimeMs: Date.now() - startTime,
        error: `File not found: ${imagePath}`,
      };
    }

    // Create processing context
    const context = this.phaseManager.createContext(imagePath, posterId);

    try {
      // Use custom vision model if specified
      if (mergedOptions.modelKey) {
        this.switchVisionModel(mergedOptions.modelKey);
      }

      const phaseInput: PhaseInput = {
        imagePath,
        posterId,
        context,
        options: mergedOptions,
      };

      // Phase 1: Type Classification
      console.log(`[ITERATIVE] Phase 1: Type classification for ${posterId}`);
      const typeResult = await this.typePhase.execute(phaseInput);

      if (typeResult.status === 'failed') {
        return this.createFailedResult(posterId, imagePath, typeResult, startTime);
      }

      // Phase 2: Artist Extraction
      console.log(`[ITERATIVE] Phase 2: Artist extraction for ${posterId}`);
      const artistResult = await this.artistPhase.execute(phaseInput);

      // Phase 3: Venue Extraction
      console.log(`[ITERATIVE] Phase 3: Venue extraction for ${posterId}`);
      const venueResult = await this.venuePhase.execute(phaseInput);

      // Phase 4: Event/Date Extraction
      console.log(`[ITERATIVE] Phase 4: Event extraction for ${posterId}`);
      const eventResult = await this.eventPhase.execute(phaseInput);

      // Phase 5: Assembly
      console.log(`[ITERATIVE] Phase 5: Assembly for ${posterId}`);
      const assemblyResult = await this.assembleEntity(
        posterId,
        imagePath,
        context,
        typeResult,
        artistResult,
        venueResult,
        eventResult,
        mergedOptions
      );

      // Calculate overall metrics
      const overallConfidence = this.phaseManager.calculateOverallConfidence(context.sessionId);
      const fieldsNeedingReview = this.phaseManager.getFieldsNeedingReview(context.sessionId);

      return {
        success: assemblyResult.status === 'completed',
        posterId,
        imagePath,
        entity: assemblyResult.entity,
        phases: {
          type: typeResult,
          artist: artistResult,
          venue: venueResult,
          event: eventResult,
          assembly: assemblyResult,
        },
        overallConfidence,
        fieldsNeedingReview,
        processingTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        posterId,
        imagePath,
        phases: {},
        overallConfidence: 0,
        fieldsNeedingReview: [],
        processingTimeMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      // Cleanup context after processing
      this.phaseManager.removeContext(context.sessionId);
    }
  }

  /**
   * Process multiple images in batch
   */
  async processBatch(
    imagePaths: string[],
    options: Partial<IterativeProcessingOptions> = {},
    onProgress?: (completed: number, total: number, current: string) => void
  ): Promise<IterativeBatchResult> {
    const startTime = Date.now();
    const jobId = `batch_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;

    const results: IterativeProcessingResult[] = [];
    const byType: Record<PosterType, number> = {
      concert: 0,
      festival: 0,
      comedy: 0,
      theater: 0,
      film: 0,
      album: 0,
      promo: 0,
      exhibition: 0,
      hybrid: 0,
      unknown: 0,
    };

    for (let i = 0; i < imagePaths.length; i++) {
      const imagePath = imagePaths[i];

      if (onProgress) {
        onProgress(i, imagePaths.length, imagePath);
      }

      const result = await this.processImage(imagePath, options);
      results.push(result);

      // Track by type
      if (result.phases.type?.primaryType.type) {
        byType[result.phases.type.primaryType.type]++;
      }

      // Small delay between images to avoid overwhelming vision model
      if (i < imagePaths.length - 1) {
        await this.delay(100);
      }
    }

    // Calculate summary
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const needsReview = results.filter(r => r.fieldsNeedingReview.length > 0).length;
    const totalConfidence = results.reduce((sum, r) => sum + r.overallConfidence, 0);
    const averageConfidence = results.length > 0 ? totalConfidence / results.length : 0;

    return {
      jobId,
      results,
      summary: {
        total: imagePaths.length,
        successful,
        failed,
        needsReview,
        averageConfidence,
        byType,
      },
      processingTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Assemble final entity from all phase results
   */
  private async assembleEntity(
    posterId: string,
    imagePath: string,
    context: ProcessingContext,
    typeResult: TypePhaseResult,
    artistResult: ArtistPhaseResult,
    venueResult: VenuePhaseResult,
    eventResult: EventPhaseResult,
    options: IterativeProcessingOptions
  ): Promise<AssemblyPhaseResult> {
    const startTime = Date.now();

    try {
      // Build inferred types for HAS_TYPE relationships
      const inferredTypes: TypeInference[] = typeResult.secondaryTypes || [{
        type_key: typeResult.primaryType.type,
        confidence: typeResult.primaryType.confidence,
        source: 'vision',
        evidence: typeResult.primaryType.evidence.join('; '),
        is_primary: true,
      }];

      // Build the poster entity
      const entity: PosterEntity = {
        name: posterId,
        entityType: 'Poster',
        poster_type: typeResult.primaryType.type,
        inferred_types: inferredTypes,
        title: undefined, // Would come from more detailed extraction
        headliner: artistResult.headliner?.validatedName ?? artistResult.headliner?.extractedName,
        supporting_acts: artistResult.supportingActs?.map(
          a => a.validatedName ?? a.extractedName
        ),
        venue_name: venueResult.venue?.validatedName ?? venueResult.venue?.extractedName,
        city: venueResult.venue?.city,
        state: venueResult.venue?.state,
        country: venueResult.venue?.country,
        event_date: eventResult.eventDate?.rawValue,
        year: eventResult.year,
        decade: eventResult.decade,
        door_time: eventResult.timeDetails?.doorTime,
        show_time: eventResult.timeDetails?.showTime,
        ticket_price: eventResult.ticketPrice,
        age_restriction: eventResult.ageRestriction,
        promoter: eventResult.promoter,
        tour_name: artistResult.tourName,
        record_label: artistResult.recordLabel,
        extracted_text: typeResult.extractedText,
        visual_elements: {
          has_artist_photo: typeResult.visualCues.hasArtistPhoto,
          has_album_artwork: typeResult.visualCues.hasAlbumArtwork,
          has_logo: typeResult.visualCues.hasLogo,
          dominant_colors: typeResult.visualCues.dominantColors,
          style: typeResult.visualCues.style,
        },
        observations: this.buildObservations(typeResult, artistResult, venueResult, eventResult),
        metadata: {
          source_image_url: `file://${imagePath}`,
          source_image_hash: this.generateHash(imagePath),
          original_filename: path.basename(imagePath),
          file_size_bytes: fs.statSync(imagePath).size,
          vision_model: this.visionProvider.getModelInfo().name,
          processing_time_ms:
            typeResult.processingTimeMs +
            artistResult.processingTimeMs +
            venueResult.processingTimeMs +
            eventResult.processingTimeMs,
          extraction_confidence: this.phaseManager.calculateOverallConfidence(context.sessionId),
          processing_date: new Date().toISOString(),
        },
      };

      // Track created entities and relationships
      const entitiesCreated: AssemblyPhaseResult['entitiesCreated'] = [];
      const relationshipsCreated: AssemblyPhaseResult['relationshipsCreated'] = [];

      // Store entity if we have entity service
      if (this.entityService && !options.skipStorage) {
        const createResult = await this.entityService.createEntities([entity]);
        if (createResult.success) {
          entitiesCreated.push({
            type: 'Poster',
            name: posterId,
            isNew: true,
          });

          // Create related entities (Artist, Venue) and relationships
          const relatedEntities = await this.createRelatedEntities(
            entity,
            artistResult,
            venueResult
          );

          entitiesCreated.push(...relatedEntities.entities);
          relationshipsCreated.push(...relatedEntities.relationships);
        }
      }

      // Determine fields needing review
      const fieldsNeedingReview: string[] = [];
      if (typeResult.status === 'needs_review') fieldsNeedingReview.push('poster_type');
      if (artistResult.status === 'needs_review') fieldsNeedingReview.push('headliner');
      if (venueResult.status === 'needs_review') fieldsNeedingReview.push('venue');
      if (eventResult.status === 'needs_review') fieldsNeedingReview.push('event_date');

      const overallConfidence = this.phaseManager.calculateOverallConfidence(context.sessionId);

      const result: AssemblyPhaseResult = {
        posterId,
        imagePath,
        phase: 'assembly',
        status: fieldsNeedingReview.length === 0 ? 'completed' : 'needs_review',
        confidence: overallConfidence,
        processingTimeMs: Date.now() - startTime,
        entity,
        relationshipsCreated,
        entitiesCreated,
        overallConfidence,
        fieldsNeedingReview,
      };

      this.phaseManager.storePhaseResult(context.sessionId, result);

      return result;
    } catch (error) {
      return {
        posterId,
        imagePath,
        phase: 'assembly',
        status: 'failed',
        confidence: 0,
        processingTimeMs: Date.now() - startTime,
        entity: {} as PosterEntity,
        relationshipsCreated: [],
        entitiesCreated: [],
        overallConfidence: 0,
        fieldsNeedingReview: [],
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  /**
   * Create related entities (Artist, Venue) and relationships
   */
  private async createRelatedEntities(
    posterEntity: PosterEntity,
    artistResult: ArtistPhaseResult,
    venueResult: VenuePhaseResult
  ): Promise<{
    entities: AssemblyPhaseResult['entitiesCreated'];
    relationships: AssemblyPhaseResult['relationshipsCreated'];
  }> {
    const entities: AssemblyPhaseResult['entitiesCreated'] = [];
    const relationships: AssemblyPhaseResult['relationshipsCreated'] = [];

    if (!this.entityService || !this.relationService) {
      return { entities, relationships };
    }

    try {
      // Create headliner artist entity
      if (artistResult.headliner) {
        const artistName = artistResult.headliner.validatedName ?? artistResult.headliner.extractedName;
        const artistId = `artist_${artistName.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;

        // Check if artist exists
        const existingArtist = await this.entityService.getEntity(artistId);
        const isNew = !existingArtist.success;

        if (isNew) {
          await this.entityService.createEntities([{
            name: artistId,
            entityType: 'Artist',
            observations: [
              `Name: ${artistName}`,
              artistResult.headliner.externalId
                ? `MusicBrainz ID: ${artistResult.headliner.externalId}`
                : '',
            ].filter(o => o),
          }]);
        }

        entities.push({ type: 'Artist', name: artistId, isNew });

        // Create HEADLINED_ON relationship
        await this.relationService.createRelations([{
          from: artistId,
          to: posterEntity.name,
          relationType: 'HEADLINED_ON',
        }]);

        relationships.push({
          type: 'HEADLINED_ON',
          from: artistId,
          to: posterEntity.name,
        });
      }

      // Create supporting artist entities
      if (artistResult.supportingActs) {
        for (const act of artistResult.supportingActs) {
          const actName = act.validatedName ?? act.extractedName;
          const actId = `artist_${actName.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;

          const existingArtist = await this.entityService.getEntity(actId);
          const isNew = !existingArtist.success;

          if (isNew) {
            await this.entityService.createEntities([{
              name: actId,
              entityType: 'Artist',
              observations: [`Name: ${actName}`],
            }]);
          }

          entities.push({ type: 'Artist', name: actId, isNew });

          await this.relationService.createRelations([{
            from: actId,
            to: posterEntity.name,
            relationType: 'PERFORMED_ON',
          }]);

          relationships.push({
            type: 'PERFORMED_ON',
            from: actId,
            to: posterEntity.name,
          });
        }
      }

      // Create venue entity
      if (venueResult.venue) {
        const venueName = venueResult.venue.validatedName ?? venueResult.venue.extractedName;
        const venueId = venueResult.venue.existingVenueId ||
          `venue_${venueName.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;

        const existingVenue = await this.entityService.getEntity(venueId);
        const isNew = !existingVenue.success;

        if (isNew) {
          await this.entityService.createEntities([{
            name: venueId,
            entityType: 'Venue',
            observations: [
              `Name: ${venueName}`,
              venueResult.venue.city ? `City: ${venueResult.venue.city}` : '',
              venueResult.venue.state ? `State: ${venueResult.venue.state}` : '',
            ].filter(o => o),
          }]);
        }

        entities.push({ type: 'Venue', name: venueId, isNew });

        await this.relationService.createRelations([{
          from: posterEntity.name,
          to: venueId,
          relationType: 'ADVERTISES_VENUE',
        }]);

        relationships.push({
          type: 'ADVERTISES_VENUE',
          from: posterEntity.name,
          to: venueId,
        });
      }

      // Create HAS_TYPE relationships for inferred types
      if (posterEntity.inferred_types) {
        for (const typeInference of posterEntity.inferred_types) {
          const typeId = `poster_type_${typeInference.type_key}`;

          // Ensure type entity exists
          const existingType = await this.entityService.getEntity(typeId);
          if (!existingType.success) {
            await this.entityService.createEntities([{
              name: typeId,
              entityType: 'PosterType',
              observations: [`Type: ${typeInference.type_key}`],
            }]);
            entities.push({ type: 'PosterType', name: typeId, isNew: true });
          }

          const now = Date.now();
          await this.relationService.createRelations([{
            from: posterEntity.name,
            to: typeId,
            relationType: 'HAS_TYPE',
            confidence: typeInference.confidence,
            metadata: {
              createdAt: now,
              updatedAt: now,
              source: typeInference.source,
              evidence: typeInference.evidence,
              is_primary: typeInference.is_primary,
            },
          }]);

          relationships.push({
            type: 'HAS_TYPE',
            from: posterEntity.name,
            to: typeId,
          });
        }
      }
    } catch (error) {
      console.error('[ASSEMBLY] Error creating related entities:', error);
    }

    return { entities, relationships };
  }

  /**
   * Build observations array from phase results
   */
  private buildObservations(
    typeResult: TypePhaseResult,
    artistResult: ArtistPhaseResult,
    venueResult: VenuePhaseResult,
    eventResult: EventPhaseResult
  ): string[] {
    const observations: string[] = [];

    // Type observations
    observations.push(`Poster type: ${typeResult.primaryType.type}`);
    if (typeResult.visualCues.style) {
      observations.push(`Visual style: ${typeResult.visualCues.style}`);
    }

    // Artist observations
    if (artistResult.headliner) {
      observations.push(`Headliner: ${artistResult.headliner.validatedName ?? artistResult.headliner.extractedName}`);
      if (artistResult.headliner.externalId) {
        observations.push(`Headliner MusicBrainz ID: ${artistResult.headliner.externalId}`);
      }
    }
    if (artistResult.supportingActs && artistResult.supportingActs.length > 0) {
      const acts = artistResult.supportingActs.map(a => a.validatedName ?? a.extractedName);
      observations.push(`Supporting acts: ${acts.join(', ')}`);
    }
    if (artistResult.tourName) {
      observations.push(`Tour name: ${artistResult.tourName}`);
    }

    // Venue observations
    if (venueResult.venue) {
      observations.push(`Venue: ${venueResult.venue.validatedName ?? venueResult.venue.extractedName}`);
      if (venueResult.venue.city) {
        observations.push(`City: ${venueResult.venue.city}`);
      }
      if (venueResult.venue.state) {
        observations.push(`State: ${venueResult.venue.state}`);
      }
    }

    // Event observations
    if (eventResult.eventDate) {
      observations.push(`Event date: ${eventResult.eventDate.rawValue}`);
    }
    if (eventResult.year) {
      observations.push(`Year: ${eventResult.year}`);
    }
    if (eventResult.timeDetails?.doorTime) {
      observations.push(`Door time: ${eventResult.timeDetails.doorTime}`);
    }
    if (eventResult.timeDetails?.showTime) {
      observations.push(`Show time: ${eventResult.timeDetails.showTime}`);
    }
    if (eventResult.ticketPrice) {
      observations.push(`Ticket price: ${eventResult.ticketPrice}`);
    }

    return observations;
  }

  /**
   * Create a failed result
   */
  private createFailedResult(
    posterId: string,
    imagePath: string,
    typeResult: TypePhaseResult,
    startTime: number
  ): IterativeProcessingResult {
    return {
      success: false,
      posterId,
      imagePath,
      phases: { type: typeResult },
      overallConfidence: 0,
      fieldsNeedingReview: [],
      processingTimeMs: Date.now() - startTime,
      error: typeResult.errors?.join('; ') || 'Type classification failed',
    };
  }

  /**
   * Generate poster ID from file hash
   */
  private generatePosterId(imagePath: string): string {
    const hash = this.generateHash(imagePath);
    return `poster_${hash}`;
  }

  /**
   * Generate hash from file content
   */
  private generateHash(filePath: string): string {
    const fileBuffer = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(fileBuffer).digest('hex').slice(0, 16);
  }

  /**
   * Switch vision model
   */
  switchVisionModel(modelKey: string): void {
    this.visionProvider = VisionModelFactory.createByName(modelKey);

    // Update phases with new provider
    this.typePhase = new TypePhase(
      this.visionProvider,
      this.phaseManager,
      this.searchService
    );
    this.artistPhase = new ArtistPhase(
      this.visionProvider,
      this.phaseManager,
      this.entityService,
      this.artistValidator
    );
    this.venuePhase = new VenuePhase(
      this.visionProvider,
      this.phaseManager,
      this.entityService,
      this.searchService
    );
    this.eventPhase = new EventPhase(
      this.visionProvider,
      this.phaseManager,
      this.searchService
    );
  }

  /**
   * Get current vision model info
   */
  getVisionModelInfo(): { name: string; provider: string; parameters?: string } {
    return this.visionProvider.getModelInfo();
  }

  /**
   * Health check for all services
   */
  async healthCheck(): Promise<{
    vision: boolean;
    validators: Record<string, boolean>;
  }> {
    const visionOk = await this.visionProvider.healthCheck();
    const artistValidatorOk = this.artistValidator
      ? await this.artistValidator.healthCheck()
      : false;

    return {
      vision: visionOk,
      validators: {
        artist: artistValidatorOk,
      },
    };
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Create an IterativeProcessor with default configuration
 */
export async function createIterativeProcessor(
  dependencies?: IterativeProcessorDependencies
): Promise<IterativeProcessor> {
  return new IterativeProcessor(undefined, dependencies);
}
