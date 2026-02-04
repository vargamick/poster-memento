/**
 * Base API Client for QA Validation
 *
 * Provides common functionality for external API clients including:
 * - Rate limiting
 * - Request caching
 * - Retry logic
 * - Error handling
 */

import { APIClientConfig, RateLimitConfig } from '../types.js';

/**
 * Simple rate limiter using sliding window
 */
class RateLimiter {
  private timestamps: number[] = [];
  private maxRequests: number;
  private windowMs: number;

  constructor(config: RateLimitConfig) {
    this.maxRequests = config.maxRequests;
    this.windowMs = config.windowMs;
  }

  /**
   * Wait until a request can be made within rate limits
   */
  async waitForSlot(): Promise<void> {
    const now = Date.now();

    // Remove timestamps outside the window
    this.timestamps = this.timestamps.filter(t => now - t < this.windowMs);

    if (this.timestamps.length >= this.maxRequests) {
      // Calculate wait time
      const oldestTimestamp = this.timestamps[0];
      const waitTime = this.windowMs - (now - oldestTimestamp) + 10; // +10ms buffer

      if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }

      // Clean up again after waiting
      const afterWait = Date.now();
      this.timestamps = this.timestamps.filter(t => afterWait - t < this.windowMs);
    }

    // Record this request
    this.timestamps.push(Date.now());
  }

  /**
   * Check if a request can be made immediately
   */
  canMakeRequest(): boolean {
    const now = Date.now();
    this.timestamps = this.timestamps.filter(t => now - t < this.windowMs);
    return this.timestamps.length < this.maxRequests;
  }
}

/**
 * Simple in-memory cache with TTL
 */
interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

class SimpleCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private defaultTTL: number;

  constructor(defaultTTL: number = 5 * 60 * 1000) { // 5 minutes default
    this.defaultTTL = defaultTTL;
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.data;
  }

  set(key: string, data: T, ttl?: number): void {
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + (ttl ?? this.defaultTTL),
    });
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  clear(): void {
    this.cache.clear();
  }

  /**
   * Remove expired entries
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }
}

/**
 * Request options for API calls
 */
export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
  params?: Record<string, string | number | boolean | undefined>;
  timeout?: number;
  skipCache?: boolean;
  cacheTTL?: number;
}

/**
 * API error with additional context
 */
export class APIError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public source: string,
    public retryable: boolean = false
  ) {
    super(message);
    this.name = 'APIError';
  }
}

/**
 * Base class for external API clients
 */
export abstract class BaseAPIClient {
  protected baseUrl: string;
  protected userAgent: string;
  protected timeout: number;
  protected rateLimiter: RateLimiter;
  protected cache: SimpleCache<unknown>;
  protected apiKey?: string;

  abstract readonly name: string;

  constructor(config: APIClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.userAgent = config.userAgent;
    this.timeout = config.timeout ?? 10000;
    this.apiKey = config.apiKey;
    this.rateLimiter = new RateLimiter(config.rateLimit);
    this.cache = new SimpleCache(config.cacheTTL);
  }

  /**
   * Build URL with query parameters
   */
  protected buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    // Properly combine base URL with path by ensuring we append, not replace
    // new URL('/path', 'https://example.com/api') wrongly produces https://example.com/path
    // We need https://example.com/api/path
    const cleanPath = path.startsWith('/') ? path.slice(1) : path;
    const fullUrl = this.baseUrl.endsWith('/')
      ? `${this.baseUrl}${cleanPath}`
      : `${this.baseUrl}/${cleanPath}`;

    const url = new URL(fullUrl);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    return url.toString();
  }

  /**
   * Generate cache key for a request
   */
  protected getCacheKey(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const url = this.buildUrl(path, params);
    return `${this.name}:${url}`;
  }

  /**
   * Make an HTTP request with rate limiting, caching, and retries
   */
  protected async request<T>(
    path: string,
    options: RequestOptions = {}
  ): Promise<T> {
    const {
      method = 'GET',
      headers = {},
      body,
      params,
      timeout = this.timeout,
      skipCache = false,
      cacheTTL,
    } = options;

    // Check cache for GET requests
    const cacheKey = this.getCacheKey(path, params);
    if (method === 'GET' && !skipCache) {
      const cached = this.cache.get(cacheKey);
      if (cached !== undefined) {
        return cached as T;
      }
    }

    // Wait for rate limit slot
    await this.rateLimiter.waitForSlot();

    const url = this.buildUrl(path, params);

    const requestHeaders: Record<string, string> = {
      'User-Agent': this.userAgent,
      'Accept': 'application/json',
      ...headers,
    };

    if (body && !requestHeaders['Content-Type']) {
      requestHeaders['Content-Type'] = 'application/json';
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method,
        headers: requestHeaders,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        throw new APIError(
          `${this.name} API error: ${response.status} ${response.statusText}`,
          response.status,
          this.name,
          retryable
        );
      }

      const data = await response.json() as T;

      // Cache successful GET responses
      if (method === 'GET') {
        this.cache.set(cacheKey, data, cacheTTL);
      }

      return data;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof APIError) {
        throw error;
      }

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new APIError(
            `${this.name} API timeout after ${timeout}ms`,
            0,
            this.name,
            true
          );
        }
        throw new APIError(
          `${this.name} API error: ${error.message}`,
          0,
          this.name,
          true
        );
      }

      throw new APIError(
        `${this.name} API unknown error`,
        0,
        this.name,
        true
      );
    }
  }

  /**
   * Make a request with automatic retries
   */
  protected async requestWithRetry<T>(
    path: string,
    options: RequestOptions = {},
    maxRetries: number = 3,
    retryDelay: number = 1000
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.request<T>(path, options);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (error instanceof APIError && !error.retryable) {
          throw error;
        }

        if (attempt < maxRetries) {
          const delay = retryDelay * Math.pow(2, attempt - 1); // Exponential backoff
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError;
  }

  /**
   * Check if the API is reachable
   */
  abstract healthCheck(): Promise<boolean>;

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}
