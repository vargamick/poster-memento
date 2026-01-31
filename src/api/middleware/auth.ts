import type { Request, Response, NextFunction } from 'express';
import { UnauthorizedError } from './errorHandler.js';

/**
 * API key validation middleware
 */
export function validateApiKey(validApiKeys: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Skip validation for health check and API info endpoints
    if (req.path === '/health' || req.path === '/api') {
      return next();
    }

    // Get API key from header
    const apiKey = req.get('X-API-Key') || req.get('Authorization')?.replace('Bearer ', '');

    if (!apiKey) {
      throw new UnauthorizedError('API key required. Provide it in X-API-Key header or Authorization header as Bearer token.');
    }

    if (!validApiKeys.includes(apiKey)) {
      throw new UnauthorizedError('Invalid API key');
    }

    // Add API key info to request for logging
    (req as any).apiKey = apiKey;
    next();
  };
}

/**
 * Optional API key validation (allows requests without API key)
 */
export function optionalApiKey(validApiKeys: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const apiKey = req.get('X-API-Key') || req.get('Authorization')?.replace('Bearer ', '');

    if (apiKey) {
      if (!validApiKeys.includes(apiKey)) {
        throw new UnauthorizedError('Invalid API key');
      }
      (req as any).apiKey = apiKey;
      (req as any).authenticated = true;
    } else {
      (req as any).authenticated = false;
    }

    next();
  };
}

/**
 * Role-based access control middleware
 */
export function requireRole(requiredRole: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const userRole = (req as any).userRole;

    if (!userRole) {
      throw new UnauthorizedError('User role not found');
    }

    if (userRole !== requiredRole && userRole !== 'admin') {
      throw new UnauthorizedError(`Access denied. Required role: ${requiredRole}`);
    }

    next();
  };
}

/**
 * Rate limiting middleware (simple in-memory implementation)
 */
export function createRateLimit(options: {
  windowMs: number;
  max: number;
  message?: string;
}) {
  const requests = new Map<string, { count: number; resetTime: number }>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.ip || 'unknown';
    const now = Date.now();
    const windowStart = now - options.windowMs;

    // Clean up old entries
    for (const [ip, data] of requests.entries()) {
      if (data.resetTime < windowStart) {
        requests.delete(ip);
      }
    }

    // Get or create request data for this IP
    let requestData = requests.get(key);
    if (!requestData || requestData.resetTime < windowStart) {
      requestData = { count: 0, resetTime: now + options.windowMs };
      requests.set(key, requestData);
    }

    // Check if limit exceeded
    if (requestData.count >= options.max) {
      res.status(429).json({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: options.message || 'Too many requests',
          retryAfter: Math.ceil((requestData.resetTime - now) / 1000)
        }
      });
      return;
    }

    // Increment counter
    requestData.count++;

    // Add rate limit headers
    res.set({
      'X-RateLimit-Limit': options.max.toString(),
      'X-RateLimit-Remaining': (options.max - requestData.count).toString(),
      'X-RateLimit-Reset': new Date(requestData.resetTime).toISOString()
    });

    next();
  };
}
