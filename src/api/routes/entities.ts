import { Router } from 'express';
import type { EntityService } from '../../core/services/EntityService.js';
import { PosterTypeQueryService } from '../../core/services/PosterTypeQueryService.js';
import type { StorageProvider } from '../../storage/StorageProvider.js';
import { asyncHandler, ValidationError, NotFoundError } from '../middleware/errorHandler.js';
import { logger } from '../../utils/logger.js';

/**
 * Project only requested fields from an entity
 */
function projectFields(entity: any, fields: string[]): any {
  if (fields.length === 0) return entity;
  const projected: any = {};
  for (const field of fields) {
    if (entity[field] !== undefined) {
      projected[field] = entity[field];
    }
  }
  return projected;
}

/**
 * Match a term against entity names using different strategies
 */
function matchTerm(term: string, entityName: string, mode: string, prefix?: string): { matches: boolean; confidence: number; matchType: string } {
  const normalizedTerm = term.toLowerCase();
  // Remove prefix if provided (e.g., "agar_surface_" from "agar_surface_marble")
  const suffix = prefix ? entityName.replace(prefix, '').toLowerCase() : entityName.toLowerCase();

  // Exact match
  if (suffix === normalizedTerm) {
    return { matches: true, confidence: 1.0, matchType: 'exact' };
  }

  if (mode === 'exact') {
    return { matches: false, confidence: 0, matchType: 'none' };
  }

  // Substring match
  if (suffix.includes(normalizedTerm) || normalizedTerm.includes(suffix)) {
    return { matches: true, confidence: 0.9, matchType: 'substring' };
  }

  if (mode === 'substring') {
    return { matches: false, confidence: 0, matchType: 'none' };
  }

  // Partial/prefix match (fuzzy mode)
  if (suffix.startsWith(normalizedTerm) || normalizedTerm.startsWith(suffix)) {
    return { matches: true, confidence: 0.8, matchType: 'partial' };
  }

  return { matches: false, confidence: 0, matchType: 'none' };
}

/**
 * Create entity routes
 */
export function createEntityRoutes(entityService: EntityService, storageProvider?: StorageProvider): Router {
  const router = Router();

  // Create PosterTypeQueryService for enriching Poster entities with HAS_TYPE relationships
  const posterTypeQueryService = storageProvider ? new PosterTypeQueryService(storageProvider) : null;

  /**
   * GET /entities - List or search entities with optional filtering
   *
   * Backwards compatible: existing behavior preserved for q param
   *
   * New features:
   * - List by entityTypes without q param
   * - fields: Comma-separated fields to return (projection for lightweight payloads)
   * - match: Comma-separated terms to match against entity names
   * - matchMode: 'exact' | 'substring' | 'fuzzy' (default: 'fuzzy')
   * - matchPrefix: Prefix to strip from entity names when matching
   */
  router.get('/', asyncHandler(async (req, res) => {
    const {
      limit = 10,
      offset = 0,
      entityTypes,
      expertiseArea,
      includeValidation = false,
      fields,
      match,
      matchMode = 'fuzzy',
      matchPrefix,
      q: query
    } = req.query;

    // Parse query parameters
    const parsedFields = fields ? (fields as string).split(',').map(f => f.trim()) : [];
    const parsedMatch = match ? (match as string).split(',').map(m => m.trim()) : [];
    const parsedMatchMode = (matchMode as string) || 'fuzzy';
    const parsedMatchPrefix = matchPrefix as string | undefined;
    const parsedEntityTypes = entityTypes ? (entityTypes as string).split(',') : undefined;
    const parsedIncludeValidation = includeValidation === 'true';

    // Allow higher limits for projected queries (lightweight payloads)
    const maxLimit = parsedFields.length > 0 ? 500 : 100;
    const parsedLimit = Math.min(parseInt(limit as string) || 10, maxLimit);
    const parsedOffset = parseInt(offset as string) || 0;

    // Original behavior: query param required unless entityTypes specified
    if (query && typeof query === 'string') {
      // Search entities (original behavior)
      const result = await entityService.searchEntities(query, {
        limit: parsedLimit,
        offset: parsedOffset,
        entityTypes: parsedEntityTypes,
        expertiseArea: expertiseArea as string,
        includeValidation: parsedIncludeValidation
      });

      if (!result.success) {
        throw new ValidationError('Search failed', result.errors);
      }

      let entities = result.data?.entities || [];

      // Enrich Poster entities with HAS_TYPE relationships
      logger.debug('Entities route: posterTypeQueryService available:', !!posterTypeQueryService, 'entities count:', entities.length);
      if (posterTypeQueryService && entities.length > 0) {
        const posterEntities = entities.filter(e => e.entityType === 'Poster');
        logger.debug('Poster entities to enrich:', posterEntities.length);
        if (posterEntities.length > 0) {
          try {
            const enrichedPosters = await posterTypeQueryService.enrichPostersWithTypes(posterEntities);
            logger.debug('Enriched posters:', enrichedPosters.length, 'sample typeRelationships:', enrichedPosters[0]?.typeRelationships);
            const enrichedMap = new Map(enrichedPosters.map(p => [p.name, p]));
            entities = entities.map(e =>
              e.entityType === 'Poster' && enrichedMap.has(e.name)
                ? enrichedMap.get(e.name)!
                : e
            );
          } catch (err: any) {
            logger.error('[entities route - search] Failed to enrich posters with types:', {
              message: err?.message,
              stack: err?.stack,
              name: err?.name,
              raw: String(err)
            });
          }
        }
      }

      // Apply field projection if requested
      if (parsedFields.length > 0) {
        entities = entities.map(e => projectFields(e, parsedFields));
      }

      // Extract total from pagination metadata returned by storage provider
      const paginationTotal = (result.data as any)?.pagination?.total ?? result.data?.entities.length ?? 0;

      res.json({
        data: {
          entities,
          relations: result.data?.relations || []
        },
        pagination: {
          limit: parsedLimit,
          offset: parsedOffset,
          total: paginationTotal
        },
        warnings: result.warnings,
        suggestions: result.suggestions
      });

    } else if (parsedEntityTypes && parsedEntityTypes.length > 0) {
      // NEW: List entities by type without search query
      const result = await entityService.searchEntities('', {
        limit: parsedLimit,
        offset: parsedOffset,
        entityTypes: parsedEntityTypes,
        expertiseArea: expertiseArea as string,
        includeValidation: parsedIncludeValidation
      });

      if (!result.success) {
        throw new ValidationError('Listing failed', result.errors);
      }

      let entities = result.data?.entities || [];

      // Enrich Poster entities with HAS_TYPE relationships
      logger.info('[entities route] posterTypeQueryService available:', !!posterTypeQueryService, 'entities count:', entities.length);
      if (posterTypeQueryService && entities.length > 0) {
        const posterEntities = entities.filter(e => e.entityType === 'Poster');
        logger.info('[entities route] Poster entities to enrich:', posterEntities.length);
        if (posterEntities.length > 0) {
          try {
            const enrichedPosters = await posterTypeQueryService.enrichPostersWithTypes(posterEntities);
            logger.info('[entities route] Enriched posters:', enrichedPosters.length, 'sample typeRelationships:', JSON.stringify(enrichedPosters[0]?.typeRelationships?.slice(0, 2)));
            const enrichedMap = new Map(enrichedPosters.map(p => [p.name, p]));
            entities = entities.map(e =>
              e.entityType === 'Poster' && enrichedMap.has(e.name)
                ? enrichedMap.get(e.name)!
                : e
            );
          } catch (err: any) {
            logger.error('[entities route] Failed to enrich posters with types:', {
              message: err?.message,
              stack: err?.stack,
              name: err?.name,
              raw: String(err)
            });
          }
        }
      }

      // Apply term matching if requested
      if (parsedMatch.length > 0 && entities.length > 0) {
        const matchResults: any[] = [];

        for (const term of parsedMatch) {
          for (const entity of entities) {
            const matchResult = matchTerm(term, entity.name, parsedMatchMode, parsedMatchPrefix);
            if (matchResult.matches) {
              matchResults.push({
                inputTerm: term,
                entity: parsedFields.length > 0 ? projectFields(entity, parsedFields) : entity,
                confidence: matchResult.confidence,
                matchType: matchResult.matchType
              });
            }
          }
        }

        // Return match results format
        res.json({
          matches: matchResults,
          unmatchedTerms: parsedMatch.filter(term =>
            !matchResults.some(m => m.inputTerm === term)
          ),
          entityCount: entities.length,
          pagination: {
            limit: parsedLimit,
            offset: parsedOffset
          }
        });
        return;
      }

      // Apply field projection
      if (parsedFields.length > 0) {
        entities = entities.map(e => projectFields(e, parsedFields));
      }

      // Extract total from pagination metadata returned by storage provider
      const paginationTotal = (result.data as any)?.pagination?.total ?? result.data?.entities.length ?? 0;

      res.json({
        data: {
          entities,
          relations: result.data?.relations || []
        },
        pagination: {
          limit: parsedLimit,
          offset: parsedOffset,
          total: paginationTotal
        },
        warnings: result.warnings,
        suggestions: result.suggestions
      });

    } else {
      // Original behavior: show help when no query or entityTypes
      res.json({
        message: 'Entity listing not implemented. Use ?q=query to search entities.',
        availableParams: {
          q: 'Search query',
          limit: 'Number of results (max 100)',
          offset: 'Pagination offset',
          entityTypes: 'Comma-separated entity types (can list without q)',
          expertiseArea: 'Filter by expertise area',
          includeValidation: 'Include validation info (true/false)',
          fields: 'Comma-separated fields to return (projection)',
          match: 'Comma-separated terms to match against entity names',
          matchMode: 'exact | substring | fuzzy (default: fuzzy)',
          matchPrefix: 'Prefix to strip from entity names when matching'
        }
      });
    }
  }));

  /**
   * GET /entities/:name - Get a specific entity
   */
  router.get('/:name', asyncHandler(async (req, res) => {
    const { name } = req.params;
    const result = await entityService.getEntity(name);

    if (!result.success) {
      throw new NotFoundError(result.errors?.[0] || 'Entity not found');
    }

    let entity = result.data;

    // Enrich Poster entity with HAS_TYPE relationships
    if (posterTypeQueryService && entity?.entityType === 'Poster') {
      try {
        const enrichedPosters = await posterTypeQueryService.enrichPostersWithTypes([entity]);
        if (enrichedPosters.length > 0) {
          entity = enrichedPosters[0];
        }
      } catch (err) {
        logger.warn('Failed to enrich poster with types:', err);
      }
    }

    res.json({
      data: entity,
      warnings: result.warnings,
      suggestions: result.suggestions
    });
  }));

  /**
   * POST /entities - Create new entities
   */
  router.post('/', asyncHandler(async (req, res) => {
    const { entities, expertiseArea, context, validateOnly = false } = req.body;

    if (!entities || !Array.isArray(entities)) {
      throw new ValidationError('entities array is required');
    }

    // Validate entity structure
    for (const entity of entities) {
      if (!entity.name || typeof entity.name !== 'string') {
        throw new ValidationError('Each entity must have a valid name');
      }
      if (!entity.entityType || typeof entity.entityType !== 'string') {
        throw new ValidationError('Each entity must have a valid entityType');
      }
      if (!entity.observations || !Array.isArray(entity.observations)) {
        throw new ValidationError('Each entity must have an observations array');
      }
    }

    const result = await entityService.createEntities(entities, {
      expertiseArea,
      context,
      validateOnly
    });

    if (!result.success) {
      throw new ValidationError('Entity creation failed', result.errors);
    }

    const statusCode = validateOnly ? 200 : 201;
    res.status(statusCode).json({
      data: result.data,
      warnings: result.warnings,
      suggestions: result.suggestions,
      validation: result.validation
    });
  }));

  /**
   * PUT /entities/:name - Update an entity
   */
  router.put('/:name', asyncHandler(async (req, res) => {
    const { name } = req.params;
    const { updates, expertiseArea, context, validateOnly = false } = req.body;

    if (!updates || typeof updates !== 'object') {
      throw new ValidationError('updates object is required');
    }

    const result = await entityService.updateEntity(name, updates, {
      expertiseArea,
      context,
      validateOnly
    });

    if (!result.success) {
      if (result.errors?.[0]?.includes('not found')) {
        throw new NotFoundError(result.errors[0]);
      }
      throw new ValidationError('Entity update failed', result.errors);
    }

    res.json({
      data: result.data,
      warnings: result.warnings,
      suggestions: result.suggestions,
      validation: result.validation
    });
  }));

  /**
   * DELETE /entities/:name - Delete an entity
   */
  router.delete('/:name', asyncHandler(async (req, res) => {
    const { name } = req.params;
    
    const result = await entityService.deleteEntities([name]);

    if (!result.success) {
      throw new ValidationError('Entity deletion failed', result.errors);
    }

    res.status(204).send();
  }));

  /**
   * DELETE /entities - Delete multiple entities
   */
  router.delete('/', asyncHandler(async (req, res) => {
    const { entityNames } = req.body;

    if (!entityNames || !Array.isArray(entityNames)) {
      throw new ValidationError('entityNames array is required');
    }

    const result = await entityService.deleteEntities(entityNames);

    if (!result.success) {
      throw new ValidationError('Entity deletion failed', result.errors);
    }

    res.status(204).send();
  }));

  /**
   * POST /entities/:name/observations - Add observations to an entity
   */
  router.post('/:name/observations', asyncHandler(async (req, res) => {
    const { name } = req.params;
    const { contents, expertiseArea, context } = req.body;

    if (!contents || !Array.isArray(contents)) {
      throw new ValidationError('contents array is required');
    }

    const result = await entityService.addObservations([{
      entityName: name,
      contents,
      expertiseArea,
      context
    }]);

    if (!result.success) {
      throw new ValidationError('Adding observations failed', result.errors);
    }

    res.status(201).json({
      data: result.data,
      warnings: result.warnings,
      suggestions: result.suggestions
    });
  }));

  /**
   * DELETE /entities/:name/observations - Delete observations from an entity
   */
  router.delete('/:name/observations', asyncHandler(async (req, res) => {
    const { name } = req.params;
    const { observations } = req.body;

    if (!observations || !Array.isArray(observations)) {
      throw new ValidationError('observations array is required');
    }

    const result = await entityService.deleteObservations([{
      entityName: name,
      observations
    }]);

    if (!result.success) {
      throw new ValidationError('Deleting observations failed', result.errors);
    }

    res.status(204).send();
  }));

  /**
   * GET /entities/:name/history - Get entity history
   */
  router.get('/:name/history', asyncHandler(async (req, res) => {
    const { name } = req.params;
    
    const result = await entityService.getEntityHistory(name);

    if (!result.success) {
      if (result.errors?.[0]?.includes('not supported')) {
        res.status(501).json({
          error: {
            code: 'NOT_IMPLEMENTED',
            message: 'Entity history not supported by storage provider'
          }
        });
        return;
      }
      throw new ValidationError('Getting entity history failed', result.errors);
    }

    res.json({
      data: result.data,
      warnings: result.warnings,
      suggestions: result.suggestions
    });
  }));

  return router;
}
