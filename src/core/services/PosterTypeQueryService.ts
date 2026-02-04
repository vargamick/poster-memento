/**
 * Poster Type Query Service
 *
 * Helper methods for querying posters by type using HAS_TYPE relationships.
 * Supports both the new relationship-based model and legacy poster_type property.
 */

import type { StorageProvider } from '../../storage/StorageProvider.js';
import type { Entity, KnowledgeGraph } from '../../KnowledgeGraphManager.js';
import type { Relation } from '../../types/relation.js';
import { logger } from '../../utils/logger.js';

/**
 * Poster with type information from HAS_TYPE relationships
 */
export interface PosterWithType extends Entity {
  typeRelationships?: Array<{
    typeKey: string;
    typeName: string;
    confidence: number;
    source: string;
    isPrimary: boolean;
  }>;
  /** Legacy poster_type property (for backward compatibility) */
  poster_type?: string;
}

/**
 * Options for querying posters by type
 */
export interface PosterTypeQueryOptions {
  /** Only include posters with confidence above this threshold */
  minConfidence?: number;
  /** Limit number of results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

/**
 * Service for type-based poster queries
 */
export class PosterTypeQueryService {
  constructor(private storageProvider: StorageProvider) {}

  /**
   * Find all posters of a specific type using HAS_TYPE relationships.
   * No fallbacks - requires proper HAS_TYPE relationships to exist.
   */
  async findPostersByType(
    typeKey: string,
    options: PosterTypeQueryOptions = {}
  ): Promise<PosterWithType[]> {
    const {
      minConfidence = 0,
      limit = 100,
      offset = 0,
    } = options;

    if (typeof (this.storageProvider as any).runCypher !== 'function') {
      throw new Error('Cypher queries required for type-based poster lookup. Neo4j storage provider required.');
    }

    try {
      const cypher = `
        MATCH (p:Entity {entityType: 'Poster'})-[r:HAS_TYPE]->(t:Entity {entityType: 'PosterType'})
        WHERE t.type_key = $typeKey OR t.name = $posterTypeName
        ${minConfidence > 0 ? 'AND r.confidence >= $minConfidence' : ''}
        RETURN p, r, t
        ORDER BY r.confidence DESC, p.name
        SKIP $offset
        LIMIT $limit
      `;

      const posterTypeName = `PosterType_${typeKey}`;
      const params = {
        typeKey,
        posterTypeName,
        minConfidence,
        offset,
        limit,
      };

      const results = await (this.storageProvider as any).runCypher(cypher, params);
      return this.processRelationshipResults(results);
    } catch (error) {
      logger.error(`Error finding posters by type '${typeKey}'`, error);
      throw error;
    }
  }

  /**
   * Find posters with multiple types (hybrid posters).
   * No fallbacks - requires Neo4j with Cypher support.
   */
  async findMultiTypePosters(options: PosterTypeQueryOptions = {}): Promise<PosterWithType[]> {
    const { limit = 100, offset = 0 } = options;

    if (typeof (this.storageProvider as any).runCypher !== 'function') {
      throw new Error('Cypher queries required for multi-type poster lookup. Neo4j storage provider required.');
    }

    try {
      // Note: type_key extracted from entity name since it's not stored as a property
      const cypher = `
        MATCH (p:Entity {entityType: 'Poster'})-[r:HAS_TYPE]->(t:Entity {entityType: 'PosterType'})
        WITH p, collect({
          typeKey: CASE WHEN t.type_key IS NOT NULL THEN t.type_key ELSE replace(t.name, 'PosterType_', '') END,
          typeName: t.name,
          confidence: r.confidence,
          source: r.source,
          isPrimary: r.is_primary
        }) as types
        WHERE size(types) > 1
        RETURN p, types
        ORDER BY size(types) DESC, p.name
        SKIP $offset
        LIMIT $limit
      `;

      const results = await (this.storageProvider as any).runCypher(cypher, { offset, limit });
      return this.processMultiTypeResults(results);
    } catch (error) {
      logger.error('Error finding multi-type posters', error);
      throw error;
    }
  }

  /**
   * Get type statistics (count of posters per type).
   * No fallbacks - requires Neo4j with Cypher support.
   */
  async getTypeStatistics(): Promise<Array<{ typeKey: string; count: number; avgConfidence: number }>> {
    if (typeof (this.storageProvider as any).runCypher !== 'function') {
      throw new Error('Cypher queries required for type statistics. Neo4j storage provider required.');
    }

    try {
      // Note: type_key extracted from entity name since it's not stored as a property
      const cypher = `
        MATCH (p:Entity {entityType: 'Poster'})-[r:HAS_TYPE]->(t:Entity {entityType: 'PosterType'})
        RETURN CASE WHEN t.type_key IS NOT NULL THEN t.type_key ELSE replace(t.name, 'PosterType_', '') END as typeKey,
               count(p) as count, avg(r.confidence) as avgConfidence
        ORDER BY count DESC
      `;

      const results = await (this.storageProvider as any).runCypher(cypher, {});
      return results.records?.map((record: any) => ({
        typeKey: record.get('typeKey') || 'unknown',
        count: record.get('count')?.toInt?.() || record.get('count') || 0,
        avgConfidence: record.get('avgConfidence') || 0,
      })) || [];
    } catch (error) {
      logger.error('Error getting type statistics', error);
      throw error;
    }
  }

  /**
   * Get the type(s) for a specific poster using HAS_TYPE relationships.
   * No fallbacks - returns empty array if no relationships exist.
   */
  async getPosterTypes(posterName: string): Promise<Array<{
    typeKey: string;
    confidence: number;
    source: string;
    isPrimary: boolean;
  }>> {
    if (typeof (this.storageProvider as any).runCypher !== 'function') {
      throw new Error('Cypher queries required for poster type lookup. Neo4j storage provider required.');
    }

    try {
      // Note: type_key extracted from entity name since it's not stored as a property
      const cypher = `
        MATCH (p:Entity {name: $posterName})-[r:HAS_TYPE]->(t:Entity {entityType: 'PosterType'})
        RETURN CASE WHEN t.type_key IS NOT NULL THEN t.type_key ELSE replace(t.name, 'PosterType_', '') END as typeKey,
               r.confidence as confidence, r.source as source, r.is_primary as isPrimary
        ORDER BY r.is_primary DESC, r.confidence DESC
      `;

      const results = await (this.storageProvider as any).runCypher(cypher, { posterName });
      return results.records?.map((record: any) => ({
        typeKey: record.get('typeKey') || 'unknown',
        confidence: record.get('confidence') || 0,
        source: record.get('source') || 'unknown',
        isPrimary: record.get('isPrimary') ?? false,
      })) || [];
    } catch (error) {
      logger.error(`Error getting types for poster '${posterName}'`, error);
      throw error;
    }
  }

  /**
   * Enrich multiple poster entities with their HAS_TYPE relationships.
   * Performs a single batch query for efficiency.
   * No fallbacks - requires Neo4j with Cypher support.
   */
  async enrichPostersWithTypes<T extends Entity>(posters: T[]): Promise<(T & { typeRelationships: Array<{ typeKey: string; typeName: string; confidence: number; source: string; isPrimary: boolean }> })[]> {
    if (posters.length === 0) {
      return [];
    }

    const hasCypher = typeof (this.storageProvider as any).runCypher === 'function';
    logger.debug('enrichPostersWithTypes: hasCypher:', hasCypher, 'posters:', posters.length);

    if (!hasCypher) {
      throw new Error('Cypher queries required for poster type enrichment. Neo4j storage provider required.');
    }

    const posterNames = posters.map(p => p.name);

    try {
      // Batch query to get all type relationships for the given posters
      // Note: type_key is extracted from entity name (PosterType_{key}) since it's not stored as a property
      const cypher = `
        MATCH (p:Entity)-[r:HAS_TYPE]->(t:Entity {entityType: 'PosterType'})
        WHERE p.name IN $posterNames
        RETURN p.name as posterName,
               CASE WHEN t.type_key IS NOT NULL THEN t.type_key
                    ELSE replace(t.name, 'PosterType_', '') END as typeKey,
               t.name as typeName,
               r.confidence as confidence,
               r.source as source,
               r.is_primary as isPrimary
        ORDER BY p.name, r.is_primary DESC, r.confidence DESC
      `;

      const results = await (this.storageProvider as any).runCypher(cypher, { posterNames });

      // Build a map of poster name -> type relationships
      const typeMap = new Map<string, Array<{ typeKey: string; typeName: string; confidence: number; source: string; isPrimary: boolean }>>();

      if (results.records) {
        for (const record of results.records) {
          const posterName = record.get('posterName');
          if (!typeMap.has(posterName)) {
            typeMap.set(posterName, []);
          }
          typeMap.get(posterName)!.push({
            typeKey: record.get('typeKey') || 'unknown',
            typeName: record.get('typeName') || '',
            confidence: record.get('confidence') ?? 0,
            source: record.get('source') || 'unknown',
            isPrimary: record.get('isPrimary') ?? false,
          });
        }
      }

      // Enrich each poster with its type relationships (empty array if no relationships)
      return posters.map(poster => ({
        ...poster,
        typeRelationships: typeMap.get(poster.name) || [],
      }));
    } catch (error) {
      logger.error('Error enriching posters with types', error);
      throw error;
    }
  }

  /**
   * Process Cypher results for relationship-based queries
   */
  private processRelationshipResults(results: any): PosterWithType[] {
    if (!results.records) return [];

    const posterMap = new Map<string, PosterWithType>();

    for (const record of results.records) {
      const p = record.get('p');
      const r = record.get('r');
      const t = record.get('t');

      if (!p) continue;

      const posterName = p.properties?.name;
      if (!posterName) continue;

      if (!posterMap.has(posterName)) {
        posterMap.set(posterName, {
          name: posterName,
          entityType: 'Poster',
          observations: p.properties?.observations || [],
          typeRelationships: [],
        });
      }

      const poster = posterMap.get(posterName)!;
      // Extract type_key from entity name if not stored as property
      const typeName = t.properties?.name || '';
      const typeKey = t.properties?.type_key || typeName.replace('PosterType_', '') || 'unknown';
      poster.typeRelationships!.push({
        typeKey,
        typeName,
        confidence: r.properties?.confidence || 0,
        source: r.properties?.source || 'unknown',
        isPrimary: r.properties?.is_primary ?? false,
      });
    }

    return Array.from(posterMap.values());
  }

  /**
   * Process multi-type query results
   */
  private processMultiTypeResults(results: any): PosterWithType[] {
    if (!results.records) return [];

    return results.records.map((record: any) => {
      const p = record.get('p');
      const types = record.get('types');

      return {
        name: p.properties?.name || '',
        entityType: 'Poster',
        observations: p.properties?.observations || [],
        typeRelationships: types || [],
      };
    });
  }
}
