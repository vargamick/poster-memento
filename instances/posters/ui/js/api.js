/**
 * Poster Memento API Client
 * Handles all authenticated API calls to the Memento REST API
 */

export class PosterAPI {
  constructor(baseUrl, apiKey) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.apiKey = apiKey;
  }

  /**
   * Make an authenticated API request
   * @param {string} endpoint - API endpoint
   * @param {object} options - Fetch options
   * @returns {Promise<object>} Response data
   */
  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;

    const headers = {
      'X-API-Key': this.apiKey,
      'Content-Type': 'application/json',
      ...options.headers
    };

    try {
      const response = await fetch(url, {
        ...options,
        headers
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || errorData.message || `HTTP ${response.status}`,
          response.status,
          errorData
        );
      }

      return await response.json();
    } catch (error) {
      if (error instanceof APIError) {
        throw error;
      }
      throw new APIError(`Network error: ${error.message}`, 0, { originalError: error });
    }
  }

  /**
   * Get a list of posters with optional filtering and pagination
   * @param {object} options - Query options
   * @returns {Promise<object>} Entities response with pagination
   */
  async getPosters(options = {}) {
    const {
      limit = 10,
      offset = 0,
      search = '',
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = options;

    const params = new URLSearchParams({
      entityTypes: 'Poster',
      limit: limit.toString(),
      offset: offset.toString()
    });

    if (search) {
      params.set('search', search);
    }

    if (sortBy) {
      params.set('sortBy', sortBy);
      params.set('sortOrder', sortOrder);
    }

    return this.request(`/api/v1/entities?${params}`);
  }

  /**
   * Get a single poster by name
   * @param {string} name - Poster entity name
   * @returns {Promise<object>} Poster entity with relations
   */
  async getPoster(name) {
    const encodedName = encodeURIComponent(name);
    return this.request(`/api/v1/entities/${encodedName}`);
  }

  /**
   * Search posters using various strategies
   * @param {string} query - Search query
   * @param {object} options - Search options
   * @returns {Promise<object>} Search results
   */
  async searchPosters(query, options = {}) {
    const {
      limit = 10,
      strategy = 'hybrid',
      threshold = 0.5
    } = options;

    const params = new URLSearchParams({
      q: query,
      entityTypes: 'Poster',
      limit: limit.toString(),
      strategy,
      threshold: threshold.toString()
    });

    return this.request(`/api/v1/search?${params}`);
  }

  /**
   * Get relations for a poster
   * @param {string} posterName - Poster entity name
   * @returns {Promise<object>} Relations data
   */
  async getPosterRelations(posterName) {
    const params = new URLSearchParams({
      entityName: posterName
    });

    return this.request(`/api/v1/relations?${params}`);
  }

  /**
   * Get entity types and counts for statistics
   * @returns {Promise<object>} Statistics data
   */
  async getStatistics() {
    return this.request('/api/v1/analytics/statistics');
  }

  /**
   * Check API health status
   * @returns {Promise<object>} Health status
   */
  async checkHealth() {
    // Health endpoint doesn't require authentication
    const response = await fetch(`${this.baseUrl}/health`);
    return response.json();
  }

  /**
   * Get presigned URL for a single image by hash
   * @param {string} hash - Image hash (first 16 chars of SHA-256)
   * @param {number} expiry - URL expiry time in seconds (default: 3600)
   * @returns {Promise<object>} Image URL data
   */
  async getImageUrl(hash, expiry = 3600) {
    const params = new URLSearchParams({ expiry: expiry.toString() });
    return this.request(`/api/v1/images/${encodeURIComponent(hash)}?${params}`);
  }

  /**
   * Get presigned URLs for multiple images by hash (batch)
   * @param {string[]} hashes - Array of image hashes
   * @param {number} expiry - URL expiry time in seconds (default: 3600)
   * @returns {Promise<object>} Batch image URLs data
   */
  async getImageUrls(hashes, expiry = 3600) {
    return this.request('/api/v1/images/batch', {
      method: 'POST',
      body: JSON.stringify({ hashes, expiry })
    });
  }

  // ============================================
  // Poster Processing API Methods
  // ============================================

  /**
   * Scan source folder for images
   * @param {object} options - Scan options
   * @param {string} options.sourcePath - Path to scan (optional)
   * @param {number} options.offset - Pagination offset
   * @param {number} options.limit - Number of results
   * @param {boolean} options.recursive - Scan recursively
   * @returns {Promise<object>} Scan results with file list
   */
  async scanPosters(options = {}) {
    const params = new URLSearchParams();
    if (options.sourcePath) params.set('sourcePath', options.sourcePath);
    if (options.offset !== undefined) params.set('offset', options.offset.toString());
    if (options.limit !== undefined) params.set('limit', options.limit.toString());
    if (options.recursive !== undefined) params.set('recursive', options.recursive.toString());

    const queryString = params.toString();
    return this.request(`/api/v1/posters/scan${queryString ? '?' + queryString : ''}`);
  }

  /**
   * Get available vision models
   * @returns {Promise<object>} Available models with default
   */
  async getVisionModels() {
    return this.request('/api/v1/posters/models');
  }

  /**
   * Preview poster extraction (no database storage)
   * @param {string} imagePath - Path to the image file
   * @param {string} modelKey - Optional vision model to use
   * @returns {Promise<object>} Extraction preview result
   */
  async previewPoster(imagePath, modelKey) {
    return this.request('/api/v1/posters/preview', {
      method: 'POST',
      body: JSON.stringify({ imagePath, modelKey })
    });
  }

  /**
   * Commit a previewed entity to the database
   * @param {object} entity - The PosterEntity to commit
   * @param {boolean} storeImage - Whether to store the image
   * @returns {Promise<object>} Commit result
   */
  async commitPoster(entity, storeImage = false) {
    return this.request('/api/v1/posters/commit', {
      method: 'POST',
      body: JSON.stringify({ entity, storeImage })
    });
  }

  /**
   * Process a batch of poster images
   * @param {object} options - Processing options
   * @param {string[]} options.filePaths - Specific files to process
   * @param {string} options.sourcePath - Source directory to scan
   * @param {number} options.batchSize - Batch size (default: 10)
   * @param {number} options.offset - Pagination offset
   * @param {boolean} options.skipIfExists - Skip already processed
   * @param {string} options.modelKey - Vision model to use
   * @param {boolean} options.storeImages - Store images in MinIO
   * @returns {Promise<object>} Processing result
   */
  async processPosters(options = {}) {
    return this.request('/api/v1/posters/process', {
      method: 'POST',
      body: JSON.stringify(options)
    });
  }

  /**
   * Get processing status
   * @param {string} sourcePath - Optional source path
   * @returns {Promise<object>} Processing status
   */
  async getProcessingStatus(sourcePath) {
    const params = sourcePath ? `?sourcePath=${encodeURIComponent(sourcePath)}` : '';
    return this.request(`/api/v1/posters/process/status${params}`);
  }

  /**
   * Reset processing state
   * @param {string} sourcePath - Optional source path to reset
   * @returns {Promise<object>} Reset result
   */
  async resetProcessingState(sourcePath) {
    return this.request('/api/v1/posters/process/reset', {
      method: 'POST',
      body: JSON.stringify({ sourcePath })
    });
  }

  /**
   * Check poster processing health
   * @returns {Promise<object>} Health status
   */
  async checkProcessingHealth() {
    return this.request('/api/v1/posters/health');
  }
}

/**
 * Custom API Error class
 */
export class APIError extends Error {
  constructor(message, status, data = {}) {
    super(message);
    this.name = 'APIError';
    this.status = status;
    this.data = data;
  }

  isAuthError() {
    return this.status === 401 || this.status === 403;
  }

  isNotFound() {
    return this.status === 404;
  }

  isServerError() {
    return this.status >= 500;
  }
}

/**
 * Configuration for the API client
 */
export const config = {
  apiBaseUrl: window.location.origin, // Same origin as UI
  apiKey: 'posters-api-key-2024', // Default key, can be overridden
  defaultLimit: 10,
  defaultSearchStrategy: 'hybrid'
};

/**
 * Create a configured API instance
 * @param {object} overrides - Configuration overrides
 * @returns {PosterAPI} Configured API instance
 */
export function createAPI(overrides = {}) {
  const finalConfig = { ...config, ...overrides };
  return new PosterAPI(finalConfig.apiBaseUrl, finalConfig.apiKey);
}
