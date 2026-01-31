/**
 * Catalog Loader Utility
 *
 * Loads and manages entity type catalogs for synonym-aware extraction.
 * Supports discovery queue for unknown terms found during processing.
 *
 * Adapted from scripts/agar-processing/utils/catalog-loader.ts
 * for use within the processing service.
 */

import { promises as fs } from 'fs';
import { logger } from '../../../utils/logger.js';

/**
 * Catalog instance representing a single entity within an entity type
 */
export interface CatalogInstance {
  id: string;
  primaryTerm: string;
  synonyms: string[];
  displayName: string;
  category: string;
  metadata: Record<string, unknown>;
  syncedToGraph: boolean;
}

/**
 * Entity type definition in the catalog
 */
export interface CatalogEntityType {
  mandatory: boolean;
  idPrefix: string;
  graphEntityType: string | null;
  displayName: string;
  description: string;
  defaultRelationType: string | null;
  extractionEnabled: boolean;
  instances: CatalogInstance[];
}

/**
 * Discovery queue entry for new terms found during processing
 */
export interface DiscoveryEntry {
  term: string;
  contexts: string[];
  occurrenceCount: number;
  firstSeenAt: string;
  suggestedPrimaryTerm: string;
  suggestedCategory: string | null;
  status: 'pending' | 'approved' | 'rejected';
  reviewedAt: string | null;
  reviewedBy: string | null;
}

/**
 * Extraction configuration options
 */
export interface ExtractionConfig {
  caseSensitive: boolean;
  matchWholeWords: boolean;
  minConfidence: number;
  enableFuzzyMatching: boolean;
  fuzzyThreshold: number;
}

/**
 * Catalog metadata for tracking sync status
 */
export interface CatalogMetadata {
  instanceName: string;
  lastUpdated: string;
  lastSyncedToGraph: string | null;
  pendingDiscoveries: number;
}

/**
 * The complete catalog structure
 */
export interface EntityTypeCatalog {
  version: string;
  catalogMetadata: CatalogMetadata;
  entityTypes: Record<string, CatalogEntityType>;
  discoveryQueue: Record<string, DiscoveryEntry[]>;
  extractionConfig: ExtractionConfig;
}

/**
 * Result of extraction from text
 */
export interface ExtractionResult {
  entityType: string;
  instanceId: string;
  matchedTerm: string;
  primaryTerm: string;
  graphEntityName: string;
  confidence: number;
  matchType: 'exact' | 'synonym';
}

/**
 * Graph sync result
 */
export interface GraphSyncResult {
  created: number;
  existing: number;
  failed: number;
  errors: string[];
}

/**
 * Options for the catalog loader
 */
export interface CatalogLoaderOptions {
  catalogPath?: string;
  autoSync?: boolean;
  apiUrl?: string;
  apiKey?: string;
}

/**
 * Term index entry for fast lookup
 */
interface TermIndexEntry {
  entityType: string;
  instance: CatalogInstance;
  isExact: boolean; // true if this is the primary term
}

/**
 * CatalogLoader - Loads and manages entity type catalogs for extraction
 *
 * Supports:
 * - Loading catalog from JSON file
 * - Synonym-based entity extraction from text
 * - Discovery queue for unknown terms
 * - Building graph entities from catalog instances
 */
export class CatalogLoader {
  private catalog: EntityTypeCatalog | null = null;
  private catalogPath: string = '';
  private termIndex: Map<string, TermIndexEntry[]> = new Map();
  private dirty: boolean = false;

  /**
   * Load catalog from JSON file
   */
  async load(catalogPath: string): Promise<void> {
    this.catalogPath = catalogPath;

    try {
      const content = await fs.readFile(catalogPath, 'utf-8');
      this.catalog = JSON.parse(content) as EntityTypeCatalog;
      this.buildTermIndex();
      logger.info('Catalog loaded', {
        path: catalogPath,
        entityTypes: Object.keys(this.catalog.entityTypes).length
      });
    } catch (error: unknown) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        throw new Error(`Catalog file not found: ${catalogPath}`);
      }
      throw new Error(`Failed to load catalog: ${err.message}`);
    }
  }

  /**
   * Build term index for fast lookup during extraction
   */
  private buildTermIndex(): void {
    if (!this.catalog) return;

    this.termIndex.clear();

    for (const [entityType, config] of Object.entries(this.catalog.entityTypes)) {
      if (!config.extractionEnabled) continue;

      for (const instance of config.instances) {
        // Index primary term (exact match)
        const primaryKey = instance.primaryTerm.toLowerCase();
        this.addToIndex(primaryKey, {
          entityType,
          instance,
          isExact: true
        });

        // Index synonyms
        for (const synonym of instance.synonyms) {
          const synonymKey = synonym.toLowerCase();
          this.addToIndex(synonymKey, {
            entityType,
            instance,
            isExact: false
          });
        }
      }
    }
  }

  /**
   * Add entry to term index (handles multiple entries per term)
   */
  private addToIndex(term: string, entry: TermIndexEntry): void {
    const existing = this.termIndex.get(term) || [];
    existing.push(entry);
    this.termIndex.set(term, existing);
  }

  /**
   * Extract entities from text using catalog
   *
   * @param text - Text to extract entities from
   * @param entityTypes - Optional filter for specific entity types
   * @returns Array of extraction results
   */
  extractFromText(text: string, entityTypes?: string[]): ExtractionResult[] {
    if (!this.catalog) {
      throw new Error('Catalog not loaded. Call load() first.');
    }

    const results: ExtractionResult[] = [];
    const normalizedText = text.toLowerCase();
    const matchedInstances = new Set<string>(); // Track by entityType:instanceId

    // Sort terms by length descending to match longer phrases first
    const sortedTerms = Array.from(this.termIndex.keys())
      .sort((a, b) => b.length - a.length);

    for (const term of sortedTerms) {
      // Check if term appears in text
      if (!normalizedText.includes(term)) continue;

      const entries = this.termIndex.get(term) || [];

      for (const entry of entries) {
        // Filter by entity type if specified
        if (entityTypes && !entityTypes.includes(entry.entityType)) continue;

        // Skip if we already matched this instance
        const instanceKey = `${entry.entityType}:${entry.instance.id}`;
        if (matchedInstances.has(instanceKey)) continue;

        matchedInstances.add(instanceKey);

        const config = this.catalog.entityTypes[entry.entityType];
        const graphEntityName = `${config.idPrefix}${entry.instance.id}`;

        results.push({
          entityType: entry.entityType,
          instanceId: entry.instance.id,
          matchedTerm: term,
          primaryTerm: entry.instance.primaryTerm,
          graphEntityName,
          confidence: entry.isExact ? 1.0 : 0.95,
          matchType: entry.isExact ? 'exact' : 'synonym'
        });
      }
    }

    return results;
  }

  /**
   * Extract only mandatory entity types from text
   */
  extractMandatory(text: string): ExtractionResult[] {
    if (!this.catalog) {
      throw new Error('Catalog not loaded. Call load() first.');
    }

    const mandatoryTypes = Object.entries(this.catalog.entityTypes)
      .filter(([_, config]) => config.mandatory)
      .map(([type, _]) => type);

    return this.extractFromText(text, mandatoryTypes);
  }

  /**
   * Get all instances of an entity type
   */
  getInstances(entityType: string): CatalogInstance[] {
    if (!this.catalog) {
      throw new Error('Catalog not loaded. Call load() first.');
    }

    const config = this.catalog.entityTypes[entityType];
    if (!config) {
      throw new Error(`Unknown entity type: ${entityType}`);
    }

    return config.instances;
  }

  /**
   * Get entity type configuration
   */
  getEntityTypeConfig(entityType: string): CatalogEntityType | null {
    if (!this.catalog) return null;
    return this.catalog.entityTypes[entityType] || null;
  }

  /**
   * Check if entity type is mandatory
   */
  isMandatory(entityType: string): boolean {
    if (!this.catalog) return false;
    const config = this.catalog.entityTypes[entityType];
    return config?.mandatory ?? false;
  }

  /**
   * Add new term to discovery queue
   */
  addDiscovery(entityType: string, term: string, context: string): void {
    if (!this.catalog) {
      throw new Error('Catalog not loaded. Call load() first.');
    }

    if (!this.catalog.discoveryQueue[entityType]) {
      this.catalog.discoveryQueue[entityType] = [];
    }

    const queue = this.catalog.discoveryQueue[entityType];
    const normalizedTerm = term.toLowerCase().trim();

    // Check if already in queue
    const existing = queue.find(d => d.term.toLowerCase() === normalizedTerm);

    if (existing) {
      // Update existing entry
      existing.occurrenceCount++;
      if (!existing.contexts.includes(context)) {
        existing.contexts.push(context.substring(0, 200));
      }
    } else {
      // Add new discovery
      queue.push({
        term: normalizedTerm,
        contexts: [context.substring(0, 200)],
        occurrenceCount: 1,
        firstSeenAt: new Date().toISOString(),
        suggestedPrimaryTerm: normalizedTerm,
        suggestedCategory: null,
        status: 'pending',
        reviewedAt: null,
        reviewedBy: null
      });

      this.catalog.catalogMetadata.pendingDiscoveries++;
    }

    this.dirty = true;
  }

  /**
   * Get pending discoveries for an entity type
   */
  getDiscoveries(entityType?: string): Record<string, DiscoveryEntry[]> {
    if (!this.catalog) {
      throw new Error('Catalog not loaded. Call load() first.');
    }

    if (entityType) {
      return { [entityType]: this.catalog.discoveryQueue[entityType] || [] };
    }

    return this.catalog.discoveryQueue;
  }

  /**
   * Approve a discovery and add it to the catalog
   */
  approveDiscovery(
    entityType: string,
    term: string,
    options: {
      primaryTerm?: string;
      synonyms?: string[];
      displayName?: string;
      category?: string;
    } = {}
  ): void {
    if (!this.catalog) {
      throw new Error('Catalog not loaded. Call load() first.');
    }

    const queue = this.catalog.discoveryQueue[entityType];
    if (!queue) {
      throw new Error(`No discovery queue for entity type: ${entityType}`);
    }

    const discovery = queue.find(d => d.term.toLowerCase() === term.toLowerCase());
    if (!discovery) {
      throw new Error(`Discovery not found: ${term}`);
    }

    // Create new instance
    const id = (options.primaryTerm || term)
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '');

    const newInstance: CatalogInstance = {
      id,
      primaryTerm: options.primaryTerm || term,
      synonyms: options.synonyms || [],
      displayName: options.displayName || term,
      category: options.category || 'unknown',
      metadata: {},
      syncedToGraph: false
    };

    // Add to entity type instances
    this.catalog.entityTypes[entityType].instances.push(newInstance);

    // Mark discovery as approved
    discovery.status = 'approved';
    discovery.reviewedAt = new Date().toISOString();

    // Update pending count
    this.catalog.catalogMetadata.pendingDiscoveries = Object.values(this.catalog.discoveryQueue)
      .flat()
      .filter(d => d.status === 'pending')
      .length;

    // Rebuild index
    this.buildTermIndex();

    this.dirty = true;
  }

  /**
   * Reject a discovery
   */
  rejectDiscovery(entityType: string, term: string): void {
    if (!this.catalog) {
      throw new Error('Catalog not loaded. Call load() first.');
    }

    const queue = this.catalog.discoveryQueue[entityType];
    if (!queue) return;

    const discovery = queue.find(d => d.term.toLowerCase() === term.toLowerCase());
    if (discovery) {
      discovery.status = 'rejected';
      discovery.reviewedAt = new Date().toISOString();

      // Update pending count
      this.catalog.catalogMetadata.pendingDiscoveries = Object.values(this.catalog.discoveryQueue)
        .flat()
        .filter(d => d.status === 'pending')
        .length;

      this.dirty = true;
    }
  }

  /**
   * Build a graph entity from catalog instance
   */
  buildGraphEntity(entityType: string, instanceId: string): Record<string, unknown> | null {
    if (!this.catalog) return null;

    const config = this.catalog.entityTypes[entityType];
    if (!config || !config.graphEntityType) return null;

    const instance = config.instances.find(i => i.id === instanceId);
    if (!instance) return null;

    const entityName = `${config.idPrefix}${instance.id}`;

    return {
      name: entityName,
      entityType: config.graphEntityType,
      observations: [
        `${config.displayName}: ${instance.displayName}`,
        `Category: ${instance.category}`,
        `Synonyms: ${instance.synonyms.join(', ')}`
      ],
      metadata: {
        ...instance.metadata,
        catalogId: instance.id,
        primaryTerm: instance.primaryTerm,
        displayName: instance.displayName,
        category: instance.category,
        synonyms: instance.synonyms
      }
    };
  }

  /**
   * Get all entities that need to be synced to graph
   */
  getUnsyncedEntities(): Array<{ entityType: string; instance: CatalogInstance }> {
    if (!this.catalog) return [];

    const unsynced: Array<{ entityType: string; instance: CatalogInstance }> = [];

    for (const [entityType, config] of Object.entries(this.catalog.entityTypes)) {
      if (!config.graphEntityType) continue;

      for (const instance of config.instances) {
        if (!instance.syncedToGraph) {
          unsynced.push({ entityType, instance });
        }
      }
    }

    return unsynced;
  }

  /**
   * Mark an instance as synced to graph
   */
  markSynced(entityType: string, instanceId: string): void {
    if (!this.catalog) return;

    const config = this.catalog.entityTypes[entityType];
    if (!config) return;

    const instance = config.instances.find(i => i.id === instanceId);
    if (instance) {
      instance.syncedToGraph = true;
      this.dirty = true;
    }
  }

  /**
   * Save catalog back to file
   */
  async save(): Promise<void> {
    if (!this.catalog || !this.catalogPath) {
      throw new Error('Catalog not loaded. Call load() first.');
    }

    this.catalog.catalogMetadata.lastUpdated = new Date().toISOString();

    const content = JSON.stringify(this.catalog, null, 2);
    await fs.writeFile(this.catalogPath, content, 'utf-8');

    this.dirty = false;
    logger.info('Catalog saved', { path: this.catalogPath });
  }

  /**
   * Check if catalog has unsaved changes
   */
  isDirty(): boolean {
    return this.dirty;
  }

  /**
   * Get catalog metadata
   */
  getMetadata(): CatalogMetadata | null {
    return this.catalog?.catalogMetadata || null;
  }

  /**
   * Get all entity types
   */
  getEntityTypes(): string[] {
    if (!this.catalog) return [];
    return Object.keys(this.catalog.entityTypes);
  }

  /**
   * Get extraction statistics
   */
  getStats(): {
    entityTypes: number;
    totalInstances: number;
    totalSynonyms: number;
    pendingDiscoveries: number;
  } {
    if (!this.catalog) {
      return { entityTypes: 0, totalInstances: 0, totalSynonyms: 0, pendingDiscoveries: 0 };
    }

    let totalInstances = 0;
    let totalSynonyms = 0;

    for (const config of Object.values(this.catalog.entityTypes)) {
      totalInstances += config.instances.length;
      for (const instance of config.instances) {
        totalSynonyms += instance.synonyms.length;
      }
    }

    return {
      entityTypes: Object.keys(this.catalog.entityTypes).length,
      totalInstances,
      totalSynonyms,
      pendingDiscoveries: this.catalog.catalogMetadata.pendingDiscoveries
    };
  }
}

/**
 * Factory function to create and load a catalog
 */
export async function createCatalogLoader(catalogPath: string): Promise<CatalogLoader> {
  const loader = new CatalogLoader();
  await loader.load(catalogPath);
  return loader;
}

export default CatalogLoader;
