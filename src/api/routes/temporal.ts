import { Router } from 'express';
import { asyncHandler, ValidationError } from '../middleware/errorHandler.js';
import { formatTimestampForAPI, formatDateForStorage } from '../../utils/dateFormatter.js';

/**
 * Create temporal routes
 */
export function createTemporalRoutes(storageProvider: any): Router {
  const router = Router();

  /**
   * GET /temporal/graph/:timestamp - Get graph at specific timestamp
   */
  router.get('/graph/:timestamp', asyncHandler(async (req, res) => {
    const { timestamp } = req.params;
    const parsedTimestamp = parseInt(timestamp);

    if (isNaN(parsedTimestamp)) {
      throw new ValidationError('Invalid timestamp format');
    }

    if (typeof storageProvider.getGraphAtTime === 'function') {
      const graph = await storageProvider.getGraphAtTime(parsedTimestamp);
      res.json({
        data: graph,
        timestamp: parsedTimestamp,
        requestedAt: formatTimestampForAPI(Date.now())
      });
    } else {
      res.status(501).json({
        error: {
          code: 'NOT_IMPLEMENTED',
          message: 'Temporal graph queries not supported by storage provider'
        }
      });
    }
  }));

  /**
   * GET /temporal/entity/:name/history - Get entity history
   */
  router.get('/entity/:name/history', asyncHandler(async (req, res) => {
    const { name } = req.params;

    if (typeof storageProvider.getEntityHistory === 'function') {
      const history = await storageProvider.getEntityHistory(name);
      res.json({
        data: history,
        entityName: name,
        requestedAt: formatTimestampForAPI(Date.now())
      });
    } else {
      res.status(501).json({
        error: {
          code: 'NOT_IMPLEMENTED',
          message: 'Entity history not supported by storage provider'
        }
      });
    }
  }));

  return router;
}
