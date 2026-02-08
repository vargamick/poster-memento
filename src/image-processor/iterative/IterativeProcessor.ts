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
  ArtistMatch,
  VenuePhaseResult,
  VenueMatch,
  EventPhaseResult,
  ShowInfo,
  AssemblyPhaseResult,
  DEFAULT_ITERATIVE_OPTIONS,
  PosterType,
  ConsensusOptions,
} from './types.js';
import { ConsensusProcessor, ConsensusResult } from '../consensus/ConsensusProcessor.js';
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
import { EnrichmentPhase, EnrichmentPhaseResult } from './phases/EnrichmentPhase.js';
import { reviewExtractedData, applyCorrections, ReviewResult } from '../ReviewPhase.js';

/**
 * Dependencies for IterativeProcessor
 */
export interface IterativeProcessorDependencies {
  entityService?: EntityService;
  relationService?: RelationService;
  searchService?: SearchService;
  discogsToken?: string;
  tmdbApiKey?: string;
  enableEnrichment?: boolean;
  enableReview?: boolean;
  /** Default consensus configuration */
  consensusConfig?: Partial<ConsensusOptions>;
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

  // Enrichment and Review phases
  private enrichmentPhase?: EnrichmentPhase;
  private enableEnrichment: boolean;
  private enableReview: boolean;

  // Consensus processing
  private consensusProcessor?: ConsensusProcessor;
  private defaultConsensusConfig?: Partial<ConsensusOptions>;

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

    // Initialize enrichment phase
    this.enableEnrichment = dependencies?.enableEnrichment ?? true;
    this.enableReview = dependencies?.enableReview ?? true;
    if (this.enableEnrichment) {
      this.enrichmentPhase = new EnrichmentPhase(
        this.phaseManager,
        dependencies?.tmdbApiKey || process.env.TMDB_API_KEY,
        dependencies?.discogsToken || process.env.DISCOGS_TOKEN
      );
    }

    // Store default consensus config for later use
    this.defaultConsensusConfig = dependencies?.consensusConfig;

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

    // Check if consensus mode is enabled - delegate to consensus processor
    const consensusConfig = mergedOptions.consensus || this.defaultConsensusConfig;
    if (consensusConfig?.enabled && consensusConfig.models?.length >= 2) {
      return this.processWithConsensus(imagePath, options);
    }

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

      // Phase 5: Assembly (initial)
      console.log(`[ITERATIVE] Phase 5: Assembly for ${posterId}`);
      let assemblyResult = await this.assembleEntity(
        posterId,
        imagePath,
        context,
        typeResult,
        artistResult,
        venueResult,
        eventResult,
        mergedOptions
      );

      // Phase 6: Enrichment (optional - enriches from external APIs)
      let enrichmentResult: EnrichmentPhaseResult | undefined;
      let enrichedArtistResult = artistResult;
      if (this.enableEnrichment && this.enrichmentPhase && assemblyResult.entity) {
        console.log(`[ITERATIVE] Phase 6: Enrichment for ${posterId}`);
        enrichmentResult = await this.enrichmentPhase.execute(
          assemblyResult.entity,
          artistResult,
          context
        );

        if (enrichmentResult.status === 'completed' || enrichmentResult.status === 'partial') {
          // Update entity with enriched data
          assemblyResult.entity = {
            ...assemblyResult.entity,
            ...enrichmentResult.enrichedEntity,
          };
          enrichedArtistResult = enrichmentResult.enhancedArtistResult || artistResult;

          // Log enrichment results
          if (enrichmentResult.enrichedFields.length > 0) {
            console.log(`[ITERATIVE] Enriched fields: ${enrichmentResult.enrichedFields.join(', ')}`);
          }
        }
      }

      // Phase 7: Review (optional - LLM self-review for quality)
      let reviewResult: ReviewResult | undefined;
      if (this.enableReview && assemblyResult.entity) {
        console.log(`[ITERATIVE] Phase 7: Review for ${posterId}`);
        reviewResult = await reviewExtractedData(
          imagePath,
          assemblyResult.entity,
          this.visionProvider
        );

        if (reviewResult.corrections.length > 0) {
          console.log(`[ITERATIVE] Review found ${reviewResult.corrections.length} corrections`);
          assemblyResult.entity = applyCorrections(assemblyResult.entity, reviewResult) as PosterEntity;
        }
      }

      // Re-create related entities if we enriched film data (director, cast)
      if (enrichmentResult && enrichedArtistResult !== artistResult) {
        // Update artist-related entities with enriched data (director, cast for films)
        const updatedRelated = await this.createRelatedEntities(
          assemblyResult.entity!,
          enrichedArtistResult,
          venueResult,
          eventResult
        );

        // Append new entities/relationships (don't duplicate)
        for (const ent of updatedRelated.entities) {
          if (!assemblyResult.entitiesCreated?.some(e => e.name === ent.name)) {
            assemblyResult.entitiesCreated?.push(ent);
          }
        }
        for (const rel of updatedRelated.relationships) {
          if (!assemblyResult.relationshipsCreated?.some(r =>
            r.from === rel.from && r.to === rel.to && r.type === rel.type
          )) {
            assemblyResult.relationshipsCreated?.push(rel);
          }
        }
      }

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
          enrichment: enrichmentResult,
          review: reviewResult,
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
        event_dates: eventResult.shows?.map(s => s.date.rawValue),
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

          // Create related entities based on poster type
          const relatedEntities = await this.createRelatedEntities(
            entity,
            artistResult,
            venueResult,
            eventResult
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
   * Create related entities and relationships based on poster type
   */
  private async createRelatedEntities(
    posterEntity: PosterEntity,
    artistResult: ArtistPhaseResult,
    venueResult: VenuePhaseResult,
    eventResult?: EventPhaseResult
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
      const posterType = posterEntity.poster_type;

      // Route to type-specific entity creation
      switch (posterType) {
        case 'album':
        case 'hybrid':
          await this.createAlbumEntities(
            posterEntity, artistResult, eventResult, entities, relationships
          );
          if (posterType === 'hybrid') {
            // Hybrid also creates event entities
            await this.createEventEntities(
              posterEntity, artistResult, venueResult, eventResult, entities, relationships
            );
          }
          break;

        case 'film':
          await this.createFilmEntities(
            posterEntity, artistResult, eventResult, entities, relationships
          );
          break;

        case 'concert':
        case 'festival':
        case 'comedy':
        case 'theater':
          await this.createEventEntities(
            posterEntity, artistResult, venueResult, eventResult, entities, relationships
          );
          break;

        default:
          // For promo, exhibition, unknown - use basic artist/venue creation
          await this.createBasicEntities(
            posterEntity, artistResult, venueResult, entities, relationships
          );
      }

      // Create HAS_TYPE relationships for all poster types
      await this.createTypeRelationships(posterEntity, entities, relationships);

    } catch (error) {
      console.error('[ASSEMBLY] Error creating related entities:', error);
    }

    return { entities, relationships };
  }

  /**
   * Create Album entity and relationships for album/release posters
   */
  private async createAlbumEntities(
    posterEntity: PosterEntity,
    artistResult: ArtistPhaseResult,
    eventResult: EventPhaseResult | undefined,
    entities: AssemblyPhaseResult['entitiesCreated'],
    relationships: AssemblyPhaseResult['relationshipsCreated']
  ): Promise<void> {
    if (!this.entityService || !this.relationService) return;

    // Create artist entity first
    let headlinerArtistId: string | undefined;
    if (artistResult.headliner) {
      headlinerArtistId = await this.createArtistEntity(artistResult.headliner, entities);
    }

    // Create Album entity
    const albumTitle = posterEntity.title || artistResult.recordLabel || posterEntity.name;
    const albumId = `album_${albumTitle.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${Date.now().toString(36)}`;

    const albumObservations: string[] = [
      `Title: ${albumTitle}`,
      posterEntity.year ? `Release Year: ${posterEntity.year}` : '',
      artistResult.recordLabel ? `Record Label: ${artistResult.recordLabel}` : '',
      eventResult?.eventDate?.rawValue ? `Release Date: ${eventResult.eventDate.rawValue}` : '',
    ].filter(o => o);

    await this.entityService.createEntities([{
      name: albumId,
      entityType: 'Album',
      observations: albumObservations,
    }]);

    entities.push({ type: 'Album', name: albumId, isNew: true });

    // Create ADVERTISES_ALBUM relationship (Poster → Album)
    await this.relationService.createRelations([{
      from: posterEntity.name,
      to: albumId,
      relationType: 'ADVERTISES_ALBUM',
    }]);
    relationships.push({ type: 'ADVERTISES_ALBUM', from: posterEntity.name, to: albumId });

    // Create CREATED_BY relationship (Album → Artist)
    if (headlinerArtistId) {
      await this.relationService.createRelations([{
        from: albumId,
        to: headlinerArtistId,
        relationType: 'CREATED_BY',
      }]);
      relationships.push({ type: 'CREATED_BY', from: albumId, to: headlinerArtistId });

      // Also create HEADLINED_ON for the poster
      await this.relationService.createRelations([{
        from: headlinerArtistId,
        to: posterEntity.name,
        relationType: 'HEADLINED_ON',
      }]);
      relationships.push({ type: 'HEADLINED_ON', from: headlinerArtistId, to: posterEntity.name });
    }

    // Create Organization (record label) and RELEASED_BY relationship
    if (artistResult.recordLabel) {
      const labelId = `org_${artistResult.recordLabel.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;

      const existingLabel = await this.entityService.getEntity(labelId);
      if (!existingLabel.success) {
        await this.entityService.createEntities([{
          name: labelId,
          entityType: 'Organization',
          observations: [
            `Name: ${artistResult.recordLabel}`,
            'Type: record_label',
          ],
        }]);
        entities.push({ type: 'Organization', name: labelId, isNew: true });
      } else {
        entities.push({ type: 'Organization', name: labelId, isNew: false });
      }

      await this.relationService.createRelations([{
        from: albumId,
        to: labelId,
        relationType: 'RELEASED_BY',
      }]);
      relationships.push({ type: 'RELEASED_BY', from: albumId, to: labelId });
    }

    // Create featured artists
    if (artistResult.supportingActs) {
      for (const featArtist of artistResult.supportingActs) {
        const featArtistId = await this.createArtistEntity(featArtist, entities);

        const now = Date.now();
        await this.relationService.createRelations([{
          from: albumId,
          to: featArtistId,
          relationType: 'CREATED_BY',
          metadata: { role: 'featured', createdAt: now, updatedAt: now },
        }]);
        relationships.push({ type: 'CREATED_BY', from: albumId, to: featArtistId });
      }
    }

    // Create Show entity for temporal searchability (year-based)
    const year = eventResult?.year ?? posterEntity.year;
    if (year && headlinerArtistId) {
      const artistSlug = (artistResult.headliner?.validatedName ?? artistResult.headliner?.extractedName ?? 'unknown')
        .toLowerCase().replace(/[^a-z0-9]/g, '_');
      const dateSlug = eventResult?.eventDate?.rawValue
        ? (eventResult.eventDate.year && eventResult.eventDate.month && eventResult.eventDate.day
            ? `${eventResult.eventDate.year}-${String(eventResult.eventDate.month).padStart(2, '0')}-${String(eventResult.eventDate.day).padStart(2, '0')}`
            : String(year))
        : String(year);
      const showId = `show_${artistSlug}_none_${dateSlug}`;

      const showObservations: string[] = [
        `Year: ${year}`,
        eventResult?.eventDate?.rawValue ? `Release Date: ${eventResult.eventDate.rawValue}` : '',
        `Artist: ${artistResult.headliner?.validatedName ?? artistResult.headliner?.extractedName}`,
        `Type: album release`,
      ].filter(o => o);

      const existingShow = await this.entityService.getEntity(showId);
      if (!existingShow.success) {
        await this.entityService.createEntities([{
          name: showId,
          entityType: 'Show',
          observations: showObservations,
        }]);
        entities.push({ type: 'Show', name: showId, isNew: true });
      } else {
        entities.push({ type: 'Show', name: showId, isNew: false });
      }

      await this.relationService.createRelations([{
        from: posterEntity.name,
        to: showId,
        relationType: 'ADVERTISES_SHOW',
      }]);
      relationships.push({ type: 'ADVERTISES_SHOW', from: posterEntity.name, to: showId });

      const now = Date.now();
      await this.relationService.createRelations([{
        from: headlinerArtistId,
        to: showId,
        relationType: 'PERFORMS_IN',
        metadata: { is_headliner: true, billing_order: 1, createdAt: now, updatedAt: now },
      }]);
      relationships.push({ type: 'PERFORMS_IN', from: headlinerArtistId, to: showId });
    }
  }

  /**
   * Create Event entity and relationships for concert/festival/comedy/theater posters
   */
  private async createEventEntities(
    posterEntity: PosterEntity,
    artistResult: ArtistPhaseResult,
    venueResult: VenuePhaseResult,
    eventResult: EventPhaseResult | undefined,
    entities: AssemblyPhaseResult['entitiesCreated'],
    relationships: AssemblyPhaseResult['relationshipsCreated']
  ): Promise<void> {
    if (!this.entityService || !this.relationService) return;

    // Create Venue entity first
    let venueId: string | undefined;
    if (venueResult.venue) {
      venueId = await this.createVenueEntity(venueResult.venue, entities);

      // Create ADVERTISES_VENUE relationship
      await this.relationService.createRelations([{
        from: posterEntity.name,
        to: venueId,
        relationType: 'ADVERTISES_VENUE',
      }]);
      relationships.push({ type: 'ADVERTISES_VENUE', from: posterEntity.name, to: venueId });
    }

    // Create headliner artist
    let headlinerArtistId: string | undefined;
    if (artistResult.headliner) {
      headlinerArtistId = await this.createArtistEntity(artistResult.headliner, entities);

      // Create HEADLINED_ON relationship (Artist → Poster)
      await this.relationService.createRelations([{
        from: headlinerArtistId,
        to: posterEntity.name,
        relationType: 'HEADLINED_ON',
      }]);
      relationships.push({ type: 'HEADLINED_ON', from: headlinerArtistId, to: posterEntity.name });
    }

    // Create Event entity
    const eventName = artistResult.tourName ||
      (artistResult.headliner?.extractedName ? `${artistResult.headliner.extractedName} Live` : posterEntity.name);
    const eventId = `event_${eventName.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${Date.now().toString(36)}`;

    const eventObservations: string[] = [
      `Event Name: ${eventName}`,
      `Event Type: ${posterEntity.poster_type}`,
      eventResult?.eventDate?.rawValue ? `Date: ${eventResult.eventDate.rawValue}` : '',
      eventResult?.year ? `Year: ${eventResult.year}` : '',
      eventResult?.timeDetails?.doorTime ? `Door Time: ${eventResult.timeDetails.doorTime}` : '',
      eventResult?.timeDetails?.showTime ? `Show Time: ${eventResult.timeDetails.showTime}` : '',
      eventResult?.ticketPrice ? `Ticket Price: ${eventResult.ticketPrice}` : '',
      eventResult?.ageRestriction ? `Age Restriction: ${eventResult.ageRestriction}` : '',
      artistResult.tourName ? `Tour: ${artistResult.tourName}` : '',
    ].filter(o => o);

    await this.entityService.createEntities([{
      name: eventId,
      entityType: 'Event',
      observations: eventObservations,
    }]);

    entities.push({ type: 'Event', name: eventId, isNew: true });

    // Create ADVERTISES_EVENT relationship (Poster → Event)
    await this.relationService.createRelations([{
      from: posterEntity.name,
      to: eventId,
      relationType: 'ADVERTISES_EVENT',
    }]);
    relationships.push({ type: 'ADVERTISES_EVENT', from: posterEntity.name, to: eventId });

    // Create HELD_AT relationship (Event → Venue)
    if (venueId) {
      await this.relationService.createRelations([{
        from: eventId,
        to: venueId,
        relationType: 'HELD_AT',
      }]);
      relationships.push({ type: 'HELD_AT', from: eventId, to: venueId });
    }

    // Create HEADLINED relationship (Artist → Event)
    if (headlinerArtistId) {
      await this.relationService.createRelations([{
        from: headlinerArtistId,
        to: eventId,
        relationType: 'HEADLINED',
      }]);
      relationships.push({ type: 'HEADLINED', from: headlinerArtistId, to: eventId });
    }

    // Create supporting act relationships
    const supportActIds: string[] = [];
    if (artistResult.supportingActs) {
      for (const act of artistResult.supportingActs) {
        const actId = await this.createArtistEntity(act, entities);
        supportActIds.push(actId);

        // PERFORMED_ON relationship (Artist → Poster)
        await this.relationService.createRelations([{
          from: actId,
          to: posterEntity.name,
          relationType: 'PERFORMED_ON',
        }]);
        relationships.push({ type: 'PERFORMED_ON', from: actId, to: posterEntity.name });

        // PERFORMED_AT relationship (Artist → Event)
        await this.relationService.createRelations([{
          from: actId,
          to: eventId,
          relationType: 'PERFORMED_AT',
        }]);
        relationships.push({ type: 'PERFORMED_AT', from: actId, to: eventId });
      }
    }

    // Create Show entities (one per date)
    await this.createShowEntities(
      posterEntity, artistResult, venueResult, eventResult,
      headlinerArtistId, supportActIds, venueId, eventId,
      entities, relationships
    );

    // Create promoter organization if present
    if (eventResult?.promoter) {
      const promoterId = `org_${eventResult.promoter.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;

      const existingPromoter = await this.entityService.getEntity(promoterId);
      if (!existingPromoter.success) {
        await this.entityService.createEntities([{
          name: promoterId,
          entityType: 'Organization',
          observations: [
            `Name: ${eventResult.promoter}`,
            'Type: promoter',
          ],
        }]);
        entities.push({ type: 'Organization', name: promoterId, isNew: true });
      } else {
        entities.push({ type: 'Organization', name: promoterId, isNew: false });
      }

      await this.relationService.createRelations([{
        from: eventId,
        to: promoterId,
        relationType: 'PROMOTED_BY',
      }]);
      relationships.push({ type: 'PROMOTED_BY', from: eventId, to: promoterId });
    }
  }

  /**
   * Create Show entities for individual performances.
   * A Show is created for each date found on the poster, or a single
   * year-only Show if only a year is available.
   */
  private async createShowEntities(
    posterEntity: PosterEntity,
    artistResult: ArtistPhaseResult,
    venueResult: VenuePhaseResult,
    eventResult: EventPhaseResult | undefined,
    headlinerArtistId: string | undefined,
    supportActIds: string[],
    venueId: string | undefined,
    eventId: string | undefined,
    entities: AssemblyPhaseResult['entitiesCreated'],
    relationships: AssemblyPhaseResult['relationshipsCreated']
  ): Promise<void> {
    if (!this.entityService || !this.relationService) return;

    // Build list of shows to create
    const showsToCreate: ShowInfo[] = [];

    if (eventResult?.shows && eventResult.shows.length > 0) {
      showsToCreate.push(...eventResult.shows);
    } else if (eventResult?.eventDate) {
      // Single date fallback
      showsToCreate.push({
        date: eventResult.eventDate,
        doorTime: eventResult.timeDetails?.doorTime,
        showTime: eventResult.timeDetails?.showTime,
        ticketPrice: eventResult.ticketPrice,
        ageRestriction: eventResult.ageRestriction,
        showNumber: 1,
      });
    } else if (eventResult?.year) {
      // Year-only fallback
      showsToCreate.push({
        date: {
          rawValue: String(eventResult.year),
          year: eventResult.year,
          confidence: 0.6,
          format: 'year_only',
        },
        showNumber: 1,
      });
    }

    if (showsToCreate.length === 0) return;

    const artistSlug = (artistResult.headliner?.validatedName ?? artistResult.headliner?.extractedName ?? 'unknown')
      .toLowerCase().replace(/[^a-z0-9]/g, '_');
    const venueSlug = (venueResult.venue?.validatedName ?? venueResult.venue?.extractedName ?? 'none')
      .toLowerCase().replace(/[^a-z0-9]/g, '_');

    for (let i = 0; i < showsToCreate.length; i++) {
      const show = showsToCreate[i];

      // Build date slug: YYYY-MM-DD for full dates, YYYY for year-only
      let dateSlug: string;
      if (show.date.year && show.date.month && show.date.day) {
        dateSlug = `${show.date.year}-${String(show.date.month).padStart(2, '0')}-${String(show.date.day).padStart(2, '0')}`;
      } else if (show.date.year) {
        dateSlug = String(show.date.year);
      } else {
        dateSlug = show.date.rawValue.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      }

      const showId = `show_${artistSlug}_${venueSlug}_${dateSlug}`;

      // Build show observations
      const showObservations: string[] = [
        `Date: ${show.date.rawValue}`,
        show.dayOfWeek ? `Day: ${show.dayOfWeek}` : '',
        show.date.year ? `Year: ${show.date.year}` : '',
        show.doorTime ? `Door Time: ${show.doorTime}` : '',
        show.showTime ? `Show Time: ${show.showTime}` : '',
        show.ticketPrice ? `Ticket Price: ${show.ticketPrice}` : '',
        show.ageRestriction ? `Age Restriction: ${show.ageRestriction}` : '',
        showsToCreate.length > 1 ? `Show ${i + 1} of ${showsToCreate.length}` : '',
        artistResult.headliner ? `Headliner: ${artistResult.headliner.validatedName ?? artistResult.headliner.extractedName}` : '',
        venueResult.venue ? `Venue: ${venueResult.venue.validatedName ?? venueResult.venue.extractedName}` : '',
        venueResult.venue?.city ? `City: ${venueResult.venue.city}` : '',
      ].filter(o => o);

      // Check if show already exists (deterministic naming enables dedup)
      const existingShow = await this.entityService.getEntity(showId);
      if (!existingShow.success) {
        await this.entityService.createEntities([{
          name: showId,
          entityType: 'Show',
          observations: showObservations,
        }]);
        entities.push({ type: 'Show', name: showId, isNew: true });
      } else {
        entities.push({ type: 'Show', name: showId, isNew: false });
      }

      // Poster → ADVERTISES_SHOW → Show
      await this.relationService.createRelations([{
        from: posterEntity.name,
        to: showId,
        relationType: 'ADVERTISES_SHOW',
      }]);
      relationships.push({ type: 'ADVERTISES_SHOW', from: posterEntity.name, to: showId });

      // Show → HELD_AT → Venue
      if (venueId) {
        await this.relationService.createRelations([{
          from: showId,
          to: venueId,
          relationType: 'HELD_AT',
        }]);
        relationships.push({ type: 'HELD_AT', from: showId, to: venueId });
      }

      // Artist → PERFORMS_IN → Show (headliner)
      if (headlinerArtistId) {
        const now = Date.now();
        await this.relationService.createRelations([{
          from: headlinerArtistId,
          to: showId,
          relationType: 'PERFORMS_IN',
          metadata: { is_headliner: true, billing_order: 1, createdAt: now, updatedAt: now },
        }]);
        relationships.push({ type: 'PERFORMS_IN', from: headlinerArtistId, to: showId });
      }

      // Supporting acts → PERFORMS_IN → Show
      for (let j = 0; j < supportActIds.length; j++) {
        const now = Date.now();
        await this.relationService.createRelations([{
          from: supportActIds[j],
          to: showId,
          relationType: 'PERFORMS_IN',
          metadata: { is_headliner: false, billing_order: j + 2, createdAt: now, updatedAt: now },
        }]);
        relationships.push({ type: 'PERFORMS_IN', from: supportActIds[j], to: showId });
      }

      // Show → PART_OF_EVENT → Event
      if (eventId) {
        await this.relationService.createRelations([{
          from: showId,
          to: eventId,
          relationType: 'PART_OF_EVENT',
        }]);
        relationships.push({ type: 'PART_OF_EVENT', from: showId, to: eventId });
      }
    }
  }

  /**
   * Create Film-specific entities and relationships
   */
  private async createFilmEntities(
    posterEntity: PosterEntity,
    artistResult: ArtistPhaseResult,
    eventResult: EventPhaseResult | undefined,
    entities: AssemblyPhaseResult['entitiesCreated'],
    relationships: AssemblyPhaseResult['relationshipsCreated']
  ): Promise<void> {
    if (!this.entityService || !this.relationService) return;

    // Create Director entity and DIRECTED_BY relationship
    let directorId: string | undefined;
    if (artistResult.director) {
      directorId = await this.createArtistEntity(artistResult.director, entities, 'director');

      await this.relationService.createRelations([{
        from: posterEntity.name,
        to: directorId,
        relationType: 'DIRECTED_BY',
      }]);
      relationships.push({ type: 'DIRECTED_BY', from: posterEntity.name, to: directorId });
    }

    // Create Cast entities and STARS relationships
    if (artistResult.cast) {
      let billingOrder = 1;
      for (const actor of artistResult.cast) {
        const actorId = await this.createArtistEntity(actor, entities, 'actor');

        const now = Date.now();
        await this.relationService.createRelations([{
          from: posterEntity.name,
          to: actorId,
          relationType: 'STARS',
          metadata: { billing_order: billingOrder++, createdAt: now, updatedAt: now },
        }]);
        relationships.push({ type: 'STARS', from: posterEntity.name, to: actorId });
      }
    }

    // Also use headliner as primary star if no cast specified
    if (!artistResult.cast && artistResult.headliner) {
      const starId = await this.createArtistEntity(artistResult.headliner, entities);

      const now = Date.now();
      await this.relationService.createRelations([{
        from: posterEntity.name,
        to: starId,
        relationType: 'STARS',
        metadata: { billing_order: 1, createdAt: now, updatedAt: now },
      }]);
      relationships.push({ type: 'STARS', from: posterEntity.name, to: starId });
    }

    // Create Show entity for temporal searchability (year-based)
    const year = eventResult?.year ?? posterEntity.year;
    const primaryArtistName = artistResult.director?.validatedName ?? artistResult.director?.extractedName
      ?? artistResult.headliner?.validatedName ?? artistResult.headliner?.extractedName;
    const primaryArtistId = directorId
      ?? (artistResult.headliner ? await this.createArtistEntity(artistResult.headliner, entities) : undefined);

    if (year && primaryArtistName) {
      const artistSlug = primaryArtistName.toLowerCase().replace(/[^a-z0-9]/g, '_');
      const dateSlug = String(year);
      const showId = `show_${artistSlug}_none_${dateSlug}`;

      const showObservations: string[] = [
        `Year: ${year}`,
        eventResult?.eventDate?.rawValue ? `Release Date: ${eventResult.eventDate.rawValue}` : '',
        `Director: ${primaryArtistName}`,
        `Type: film release`,
        posterEntity.title ? `Film: ${posterEntity.title}` : '',
      ].filter(o => o);

      const existingShow = await this.entityService.getEntity(showId);
      if (!existingShow.success) {
        await this.entityService.createEntities([{
          name: showId,
          entityType: 'Show',
          observations: showObservations,
        }]);
        entities.push({ type: 'Show', name: showId, isNew: true });
      } else {
        entities.push({ type: 'Show', name: showId, isNew: false });
      }

      await this.relationService.createRelations([{
        from: posterEntity.name,
        to: showId,
        relationType: 'ADVERTISES_SHOW',
      }]);
      relationships.push({ type: 'ADVERTISES_SHOW', from: posterEntity.name, to: showId });

      if (primaryArtistId) {
        const now = Date.now();
        await this.relationService.createRelations([{
          from: primaryArtistId,
          to: showId,
          relationType: 'PERFORMS_IN',
          metadata: { is_headliner: true, billing_order: 1, createdAt: now, updatedAt: now },
        }]);
        relationships.push({ type: 'PERFORMS_IN', from: primaryArtistId, to: showId });
      }
    }
  }

  /**
   * Create basic entities for promo, exhibition, unknown types
   */
  private async createBasicEntities(
    posterEntity: PosterEntity,
    artistResult: ArtistPhaseResult,
    venueResult: VenuePhaseResult,
    entities: AssemblyPhaseResult['entitiesCreated'],
    relationships: AssemblyPhaseResult['relationshipsCreated']
  ): Promise<void> {
    if (!this.entityService || !this.relationService) return;

    // Create headliner artist
    if (artistResult.headliner) {
      const headlinerArtistId = await this.createArtistEntity(artistResult.headliner, entities);

      await this.relationService.createRelations([{
        from: headlinerArtistId,
        to: posterEntity.name,
        relationType: 'HEADLINED_ON',
      }]);
      relationships.push({ type: 'HEADLINED_ON', from: headlinerArtistId, to: posterEntity.name });
    }

    // Create supporting artists
    if (artistResult.supportingActs) {
      for (const act of artistResult.supportingActs) {
        const actId = await this.createArtistEntity(act, entities);

        await this.relationService.createRelations([{
          from: actId,
          to: posterEntity.name,
          relationType: 'PERFORMED_ON',
        }]);
        relationships.push({ type: 'PERFORMED_ON', from: actId, to: posterEntity.name });
      }
    }

    // Create venue
    if (venueResult.venue) {
      const venueId = await this.createVenueEntity(venueResult.venue, entities);

      await this.relationService.createRelations([{
        from: posterEntity.name,
        to: venueId,
        relationType: 'ADVERTISES_VENUE',
      }]);
      relationships.push({ type: 'ADVERTISES_VENUE', from: posterEntity.name, to: venueId });
    }
  }

  /**
   * Create HAS_TYPE relationships for inferred types
   */
  private async createTypeRelationships(
    posterEntity: PosterEntity,
    entities: AssemblyPhaseResult['entitiesCreated'],
    relationships: AssemblyPhaseResult['relationshipsCreated']
  ): Promise<void> {
    if (!this.entityService || !this.relationService || !posterEntity.inferred_types) return;

    for (const typeInference of posterEntity.inferred_types) {
      const typeId = `PosterType_${typeInference.type_key}`;

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

      relationships.push({ type: 'HAS_TYPE', from: posterEntity.name, to: typeId });
    }
  }

  /**
   * Helper: Create an Artist entity
   */
  private async createArtistEntity(
    artist: ArtistMatch,
    entities: AssemblyPhaseResult['entitiesCreated'],
    role?: string
  ): Promise<string> {
    if (!this.entityService) throw new Error('EntityService not available');

    const artistName = artist.validatedName ?? artist.extractedName;
    const artistId = `artist_${artistName.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;

    const existingArtist = await this.entityService.getEntity(artistId);
    const isNew = !existingArtist.success;

    if (isNew) {
      const observations: string[] = [
        `Name: ${artistName}`,
        artist.externalId ? `MusicBrainz ID: ${artist.externalId}` : '',
        role ? `Role: ${role}` : '',
      ].filter(o => o);

      await this.entityService.createEntities([{
        name: artistId,
        entityType: 'Artist',
        observations,
      }]);
    }

    entities.push({ type: 'Artist', name: artistId, isNew });
    return artistId;
  }

  /**
   * Helper: Create a Venue entity
   */
  private async createVenueEntity(
    venue: VenueMatch,
    entities: AssemblyPhaseResult['entitiesCreated']
  ): Promise<string> {
    if (!this.entityService) throw new Error('EntityService not available');

    const venueName = venue.validatedName ?? venue.extractedName;
    const venueId = venue.existingVenueId ||
      `venue_${venueName.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;

    const existingVenue = await this.entityService.getEntity(venueId);
    const isNew = !existingVenue.success;

    if (isNew) {
      await this.entityService.createEntities([{
        name: venueId,
        entityType: 'Venue',
        observations: [
          `Name: ${venueName}`,
          venue.city ? `City: ${venue.city}` : '',
          venue.state ? `State: ${venue.state}` : '',
          venue.country ? `Country: ${venue.country}` : '',
        ].filter(o => o),
      }]);
    }

    entities.push({ type: 'Venue', name: venueId, isNew });
    return venueId;
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
    if (eventResult.shows && eventResult.shows.length > 1) {
      observations.push(`Number of shows: ${eventResult.shows.length}`);
      for (let i = 0; i < eventResult.shows.length; i++) {
        const show = eventResult.shows[i];
        const dayStr = show.dayOfWeek ? ` (${show.dayOfWeek})` : '';
        observations.push(`Show ${i + 1}: ${show.date.rawValue}${dayStr}`);
      }
    } else if (eventResult.eventDate) {
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
   * Process an image using consensus mode (multiple models)
   */
  async processWithConsensus(
    imagePath: string,
    options: Partial<IterativeProcessingOptions> = {}
  ): Promise<IterativeProcessingResult> {
    const startTime = Date.now();
    const consensusOptions = options.consensus || this.defaultConsensusConfig;

    if (!consensusOptions?.enabled || !consensusOptions.models?.length) {
      // Fall back to regular processing if consensus not enabled
      return this.processImage(imagePath, options);
    }

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

    try {
      // Create or get ConsensusProcessor
      if (!this.consensusProcessor) {
        this.consensusProcessor = new ConsensusProcessor({
          models: consensusOptions.models,
          minAgreementRatio: consensusOptions.minAgreementRatio ?? 0.5,
          parallel: consensusOptions.parallel ?? true,
          modelTimeoutMs: consensusOptions.modelTimeoutMs ?? 120000,
        });
      }

      console.log(`[ITERATIVE] Processing ${posterId} with consensus (${consensusOptions.models.length} models)`);

      // Run consensus extraction
      const consensusResult = await this.consensusProcessor.processWithConsensus(imagePath);

      if (!consensusResult.success) {
        return {
          success: false,
          posterId,
          imagePath,
          phases: { consensus: consensusResult },
          overallConfidence: 0,
          fieldsNeedingReview: [],
          processingTimeMs: Date.now() - startTime,
          modelsUsed: consensusResult.modelsUsed,
          agreementScore: consensusResult.agreementScore,
          error: consensusResult.errors.join('; ') || 'Consensus processing failed',
        };
      }

      console.log(`[ITERATIVE] Consensus complete: ${consensusResult.agreementScore.toFixed(2)} agreement`);

      // Now run the regular iterative pipeline with the consensus entity as a starting point
      // Use the first model from consensus for subsequent phases
      const modifiedOptions: Partial<IterativeProcessingOptions> = {
        ...options,
        modelKey: consensusOptions.models[0],
        consensus: undefined, // Don't recurse
      };

      // Process normally but merge consensus results
      const regularResult = await this.processImage(imagePath, modifiedOptions);

      // Merge consensus data with regular results
      return {
        ...regularResult,
        phases: {
          ...regularResult.phases,
          consensus: consensusResult,
        },
        modelsUsed: consensusResult.modelsUsed,
        agreementScore: consensusResult.agreementScore,
        // Boost confidence if consensus had high agreement
        overallConfidence: this.mergeConfidence(
          regularResult.overallConfidence,
          consensusResult.overallConfidence,
          consensusResult.agreementScore
        ),
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
    }
  }

  /**
   * Merge confidence scores from consensus and regular processing
   */
  private mergeConfidence(
    regularConfidence: number,
    consensusConfidence: number,
    agreementScore: number
  ): number {
    // If models strongly agree, boost confidence
    // Weight: 50% regular, 30% consensus, 20% agreement bonus
    const agreementBonus = agreementScore > 0.8 ? 0.1 : agreementScore > 0.6 ? 0.05 : 0;
    return Math.min(1, regularConfidence * 0.5 + consensusConfidence * 0.3 + agreementScore * 0.2 + agreementBonus);
  }

  /**
   * Get consensus processor health status
   */
  async getConsensusHealth(): Promise<Record<string, boolean> | null> {
    if (!this.consensusProcessor) {
      return null;
    }
    return this.consensusProcessor.healthCheck();
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
