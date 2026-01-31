import { Router } from 'express';
import type { RelationService } from '../../core/services/RelationService.js';
import { asyncHandler, ValidationError, NotFoundError } from '../middleware/errorHandler.js';

/**
 * Create relation routes
 */
export function createRelationRoutes(relationService: RelationService): Router {
  const router = Router();

  /**
   * POST /relations - Create new relations
   */
  router.post('/', asyncHandler(async (req, res) => {
    const { relations, expertiseArea, context, validateOnly = false } = req.body;

    if (!relations || !Array.isArray(relations)) {
      throw new ValidationError('relations array is required');
    }

    // Validate relation structure
    for (const relation of relations) {
      if (!relation.from || typeof relation.from !== 'string') {
        throw new ValidationError('Each relation must have a valid from entity');
      }
      if (!relation.to || typeof relation.to !== 'string') {
        throw new ValidationError('Each relation must have a valid to entity');
      }
      if (!relation.relationType || typeof relation.relationType !== 'string') {
        throw new ValidationError('Each relation must have a valid relationType');
      }
    }

    const result = await relationService.createRelations(relations, {
      expertiseArea,
      context,
      validateOnly
    });

    if (!result.success) {
      throw new ValidationError('Relation creation failed', result.errors);
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
   * GET /relations/:from/:to/:type - Get a specific relation
   */
  router.get('/:from/:to/:type', asyncHandler(async (req, res) => {
    const { from, to, type } = req.params;
    
    const result = await relationService.getRelation(from, to, type);

    if (!result.success) {
      if (result.errors?.[0]?.includes('not found')) {
        throw new NotFoundError(result.errors[0]);
      }
      throw new ValidationError('Failed to get relation', result.errors);
    }

    res.json({
      data: result.data,
      warnings: result.warnings,
      suggestions: result.suggestions
    });
  }));

  /**
   * PUT /relations/:from/:to/:type - Update a relation
   */
  router.put('/:from/:to/:type', asyncHandler(async (req, res) => {
    const { from, to, type } = req.params;
    const { updates, expertiseArea, context, validateOnly = false } = req.body;

    if (!updates || typeof updates !== 'object') {
      throw new ValidationError('updates object is required');
    }

    // Merge the URL params with updates to create the full relation
    const relation = {
      from,
      to,
      relationType: type,
      ...updates
    };

    const result = await relationService.updateRelation(relation, {
      expertiseArea,
      context,
      validateOnly
    });

    if (!result.success) {
      throw new ValidationError('Relation update failed', result.errors);
    }

    res.json({
      data: result.data,
      warnings: result.warnings,
      suggestions: result.suggestions,
      validation: result.validation
    });
  }));

  /**
   * DELETE /relations - Delete multiple relations
   */
  router.delete('/', asyncHandler(async (req, res) => {
    const { relations } = req.body;

    if (!relations || !Array.isArray(relations)) {
      throw new ValidationError('relations array is required');
    }

    const result = await relationService.deleteRelations(relations);

    if (!result.success) {
      throw new ValidationError('Relation deletion failed', result.errors);
    }

    res.status(204).send();
  }));

  /**
   * GET /relations/:from/:to/:type/history - Get relation history
   */
  router.get('/:from/:to/:type/history', asyncHandler(async (req, res) => {
    const { from, to, type } = req.params;
    
    const result = await relationService.getRelationHistory(from, to, type);

    if (!result.success) {
      if (result.errors?.[0]?.includes('not supported')) {
        res.status(501).json({
          error: {
            code: 'NOT_IMPLEMENTED',
            message: 'Relation history not supported by storage provider'
          }
        });
        return;
      }
      throw new ValidationError('Getting relation history failed', result.errors);
    }

    res.json({
      data: result.data,
      warnings: result.warnings,
      suggestions: result.suggestions
    });
  }));

  return router;
}
