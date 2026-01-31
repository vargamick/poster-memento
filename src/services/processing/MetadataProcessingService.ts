/**
 * Metadata Processing Service
 *
 * Handles product metadata processing from scrape run JSON files.
 * Creates product, category, and brand entities with relationships.
 *
 * This service replaces the script-based approach with direct API calls.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { logger } from '../../utils/logger.js';
import { processingJobManager } from './ProcessingJobManager.js';
import {
  EntityBuilder,
  CatalogLoader,
  createCatalogLoader,
  ProductValidator
} from './utils/index.js';
import type {
  ProcessingJob,
  ProductInput,
  CategoryInput,
  MetadataJobOptions,
  BatchResult,
  EntityResult,
  RelationResult,
  BatchStats,
  CategoryHierarchy,
  MetadataLoadResponse
} from './types.js';
import type { EntityService } from '../../core/services/EntityService.js';
import type { RelationService } from '../../core/services/RelationService.js';
import type { Entity } from '../../KnowledgeGraphManager.js';
import type { Relation } from '../../types/relation.js';

/**
 * Configuration for metadata processing
 */
export interface MetadataProcessingConfig {
  catalogPath?: string;
  defaultExpertiseArea?: string;
  batchSize?: number;
  delayBetweenBatches?: number;
}

/**
 * Service for processing metadata from scrape runs
 */
export class MetadataProcessingService {
  private catalogLoader: CatalogLoader | null = null;
  private config: MetadataProcessingConfig;

  constructor(
    private entityService: EntityService,
    private relationService: RelationService,
    config: Partial<MetadataProcessingConfig> = {}
  ) {
    this.config = {
      catalogPath: config.catalogPath || process.env.CATALOG_PATH,
      defaultExpertiseArea: config.defaultExpertiseArea || 'agar',
      batchSize: config.batchSize || 10,
      delayBetweenBatches: config.delayBetweenBatches || 500
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
        logger.info('Catalog loaded for metadata processing', {
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
   * Initialize a new metadata processing job
   */
  async startJob(options?: MetadataJobOptions): Promise<ProcessingJob> {
    const job = processingJobManager.createJob('metadata', {
      options,
      useCatalog: options?.useCatalog ?? true,
      dryRun: options?.dryRun ?? false
    });

    processingJobManager.updateStatus(job.jobId, 'running');

    logger.info('Metadata processing job started', { jobId: job.jobId, options });

    return job;
  }

  /**
   * Load metadata from scrape run directory
   */
  async loadMetadata(scrapeRunPath: string): Promise<MetadataLoadResponse> {
    const productFiles = await this.findProductFiles(scrapeRunPath);
    const categoryFiles = await this.findCategoryFiles(scrapeRunPath);

    const products: ProductInput[] = [];
    const categories: CategoryInput[] = [];

    // Load product files
    for (const file of productFiles) {
      const content = await fs.readFile(file, 'utf-8');
      const data = JSON.parse(content);
      products.push(this.normalizeProductInput(data));
    }

    // Load category files
    for (const file of categoryFiles) {
      const content = await fs.readFile(file, 'utf-8');
      const data = JSON.parse(content);
      categories.push(this.normalizeCategoryInput(data));
    }

    // Extract scrape run info from path
    const dirName = path.basename(scrapeRunPath);
    const isFull = dirName.includes('_FULL');
    const timestampMatch = dirName.match(/(\d{8}_\d{6})/);

    // Count PDF files
    let pdfPDSCount = 0;
    let pdfSDSCount = 0;
    try {
      const pdfDir = path.join(scrapeRunPath, 'pdfs');
      const pdfFiles = await fs.readdir(pdfDir);
      pdfPDSCount = pdfFiles.filter(f => f.includes('_PDS')).length;
      pdfSDSCount = pdfFiles.filter(f => f.includes('_SDS')).length;
    } catch {
      // PDF directory may not exist
    }

    return {
      products,
      categories,
      scrapeRunInfo: {
        directory: scrapeRunPath,
        timestamp: timestampMatch ? timestampMatch[1] : new Date().toISOString(),
        isFull,
        productCount: products.length,
        categoryCount: categories.length,
        pdfPDSCount,
        pdfSDSCount
      }
    };
  }

  /**
   * Process a batch of products
   */
  async processBatch(
    jobId: string,
    products: ProductInput[],
    categories?: CategoryInput[],
    options?: MetadataJobOptions
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
      relationsSkipped: 0
    };

    const catalog = options?.useCatalog !== false ? await this.ensureCatalog() : null;
    const dryRun = options?.dryRun ?? false;

    // Process categories first
    if (categories && categories.length > 0) {
      const categoryResult = await this.processCategories(categories, catalog, dryRun);
      results.push(...categoryResult.results);
      relationResults.push(...(categoryResult.relations || []));
      stats.entitiesCreated += categoryResult.stats?.entitiesCreated || 0;
      stats.relationsCreated += categoryResult.stats?.relationsCreated || 0;
    }

    // Process products
    for (const product of products) {
      if (processingJobManager.isCancelled(jobId)) {
        break;
      }

      try {
        const productResult = await this.processProduct(product, catalog, dryRun);
        results.push(productResult.entityResult);
        relationResults.push(...productResult.relationResults);

        if (productResult.entityResult.status === 'created') {
          stats.entitiesCreated++;
        } else if (productResult.entityResult.status === 'updated') {
          stats.entitiesUpdated++;
        } else if (productResult.entityResult.status === 'skipped') {
          stats.entitiesSkipped++;
        }

        stats.relationsCreated += productResult.relationResults.filter(r => r.status === 'created').length;
        stats.relationsSkipped += productResult.relationResults.filter(r => r.status === 'skipped').length;

        processingJobManager.incrementProcessed(jobId);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        results.push({
          productName: product.product_name,
          entityId: '',
          entityType: 'agar_product',
          status: 'failed',
          error: errorMessage
        });
        processingJobManager.incrementFailed(jobId);
        logger.error('Failed to process product', { product: product.product_name, error: errorMessage });
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
   * Process a single product
   */
  private async processProduct(
    product: ProductInput,
    catalog: CatalogLoader | null,
    dryRun: boolean
  ): Promise<{ entityResult: EntityResult; relationResults: RelationResult[] }> {
    // Validate product
    const validation = ProductValidator.validate({
      product_name: product.product_name,
      product_code: product.product_code,
      overview: product.product_overview,
      description: product.product_description,
      container_sizes: product.container_sizes || []
    });

    if (!validation.valid) {
      logger.warn('Product validation failed', {
        product: product.product_name,
        errors: validation.errors
      });
    }

    // Build entity using EntityBuilder
    const metadata = {
      product_name: product.product_name,
      product_url: product.product_url,
      product_image_url: product.product_image_url || '',
      product_overview: product.product_overview,
      product_description: product.product_description,
      product_skus: product.product_skus?.join(', ') || '',
      product_categories: product.product_categories,
      category: product.product_categories[0] || '',
      category_slug: this.slugify(product.product_categories[0] || ''),
      sds_url: product.sds_url || '',
      pds_url: product.pds_url || '',
      scraped_at: product.scraped_at || new Date().toISOString()
    };

    const entity = EntityBuilder.buildProductEntity(metadata);
    const entityId = entity.name as string;

    // Build relationships
    const relationResults: RelationResult[] = [];

    // manufactured_by relationship
    const brandRelation = EntityBuilder.buildManufacturedByRelation(entityId);

    // belongs_to_category relationships
    const categoryRelations = product.product_categories.map(cat => {
      const categorySlug = this.slugify(cat);
      const categoryEntityId = `agar_category_${categorySlug.replace(/[^a-z0-9]/g, '_')}`;
      return EntityBuilder.buildBelongsToCategoryRelation(entityId, categoryEntityId, cat);
    });

    if (dryRun) {
      return {
        entityResult: {
          productName: product.product_name,
          entityId,
          entityType: 'agar_product',
          status: 'skipped',
          error: 'Dry run mode'
        },
        relationResults: []
      };
    }

    // Create entity using EntityService
    const createResult = await this.entityService.createEntities(
      [entity as unknown as Entity],
      { expertiseArea: this.config.defaultExpertiseArea, skipValidation: true }
    );

    if (!createResult.success) {
      return {
        entityResult: {
          productName: product.product_name,
          entityId,
          entityType: 'agar_product',
          status: 'failed',
          error: createResult.errors?.join(', ')
        },
        relationResults: []
      };
    }

    // Create relationships
    const relations = [brandRelation, ...categoryRelations] as Relation[];
    for (const relation of relations) {
      try {
        const relResult = await this.relationService.createRelations(
          [relation],
          { expertiseArea: this.config.defaultExpertiseArea, skipValidation: true }
        );

        relationResults.push({
          from: relation.from as string,
          to: relation.to as string,
          relationType: relation.relationType as string,
          status: relResult.success ? 'created' : 'failed',
          error: relResult.errors?.join(', ')
        });
      } catch (error) {
        relationResults.push({
          from: relation.from as string,
          to: relation.to as string,
          relationType: relation.relationType as string,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    return {
      entityResult: {
        productName: product.product_name,
        entityId,
        entityType: 'agar_product',
        status: 'created'
      },
      relationResults
    };
  }

  /**
   * Process categories and create hierarchy
   */
  private async processCategories(
    categories: CategoryInput[],
    catalog: CatalogLoader | null,
    dryRun: boolean
  ): Promise<BatchResult> {
    const results: EntityResult[] = [];
    const relations: RelationResult[] = [];
    const stats: BatchStats = {
      entitiesCreated: 0,
      entitiesUpdated: 0,
      entitiesSkipped: 0,
      relationsCreated: 0,
      relationsSkipped: 0
    };

    // Build category hierarchy
    const hierarchy = this.buildCategoryHierarchy(categories);

    // Create category entities
    for (const category of categories) {
      const entity = EntityBuilder.buildCategoryEntity(category.name, category.slug);
      const entityId = entity.name as string;

      if (dryRun) {
        results.push({
          entityId,
          entityType: 'product_category',
          status: 'skipped',
          error: 'Dry run mode'
        });
        continue;
      }

      try {
        const createResult = await this.entityService.createEntities(
          [entity as unknown as Entity],
          { expertiseArea: this.config.defaultExpertiseArea, skipValidation: true }
        );

        results.push({
          entityId,
          entityType: 'product_category',
          status: createResult.success ? 'created' : 'failed',
          error: createResult.errors?.join(', ')
        });

        if (createResult.success) {
          stats.entitiesCreated++;
        }
      } catch (error) {
        results.push({
          entityId,
          entityType: 'product_category',
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    // Create hierarchy relationships
    for (const cat of hierarchy) {
      if (cat.parentSlug) {
        const childEntityId = `agar_category_${cat.slug.replace(/[^a-z0-9]/g, '_')}`;
        const parentEntityId = `agar_category_${cat.parentSlug.replace(/[^a-z0-9]/g, '_')}`;

        if (!dryRun) {
          try {
            const relation: Relation = {
              from: childEntityId,
              to: parentEntityId,
              relationType: 'subcategory_of'
            };

            const relResult = await this.relationService.createRelations(
              [relation],
              { expertiseArea: this.config.defaultExpertiseArea, skipValidation: true }
            );

            relations.push({
              from: childEntityId,
              to: parentEntityId,
              relationType: 'subcategory_of',
              status: relResult.success ? 'created' : 'failed',
              error: relResult.errors?.join(', ')
            });

            if (relResult.success) {
              stats.relationsCreated++;
            }
          } catch (error) {
            relations.push({
              from: childEntityId,
              to: parentEntityId,
              relationType: 'subcategory_of',
              status: 'failed',
              error: error instanceof Error ? error.message : 'Unknown error'
            });
          }
        }
      }
    }

    // Create brand entity
    const brandEntity = EntityBuilder.buildBrandEntity();
    if (!dryRun) {
      try {
        await this.entityService.createEntities(
          [brandEntity as unknown as Entity],
          { expertiseArea: this.config.defaultExpertiseArea, skipValidation: true }
        );
        stats.entitiesCreated++;
      } catch {
        // Brand may already exist
      }
    }

    return {
      success: results.filter(r => r.status === 'failed').length === 0,
      processed: results.filter(r => r.status !== 'failed').length,
      failed: results.filter(r => r.status === 'failed').length,
      results,
      relations,
      stats
    };
  }

  /**
   * Sync catalog entities to graph
   */
  async syncCatalogEntities(dryRun: boolean = false): Promise<BatchResult> {
    const catalog = await this.ensureCatalog();
    if (!catalog) {
      return {
        success: false,
        processed: 0,
        failed: 0,
        results: [],
        errors: [{ item: 'catalog', error: 'Catalog not loaded', code: 'CATALOG_NOT_LOADED' }]
      };
    }

    const results: EntityResult[] = [];
    const stats: BatchStats = {
      entitiesCreated: 0,
      entitiesUpdated: 0,
      entitiesSkipped: 0,
      relationsCreated: 0,
      relationsSkipped: 0
    };

    const unsyncedEntities = catalog.getUnsyncedEntities();

    for (const { entityType, instance } of unsyncedEntities) {
      const entity = catalog.buildGraphEntity(entityType, instance.id);
      if (!entity) continue;

      if (dryRun) {
        results.push({
          entityId: entity.name as string,
          entityType: entityType,
          status: 'skipped',
          error: 'Dry run mode'
        });
        continue;
      }

      try {
        const createResult = await this.entityService.createEntities(
          [entity as unknown as Entity],
          { expertiseArea: this.config.defaultExpertiseArea, skipValidation: true }
        );

        if (createResult.success) {
          catalog.markSynced(entityType, instance.id);
          stats.entitiesCreated++;
        }

        results.push({
          entityId: entity.name as string,
          entityType,
          status: createResult.success ? 'created' : 'failed',
          error: createResult.errors?.join(', ')
        });
      } catch (error) {
        results.push({
          entityId: entity.name as string,
          entityType,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    // Save catalog if changes were made
    if (!dryRun && catalog.isDirty()) {
      await catalog.save();
    }

    return {
      success: results.filter(r => r.status === 'failed').length === 0,
      processed: results.filter(r => r.status !== 'failed').length,
      failed: results.filter(r => r.status === 'failed').length,
      results,
      stats
    };
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

  // ============================================================================
  // Helper methods
  // ============================================================================

  private async findProductFiles(scrapeRunPath: string): Promise<string[]> {
    const productsDir = path.join(scrapeRunPath, 'products');
    try {
      const files = await fs.readdir(productsDir);
      return files
        .filter(f => f.endsWith('.json'))
        .map(f => path.join(productsDir, f));
    } catch {
      return [];
    }
  }

  private async findCategoryFiles(scrapeRunPath: string): Promise<string[]> {
    const categoriesDir = path.join(scrapeRunPath, 'categories');
    try {
      const files = await fs.readdir(categoriesDir);
      return files
        .filter(f => f.endsWith('.json'))
        .map(f => path.join(categoriesDir, f));
    } catch {
      return [];
    }
  }

  private normalizeProductInput(data: Record<string, unknown>): ProductInput {
    return {
      product_name: (data.product_name as string) || '',
      product_code: (data.product_code as string) || '',
      product_url: (data.product_url as string) || '',
      product_overview: (data.product_overview as string) || '',
      product_description: (data.product_description as string) || '',
      product_categories: (data.product_categories as string[]) || [],
      product_image_url: data.product_image_url as string,
      product_skus: data.product_skus as string[],
      container_sizes: data.container_sizes as string[],
      pds_url: data.pds_url as string,
      sds_url: data.sds_url as string,
      scraped_at: data.scraped_at as string
    };
  }

  private normalizeCategoryInput(data: Record<string, unknown>): CategoryInput {
    return {
      name: (data.name as string) || (data.category_name as string) || '',
      slug: (data.slug as string) || (data.category_slug as string) || '',
      url: data.url as string
    };
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  private buildCategoryHierarchy(categories: CategoryInput[]): CategoryHierarchy[] {
    const hierarchy: CategoryHierarchy[] = [];

    for (const category of categories) {
      const parts = category.slug.split('/');

      if (parts.length > 1) {
        // Has parent
        hierarchy.push({
          slug: category.slug,
          parentSlug: parts.slice(0, -1).join('/'),
          children: []
        });
      } else {
        hierarchy.push({
          slug: category.slug,
          children: []
        });
      }
    }

    // Build children references
    for (const cat of hierarchy) {
      if (cat.parentSlug) {
        const parent = hierarchy.find(h => h.slug === cat.parentSlug);
        if (parent) {
          parent.children.push(cat.slug);
        }
      }
    }

    return hierarchy;
  }
}

export default MetadataProcessingService;
