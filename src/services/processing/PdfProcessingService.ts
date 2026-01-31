/**
 * PDF Processing Service
 *
 * Handles PDF metadata extraction from product documentation.
 * Creates document chunks, extracts technical data, and creates
 * surface/problem entity relationships.
 *
 * This service replaces the script-based approach with direct API calls.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { logger } from '../../utils/logger.js';
import { processingJobManager } from './ProcessingJobManager.js';
import {
  EntityBuilder,
  CatalogLoader,
  createCatalogLoader
} from './utils/index.js';
import type {
  ProcessingJob,
  PdfInput,
  PdfJobOptions,
  BatchResult,
  EntityResult,
  RelationResult,
  BatchStats,
  PdfContent,
  PdfSection,
  DocumentChunk
} from './types.js';
import type { EntityService } from '../../core/services/EntityService.js';
import type { RelationService } from '../../core/services/RelationService.js';
import type { Entity } from '../../KnowledgeGraphManager.js';
import type { Relation } from '../../types/relation.js';

// Import pdfreader using require (CommonJS module)
const require = createRequire(import.meta.url);
let PdfReader: any;
try {
  const pdfreader = require('pdfreader');
  PdfReader = pdfreader.PdfReader;
} catch {
  logger.warn('pdfreader not available, PDF extraction will be limited');
}

/**
 * Configuration for PDF processing
 */
export interface PdfProcessingConfig {
  catalogPath?: string;
  defaultExpertiseArea?: string;
  batchSize?: number;
  delayBetweenBatches?: number;
  chunkTargetTokens?: number;
  chunkMaxTokens?: number;
  chunkOverlap?: number;
}

/**
 * Service for processing PDFs and extracting metadata
 */
export class PdfProcessingService {
  private catalogLoader: CatalogLoader | null = null;
  private config: PdfProcessingConfig;

  constructor(
    private entityService: EntityService,
    private relationService: RelationService,
    config: Partial<PdfProcessingConfig> = {}
  ) {
    this.config = {
      catalogPath: config.catalogPath || process.env.CATALOG_PATH,
      defaultExpertiseArea: config.defaultExpertiseArea || 'agar',
      batchSize: config.batchSize || 10,
      delayBetweenBatches: config.delayBetweenBatches || 500,
      chunkTargetTokens: config.chunkTargetTokens || 400,
      chunkMaxTokens: config.chunkMaxTokens || 600,
      chunkOverlap: config.chunkOverlap || 50
    };
  }

  /**
   * Load catalog if configured
   */
  private async ensureCatalog(): Promise<CatalogLoader | null> {
    if (this.catalogLoader) {
      return this.catalogLoader;
    }

    if (this.config.catalogPath) {
      try {
        this.catalogLoader = await createCatalogLoader(this.config.catalogPath);
        logger.info('Catalog loaded for PDF processing', {
          path: this.config.catalogPath,
          stats: this.catalogLoader.getStats()
        });
        return this.catalogLoader;
      } catch (error) {
        logger.warn('Failed to load catalog, using legacy extraction', { error });
      }
    }

    return null;
  }

  /**
   * Initialize a new PDF processing job
   */
  async startJob(scrapeRunPath: string, options?: PdfJobOptions): Promise<ProcessingJob> {
    const job = processingJobManager.createJob('pdf', {
      scrapeRunPath,
      options,
      useCatalog: options?.useCatalog ?? true,
      dryRun: options?.dryRun ?? false
    });

    processingJobManager.updateStatus(job.jobId, 'running');

    logger.info('PDF processing job started', { jobId: job.jobId, scrapeRunPath, options });

    return job;
  }

  /**
   * Process a batch of PDFs
   */
  async processBatch(
    jobId: string,
    pdfs: PdfInput[],
    options?: PdfJobOptions
  ): Promise<BatchResult> {
    const job = processingJobManager.getJob(jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    if (processingJobManager.isCancelled(jobId)) {
      throw new Error(`Job cancelled: ${jobId}`);
    }

    const results: EntityResult[] = [];
    const relationResults: RelationResult[] = [];
    const stats: BatchStats = {
      entitiesCreated: 0,
      entitiesUpdated: 0,
      entitiesSkipped: 0,
      relationsCreated: 0,
      relationsSkipped: 0,
      chunksCreated: 0
    };

    const catalog = options?.useCatalog !== false ? await this.ensureCatalog() : null;
    const dryRun = options?.dryRun ?? false;

    for (const pdf of pdfs) {
      if (processingJobManager.isCancelled(jobId)) {
        break;
      }

      try {
        const pdfResult = await this.processPdf(pdf, catalog, dryRun);
        results.push(pdfResult.entityResult);
        relationResults.push(...pdfResult.relationResults);

        if (pdfResult.entityResult.status === 'created') {
          stats.entitiesCreated++;
        } else if (pdfResult.entityResult.status === 'updated') {
          stats.entitiesUpdated++;
        }

        stats.relationsCreated += pdfResult.relationResults.filter(r => r.status === 'created').length;
        stats.chunksCreated = (stats.chunksCreated || 0) + (pdfResult.chunksCreated || 0);

        processingJobManager.incrementProcessed(jobId);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        results.push({
          entityId: pdf.productEntityId,
          entityType: 'document_chunk',
          status: 'failed',
          error: errorMessage
        });
        processingJobManager.incrementFailed(jobId);
        logger.error('Failed to process PDF', { pdf: pdf.pdfPath, error: errorMessage });
      }
    }

    return {
      success: results.filter(r => r.status === 'failed').length === 0,
      processed: results.filter(r => r.status !== 'failed').length,
      failed: results.filter(r => r.status === 'failed').length,
      results,
      relations: relationResults,
      stats
    };
  }

  /**
   * Process a single PDF
   */
  private async processPdf(
    pdf: PdfInput,
    catalog: CatalogLoader | null,
    dryRun: boolean
  ): Promise<{
    entityResult: EntityResult;
    relationResults: RelationResult[];
    chunksCreated: number;
  }> {
    const relationResults: RelationResult[] = [];
    let chunksCreated = 0;

    // Extract PDF content
    const content = await this.extractPdfContent(pdf.pdfPath);

    if (dryRun) {
      return {
        entityResult: {
          entityId: pdf.productEntityId,
          entityType: 'agar_product',
          status: 'skipped',
          error: 'Dry run mode'
        },
        relationResults: [],
        chunksCreated: 0
      };
    }

    // Extract metadata from content
    const fullText = content.rawText;
    const surfaces = catalog
      ? EntityBuilder.parseSurfacesWithCatalog(fullText, catalog)
      : EntityBuilder.parseSurfaces(fullText);
    const problems = catalog
      ? EntityBuilder.parseProblemsWithCatalog(fullText, catalog)
      : EntityBuilder.parseProblems(fullText);
    const technical = EntityBuilder.extractTechnicalData(fullText);

    // Update product entity with technical data
    if (Object.keys(technical).length > 0) {
      // Add observations to product entity
      const observations = this.buildTechnicalObservations(technical);
      await this.addObservationsToEntity(pdf.productEntityId, observations);
    }

    // Create surface relationships
    for (const surface of surfaces) {
      const surfaceId = `agar_surface_${surface.toLowerCase().replace(/\s+/g, '_')}`;

      // Create surface entity if needed
      const surfaceEntity: Entity = {
        name: surfaceId,
        entityType: 'surface_type',
        observations: [`Surface: ${surface}`]
      };

      try {
        await this.entityService.createEntities(
          [surfaceEntity],
          { expertiseArea: this.config.defaultExpertiseArea, skipValidation: true }
        );
      } catch {
        // Surface may already exist
      }

      // Create compatible_with relationship
      const relation: Relation = {
        from: pdf.productEntityId,
        to: surfaceId,
        relationType: 'compatible_with'
      };

      try {
        const relResult = await this.relationService.createRelations(
          [relation],
          { expertiseArea: this.config.defaultExpertiseArea, skipValidation: true }
        );

        relationResults.push({
          from: pdf.productEntityId,
          to: surfaceId,
          relationType: 'compatible_with',
          status: relResult.success ? 'created' : 'skipped'
        });
      } catch {
        relationResults.push({
          from: pdf.productEntityId,
          to: surfaceId,
          relationType: 'compatible_with',
          status: 'skipped'
        });
      }
    }

    // Create problem relationships
    for (const problem of problems) {
      const problemId = `agar_problem_${problem.toLowerCase().replace(/\s+/g, '_')}`;

      // Create problem entity if needed
      const problemEntity: Entity = {
        name: problemId,
        entityType: 'problem_type',
        observations: [`Problem: ${problem}`]
      };

      try {
        await this.entityService.createEntities(
          [problemEntity],
          { expertiseArea: this.config.defaultExpertiseArea, skipValidation: true }
        );
      } catch {
        // Problem may already exist
      }

      // Create addresses relationship
      const relation: Relation = {
        from: pdf.productEntityId,
        to: problemId,
        relationType: 'addresses'
      };

      try {
        const relResult = await this.relationService.createRelations(
          [relation],
          { expertiseArea: this.config.defaultExpertiseArea, skipValidation: true }
        );

        relationResults.push({
          from: pdf.productEntityId,
          to: problemId,
          relationType: 'addresses',
          status: relResult.success ? 'created' : 'skipped'
        });
      } catch {
        relationResults.push({
          from: pdf.productEntityId,
          to: problemId,
          relationType: 'addresses',
          status: 'skipped'
        });
      }
    }

    // Create document chunks
    const chunks = this.createDocumentChunks(pdf.productEntityId, content);
    chunksCreated = chunks.length;

    for (const chunk of chunks) {
      const chunkEntity: Entity = {
        name: chunk.chunkId,
        entityType: 'document_chunk',
        observations: [
          `Content: ${chunk.content}`,
          `Token Count: ${chunk.tokenCount}`,
          `Chunk Index: ${chunk.chunkIndex}`,
          ...(chunk.sectionTitle ? [`Section: ${chunk.sectionTitle}`] : [])
        ]
      };

      try {
        await this.entityService.createEntities(
          [chunkEntity],
          { expertiseArea: this.config.defaultExpertiseArea, skipValidation: true }
        );

        // Create chunk relationship to product
        const chunkRelation: Relation = {
          from: chunk.chunkId,
          to: pdf.productEntityId,
          relationType: 'chunk_of'
        };

        await this.relationService.createRelations(
          [chunkRelation],
          { expertiseArea: this.config.defaultExpertiseArea, skipValidation: true }
        );
      } catch (error) {
        logger.warn('Failed to create chunk entity', { chunkId: chunk.chunkId, error });
      }
    }

    return {
      entityResult: {
        entityId: pdf.productEntityId,
        entityType: 'agar_product',
        status: 'updated'
      },
      relationResults,
      chunksCreated
    };
  }

  /**
   * Extract content from PDF file
   */
  async extractPdfContent(pdfPath: string): Promise<PdfContent> {
    if (!PdfReader) {
      throw new Error('PDF reader not available');
    }

    const rawText = await this.extractPdfText(pdfPath);
    const sections = this.detectSections(rawText);

    return {
      rawText,
      sections,
      pageCount: 1, // pdfreader doesn't provide page count easily
      extractedAt: new Date().toISOString()
    };
  }

  /**
   * Extract raw text from PDF
   */
  private extractPdfText(pdfPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const textChunks: string[] = [];

      new PdfReader().parseFileItems(pdfPath, (err: Error | null, item: { text?: string } | null) => {
        if (err) {
          reject(err);
        } else if (!item) {
          resolve(textChunks.join(' '));
        } else if (item.text) {
          textChunks.push(item.text);
        }
      });
    });
  }

  /**
   * Detect sections in PDF text
   */
  private detectSections(text: string): PdfSection[] {
    const sections: PdfSection[] = [];
    const sectionPatterns = [
      /(?:^|\n)(PRODUCT DESCRIPTION|DESCRIPTION)\s*[:\n]/gi,
      /(?:^|\n)(HOW DOES IT WORK\??)\s*[:\n]/gi,
      /(?:^|\n)(FOR USE ON)\s*[:\n]/gi,
      /(?:^|\n)(DILUTION|DILUTIONS)\s*[:\n]/gi,
      /(?:^|\n)(DIRECTIONS|DIRECTIONS FOR USE)\s*[:\n]/gi,
      /(?:^|\n)(SAFETY|SAFETY INFORMATION)\s*[:\n]/gi,
      /(?:^|\n)(TECHNICAL DATA|SPECIFICATIONS)\s*[:\n]/gi
    ];

    for (const pattern of sectionPatterns) {
      const match = pattern.exec(text);
      if (match) {
        sections.push({
          title: match[1],
          content: '', // Would need more sophisticated parsing
          startPage: 1
        });
      }
    }

    // If no sections detected, create a single section
    if (sections.length === 0) {
      sections.push({
        title: 'Content',
        content: text
      });
    }

    return sections;
  }

  /**
   * Create document chunks from PDF content
   */
  createDocumentChunks(productEntityId: string, content: PdfContent): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];
    const words = content.rawText.split(/\s+/);
    const targetTokens = this.config.chunkTargetTokens || 400;
    const overlap = this.config.chunkOverlap || 50;

    let currentChunk: string[] = [];
    let chunkIndex = 0;

    for (let i = 0; i < words.length; i++) {
      currentChunk.push(words[i]);

      // Approximate tokens (rough estimate: ~0.75 tokens per word)
      const estimatedTokens = Math.ceil(currentChunk.length * 0.75);

      if (estimatedTokens >= targetTokens) {
        const chunkText = currentChunk.join(' ');
        chunks.push({
          chunkId: `${productEntityId}_chunk_${chunkIndex}`,
          productEntityId,
          content: chunkText,
          tokenCount: estimatedTokens,
          chunkIndex
        });

        // Keep overlap words for next chunk
        currentChunk = currentChunk.slice(-overlap);
        chunkIndex++;
      }
    }

    // Add remaining text as final chunk
    if (currentChunk.length > 0) {
      const chunkText = currentChunk.join(' ');
      const estimatedTokens = Math.ceil(currentChunk.length * 0.75);
      chunks.push({
        chunkId: `${productEntityId}_chunk_${chunkIndex}`,
        productEntityId,
        content: chunkText,
        tokenCount: estimatedTokens,
        chunkIndex
      });
    }

    return chunks;
  }

  /**
   * Build technical observations from extracted data
   */
  private buildTechnicalObservations(technical: Record<string, unknown>): string[] {
    const observations: string[] = [];

    if (technical.ph !== undefined) {
      observations.push(`pH: ${technical.ph}`);
    }
    if (technical.color) {
      observations.push(`Color: ${technical.color}`);
    }
    if (technical.odor) {
      observations.push(`Odor: ${technical.odor}`);
    }
    if (technical.specific_gravity) {
      observations.push(`Specific Gravity: ${technical.specific_gravity}`);
    }
    if (technical.flash_point) {
      observations.push(`Flash Point: ${technical.flash_point}`);
    }

    return observations;
  }

  /**
   * Add observations to an existing entity
   */
  private async addObservationsToEntity(
    entityId: string,
    observations: string[]
  ): Promise<void> {
    // For now, we'll create/update via the entity service
    // A proper implementation would use an observations endpoint
    logger.debug('Would add observations to entity', { entityId, observations });
  }

  /**
   * Complete a job
   */
  completeJob(jobId: string, stats?: BatchStats): void {
    processingJobManager.completeJob(jobId, stats);
  }

  /**
   * Fail a job
   */
  failJob(jobId: string, error: string): void {
    processingJobManager.failJob(jobId, error);
  }

  /**
   * Get job status
   */
  getJobStatus(jobId: string): ProcessingJob | null {
    return processingJobManager.getJob(jobId);
  }
}

export default PdfProcessingService;
