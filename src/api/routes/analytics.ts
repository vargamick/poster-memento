import { Router } from 'express';
import { asyncHandler, ValidationError } from '../middleware/errorHandler.js';

/**
 * Create analytics routes
 */
export function createAnalyticsRoutes(storageProvider: any): Router {
  const router = Router();

  /**
   * GET /analytics/statistics - Get graph statistics
   */
  router.get('/statistics', asyncHandler(async (req, res) => {
    // Check if storage provider has statistics method
    if (typeof storageProvider.getGraphStatistics === 'function') {
      const stats = await storageProvider.getGraphStatistics();
      res.json({
        data: stats,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(501).json({
        error: {
          code: 'NOT_IMPLEMENTED',
          message: 'Graph statistics not supported by storage provider'
        }
      });
    }
  }));

  /**
   * GET /analytics/health - Get system health metrics
   */
  router.get('/health', asyncHandler(async (req, res) => {
    res.json({
      data: {
        status: 'healthy',
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        timestamp: new Date().toISOString()
      }
    });
  }));

  return router;
}
