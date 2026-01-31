/**
 * Configuration options for pagination behavior
 */
export interface PaginationConfig {
  /**
   * Default number of results to return when no limit specified
   */
  defaultLimit: number;
  
  /**
   * Maximum number of results that can be requested in a single query
   */
  maxLimit: number;
  
  /**
   * Default page size for page-based navigation
   */
  defaultPageSize: number;
  
  /**
   * Maximum page size allowed
   */
  maxPageSize: number;
  
  /**
   * Whether to automatically include total counts in responses
   */
  autoIncludeTotalCount: boolean;
  
  /**
   * Maximum result size estimation (in MB) - for future use
   */
  maxResultSizeMB?: number;
  
  /**
   * Whether to enable result size estimation
   */
  enableSizeEstimation: boolean;
}

/**
 * Default pagination configuration
 */
export const DEFAULT_PAGINATION_CONFIG: PaginationConfig = {
  defaultLimit: 10,
  maxLimit: 1000,
  defaultPageSize: 20,
  maxPageSize: 100,
  autoIncludeTotalCount: false,
  maxResultSizeMB: 10,
  enableSizeEstimation: false,
};

/**
 * Load pagination configuration from environment variables
 */
export function loadPaginationConfigFromEnvironment(): PaginationConfig {
  const config: PaginationConfig = {
    defaultLimit: parseInt(process.env.MEMENTO_PAGINATION_DEFAULT_LIMIT || '10', 10),
    maxLimit: parseInt(process.env.MEMENTO_PAGINATION_MAX_LIMIT || '1000', 10),
    defaultPageSize: parseInt(process.env.MEMENTO_PAGINATION_DEFAULT_PAGE_SIZE || '20', 10),
    maxPageSize: parseInt(process.env.MEMENTO_PAGINATION_MAX_PAGE_SIZE || '100', 10),
    autoIncludeTotalCount: process.env.MEMENTO_PAGINATION_AUTO_INCLUDE_TOTAL_COUNT === 'true',
    enableSizeEstimation: process.env.MEMENTO_PAGINATION_ENABLE_SIZE_ESTIMATION === 'true',
  };

  // Optional maxResultSizeMB
  if (process.env.MEMENTO_PAGINATION_MAX_RESULT_SIZE_MB) {
    config.maxResultSizeMB = parseInt(process.env.MEMENTO_PAGINATION_MAX_RESULT_SIZE_MB, 10);
  }

  // Validate configuration values
  validatePaginationConfig(config);

  return config;
}

/**
 * Validate pagination configuration values
 */
export function validatePaginationConfig(config: PaginationConfig): void {
  if (config.defaultLimit < 1) {
    throw new Error('defaultLimit must be at least 1');
  }
  
  if (config.maxLimit < config.defaultLimit) {
    throw new Error('maxLimit must be greater than or equal to defaultLimit');
  }
  
  if (config.defaultPageSize < 1) {
    throw new Error('defaultPageSize must be at least 1');
  }
  
  if (config.maxPageSize < config.defaultPageSize) {
    throw new Error('maxPageSize must be greater than or equal to defaultPageSize');
  }
  
  if (config.maxResultSizeMB && config.maxResultSizeMB <= 0) {
    throw new Error('maxResultSizeMB must be greater than 0 if specified');
  }
}

/**
 * Merge user-provided configuration with defaults
 */
export function mergePaginationConfig(
  userConfig: Partial<PaginationConfig>, 
  baseConfig: PaginationConfig = DEFAULT_PAGINATION_CONFIG
): PaginationConfig {
  const merged = {
    ...baseConfig,
    ...userConfig,
  };

  validatePaginationConfig(merged);
  return merged;
}

/**
 * Calculate offset from page and pageSize
 */
export function calculateOffsetFromPage(page: number, pageSize: number): number {
  if (page < 1) {
    throw new Error('Page number must be 1 or greater');
  }
  return (page - 1) * pageSize;
}

/**
 * Calculate page number from offset and pageSize
 */
export function calculatePageFromOffset(offset: number, pageSize: number): number {
  if (offset < 0) {
    throw new Error('Offset must be 0 or greater');
  }
  return Math.floor(offset / pageSize) + 1;
}

/**
 * Calculate total pages from total count and page size
 */
export function calculateTotalPages(totalCount: number, pageSize: number): number {
  if (totalCount < 0) {
    return 0;
  }
  return Math.ceil(totalCount / pageSize);
}
