import { Router } from 'express';
import type { EntityService } from '../../core/services/EntityService.js';
import { asyncHandler, ValidationError, NotFoundError } from '../middleware/errorHandler.js';

/**
 * Create expertise area routes
 */
export function createExpertiseRoutes(entityService: EntityService): Router {
  const router = Router();

  /**
   * GET /expertise-areas - List all available expertise areas
   */
  router.get('/', asyncHandler(async (req, res) => {
    const result = entityService.getExpertiseAreas();

    if (!result.success) {
      throw new ValidationError('Failed to get expertise areas', result.errors);
    }

    res.json({
      data: result.data,
      total: result.data?.length || 0
    });
  }));

  /**
   * GET /expertise-areas/:name - Get details of a specific expertise area
   */
  router.get('/:name', asyncHandler(async (req, res) => {
    const { name } = req.params;
    const result = entityService.getExpertiseAreaDetails(name);

    if (!result.success) {
      throw new NotFoundError(result.errors?.[0] || 'Expertise area not found');
    }

    res.json({
      data: result.data
    });
  }));

  /**
   * GET /expertise-areas/:name/entity-types - Get supported entity types for an expertise area
   */
  router.get('/:name/entity-types', asyncHandler(async (req, res) => {
    const { name } = req.params;
    const result = entityService.getExpertiseAreaDetails(name);

    if (!result.success) {
      throw new NotFoundError(result.errors?.[0] || 'Expertise area not found');
    }

    res.json({
      data: {
        expertiseArea: name,
        entityTypes: result.data?.entityTypes || [],
        total: result.data?.entityTypes?.length || 0
      }
    });
  }));

  /**
   * GET /expertise-areas/:name/relation-types - Get supported relation types for an expertise area
   */
  router.get('/:name/relation-types', asyncHandler(async (req, res) => {
    const { name } = req.params;
    const result = entityService.getExpertiseAreaDetails(name);

    if (!result.success) {
      throw new NotFoundError(result.errors?.[0] || 'Expertise area not found');
    }

    res.json({
      data: {
        expertiseArea: name,
        relationTypes: result.data?.relationTypes || [],
        total: result.data?.relationTypes?.length || 0
      }
    });
  }));

  /**
   * GET /expertise-areas/:name/observation-patterns - Get observation patterns for an expertise area
   */
  router.get('/:name/observation-patterns', asyncHandler(async (req, res) => {
    const { name } = req.params;
    const result = entityService.getExpertiseAreaDetails(name);

    if (!result.success) {
      throw new NotFoundError(result.errors?.[0] || 'Expertise area not found');
    }

    res.json({
      data: {
        expertiseArea: name,
        observationPatterns: result.data?.observationPatterns || [],
        total: result.data?.observationPatterns?.length || 0
      }
    });
  }));

  /**
   * GET /expertise-areas/:name/semantic-context - Get semantic context for an expertise area
   */
  router.get('/:name/semantic-context', asyncHandler(async (req, res) => {
    const { name } = req.params;
    const result = entityService.getExpertiseAreaDetails(name);

    if (!result.success) {
      throw new NotFoundError(result.errors?.[0] || 'Expertise area not found');
    }

    res.json({
      data: {
        expertiseArea: name,
        semanticContext: result.data?.semanticContext || {},
        synonyms: result.data?.semanticContext?.synonyms || {},
        relatedConcepts: result.data?.semanticContext?.relatedConcepts || {},
        hierarchies: result.data?.semanticContext?.hierarchies || {},
        constraints: result.data?.semanticContext?.constraints || {}
      }
    });
  }));

  /**
   * POST /expertise-areas/:name/validate-entity - Validate an entity against an expertise area
   */
  router.post('/:name/validate-entity', asyncHandler(async (req, res) => {
    const { name } = req.params;
    const { entity, context } = req.body;

    if (!entity || typeof entity !== 'object') {
      throw new ValidationError('entity object is required');
    }

    // Validate entity structure
    if (!entity.name || typeof entity.name !== 'string') {
      throw new ValidationError('Entity must have a valid name');
    }
    if (!entity.entityType || typeof entity.entityType !== 'string') {
      throw new ValidationError('Entity must have a valid entityType');
    }
    if (!entity.observations || !Array.isArray(entity.observations)) {
      throw new ValidationError('Entity must have an observations array');
    }

    const result = await entityService.createEntities([entity], {
      expertiseArea: name,
      context,
      validateOnly: true
    });

    if (!result.success) {
      res.status(400).json({
        valid: false,
        errors: result.errors,
        warnings: result.warnings,
        suggestions: result.suggestions,
        validation: result.validation
      });
      return;
    }

    res.json({
      valid: true,
      warnings: result.warnings,
      suggestions: result.suggestions,
      validation: result.validation,
      enrichedEntity: result.data?.[0]
    });
  }));

  return router;
}
