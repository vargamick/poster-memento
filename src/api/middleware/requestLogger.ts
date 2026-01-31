import type { Request, Response, NextFunction } from 'express';
import { logger } from '../../utils/logger.js';

/**
 * Request logging middleware
 * Skips logging for health check endpoints to reduce log noise
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  // Skip logging for health check endpoints
  const skipPaths = ['/health', '/memento/health', '/api/v1/admin/health'];
  if (skipPaths.some(path => req.url === path || req.url.startsWith(path + '?'))) {
    return next();
  }

  const startTime = Date.now();

  // Log request start
  logger.info('API Request', {
    method: req.method,
    url: req.url,
    userAgent: req.get('User-Agent'),
    ip: req.ip,
    timestamp: new Date().toISOString()
  });

  // Override res.end to log response
  const originalEnd = res.end;
  res.end = function(chunk?: any, encoding?: any, cb?: any) {
    const duration = Date.now() - startTime;

    // Log response
    logger.info('API Response', {
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      contentLength: res.get('Content-Length') || 0,
      timestamp: new Date().toISOString()
    });

    // Call original end method
    return originalEnd.call(this, chunk, encoding, cb);
  };

  next();
}

/**
 * Detailed request logger for debugging
 */
export function detailedRequestLogger(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();
  
  // Log detailed request information
  logger.debug('Detailed API Request', {
    method: req.method,
    url: req.url,
    headers: req.headers,
    query: req.query,
    params: req.params,
    body: req.body,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    timestamp: new Date().toISOString()
  });

  // Override res.end to log detailed response
  const originalEnd = res.end;
  res.end = function(chunk?: any, encoding?: any, cb?: any) {
    const duration = Date.now() - startTime;
    
    // Log detailed response
    logger.debug('Detailed API Response', {
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      statusMessage: res.statusMessage,
      headers: res.getHeaders(),
      duration: `${duration}ms`,
      contentLength: res.get('Content-Length') || 0,
      timestamp: new Date().toISOString()
    });

    // Call original end method
    return originalEnd.call(this, chunk, encoding, cb);
  };

  next();
}
