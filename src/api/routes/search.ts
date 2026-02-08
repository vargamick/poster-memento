import { Router } from 'express';
import type { EntityService } from '../../core/services/EntityService.js';
import type { SearchService } from '../../core/services/SearchService.js';
import type { StorageProvider } from '../../storage/StorageProvider.js';
import { PosterTypeQueryService } from '../../core/services/PosterTypeQueryService.js';
import { asyncHandler, ValidationError } from '../middleware/errorHandler.js';
import { logger } from '../../utils/logger.js';

/**
 * SearchService provider - can be a SearchService instance or a getter function
 * The getter function allows for lazy initialization of SearchService
 */
export type SearchServiceProvider = SearchService | (() => SearchService | undefined) | undefined;

/**
 * Create search routes with optional SearchService for hybrid search
 * @param entityService - Entity service for basic search
 * @param storageProvider - Storage provider
 * @param searchServiceProvider - Either a SearchService instance, a getter function, or undefined
 */
export function createSearchRoutes(
  entityService: EntityService,
  storageProvider: StorageProvider,
  searchServiceProvider?: SearchServiceProvider
): Router {
  const router = Router();

  // Create PosterTypeQueryService for enriching search results
  const posterTypeQueryService = storageProvider ? new PosterTypeQueryService(storageProvider) : null;

  // Helper to enrich Poster entities in search results with type and artist relationships
  const enrichPosterResults = async (results: any[]): Promise<any[]> => {
    if (!posterTypeQueryService || results.length === 0) return results;

    const posterResults = results.filter(r => r.entityType === 'Poster');
    if (posterResults.length === 0) return results;

    try {
      let enrichedPosters = await posterTypeQueryService.enrichPostersWithTypes(posterResults);
      enrichedPosters = await posterTypeQueryService.enrichPostersWithArtists(enrichedPosters);
      const enrichedMap = new Map(enrichedPosters.map(p => [p.name, p]));
      return results.map(r =>
        r.entityType === 'Poster' && enrichedMap.has(r.name)
          ? { ...r, ...enrichedMap.get(r.name)! }
          : r
      );
    } catch (err) {
      logger.warn('Failed to enrich search results:', err);
      return results;
    }
  };

  // Helper to get the current SearchService (supports both direct instance and getter function)
  const getSearchService = (): SearchService | undefined => {
    if (typeof searchServiceProvider === 'function') {
      return searchServiceProvider();
    }
    return searchServiceProvider;
  };

  /**
   * GET /search - Basic search (uses SearchService if available, otherwise EntityService)
   */
  router.get('/', asyncHandler(async (req, res) => {
    const {
      q: query,
      limit = 10,
      offset = 0,
      entityTypes,
      expertiseArea,
      strategy // Optional: 'graph', 'vector', 'hybrid'
    } = req.query;

    if (!query || typeof query !== 'string') {
      throw new ValidationError('Query parameter "q" is required');
    }

    const parsedLimit = Math.min(parseInt(limit as string) || 10, 100);
    const parsedOffset = parseInt(offset as string) || 0;
    const parsedEntityTypes = entityTypes ? (entityTypes as string).split(',') : undefined;

    // Use SearchService if available (hybrid search)
    const searchService = getSearchService();
    if (searchService) {
      const strategyName = (strategy as string) || searchService.getDefaultStrategy();

      let results = await searchService.searchWithStrategy(query, strategyName, {
        limit: parsedLimit,
        offset: parsedOffset,
        entityTypes: parsedEntityTypes,
        expertiseArea: expertiseArea as string
      });

      // Enrich Poster results with type and artist relationships
      results = await enrichPosterResults(results);

      res.json({
        data: results,
        pagination: {
          limit: parsedLimit,
          offset: parsedOffset,
          total: results.length
        },
        searchStrategy: strategyName,
        availableStrategies: searchService.getAvailableStrategies(),
        searchServiceEnabled: true
      });
    } else {
      // Fallback to EntityService (original behavior)
      const result = await entityService.searchEntities(query, {
        limit: parsedLimit,
        offset: parsedOffset,
        entityTypes: parsedEntityTypes,
        expertiseArea: expertiseArea as string
      });

      if (!result.success) {
        throw new ValidationError('Search failed', result.errors);
      }

      res.json({
        data: result.data,
        pagination: {
          limit: parsedLimit,
          offset: parsedOffset,
          total: result.data?.entities.length || 0
        },
        warnings: result.warnings,
        suggestions: result.suggestions,
        searchServiceEnabled: false
      });
    }
  }));

  /**
   * POST /search/semantic - Semantic (vector) search
   */
  router.post('/semantic', asyncHandler(async (req, res) => {
    const { query, limit = 10, threshold = 0.7, entityTypes, expertiseArea } = req.body;

    if (!query || typeof query !== 'string') {
      throw new ValidationError('query is required');
    }

    // Use SearchService vector strategy if available
    const searchService = getSearchService();
    if (searchService && searchService.isStrategyAvailable('vector')) {
      const results = await searchService.searchWithStrategy(query, 'vector', {
        limit: Math.min(limit, 100),
        threshold,
        entityTypes,
        expertiseArea
      });

      res.json({
        data: results,
        searchType: 'semantic',
        strategy: 'vector',
        threshold,
        searchServiceEnabled: true
      });
    } else {
      // Fallback to EntityService
      const result = await entityService.searchEntities(query, {
        limit: Math.min(limit, 100),
        entityTypes,
        expertiseArea
      });

      if (!result.success) {
        throw new ValidationError('Semantic search failed', result.errors);
      }

      res.json({
        data: result.data,
        searchType: 'semantic',
        threshold,
        warnings: result.warnings,
        suggestions: result.suggestions,
        searchServiceEnabled: false,
        note: 'Vector search not available, using graph search'
      });
    }
  }));

  /**
   * POST /search/hybrid - Hybrid search (graph + vector)
   * NEW ENDPOINT - only available if SearchService is configured
   */
  router.post('/hybrid', asyncHandler(async (req, res) => {
    const {
      query,
      limit = 10,
      threshold = 0.7,
      entityTypes,
      expertiseArea,
      graphWeight,
      vectorWeight
    } = req.body;

    if (!query || typeof query !== 'string') {
      throw new ValidationError('query is required');
    }

    const searchService = getSearchService();
    if (!searchService) {
      throw new ValidationError('Hybrid search not available. SearchService not configured.');
    }

    if (!searchService.isStrategyAvailable('hybrid')) {
      throw new ValidationError('Hybrid search not available. Vector store or embedding service not configured.');
    }

    // Update hybrid config if weights provided
    if (graphWeight !== undefined || vectorWeight !== undefined) {
      searchService.updateHybridConfig({
        graphWeight: graphWeight !== undefined ? parseFloat(graphWeight) : undefined,
        vectorWeight: vectorWeight !== undefined ? parseFloat(vectorWeight) : undefined
      });
    }

    // Execute hybrid search
    const results = await searchService.searchWithStrategy(query, 'hybrid', {
      limit: Math.min(limit, 100),
      threshold,
      entityTypes,
      expertiseArea
    });

    const hybridConfig = searchService.getHybridConfig();

    res.json({
      data: results,
      searchType: 'hybrid',
      strategy: 'hybrid',
      threshold,
      weights: {
        graph: hybridConfig?.graphWeight || 0.4,
        vector: hybridConfig?.vectorWeight || 0.6
      },
      mergeMethod: hybridConfig?.mergeMethod || 'weighted',
      searchServiceEnabled: true
    });
  }));

  /**
   * GET /search/strategies - List available search strategies
   * NEW ENDPOINT
   */
  router.get('/strategies', asyncHandler(async (req, res) => {
    const searchService = getSearchService();
    if (!searchService) {
      res.json({
        searchServiceEnabled: false,
        strategies: [],
        default: 'graph',
        note: 'SearchService not configured. Only basic graph search available.'
      });
      return;
    }

    const stats = searchService.getStatistics();

    res.json({
      searchServiceEnabled: true,
      strategies: stats.availableStrategies,
      default: stats.defaultStrategy,
      hybridConfig: stats.hybridConfig,
      features: stats.features
    });
  }));

  /**
   * PUT /search/config - Update search configuration
   * NEW ENDPOINT - Update hybrid search weights
   */
  router.put('/config', asyncHandler(async (req, res) => {
    const searchService = getSearchService();
    if (!searchService) {
      throw new ValidationError('SearchService not configured');
    }

    const { graphWeight, vectorWeight, mergeMethod } = req.body;

    const updates: any = {};
    if (graphWeight !== undefined) updates.graphWeight = parseFloat(graphWeight);
    if (vectorWeight !== undefined) updates.vectorWeight = parseFloat(vectorWeight);
    if (mergeMethod !== undefined) updates.mergeMethod = mergeMethod;

    if (Object.keys(updates).length === 0) {
      throw new ValidationError('No configuration updates provided');
    }

    searchService.updateHybridConfig(updates);

    res.json({
      success: true,
      message: 'Search configuration updated',
      config: searchService.getHybridConfig()
    });
  }));

  return router;
}
