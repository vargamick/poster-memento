/**
 * Configuration schema for Memento instances
 * Enables template-based deployment with use-case-specific configurations
 */

/**
 * Validation rule for entity fields
 */
export interface ValidationRule {
  type: 'regex' | 'length' | 'enum' | 'custom';
  value: string | number | string[];
  message?: string;
}

/**
 * Entity type configuration
 */
export interface EntityTypeConfig {
  name: string;
  description?: string;
  required_fields: string[];
  optional_fields: string[];
  metadata_schema?: Record<string, string>; // field_name -> type
  validation_rules?: Record<string, ValidationRule[]>; // field_name -> rules
}

/**
 * Relationship type configuration
 */
export interface RelationshipTypeConfig {
  name: string;
  description?: string;
  from_entity_types: string[]; // Allowed source entity types
  to_entity_types: string[]; // Allowed target entity types
  cardinality?: 'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many';
  required?: boolean;
  metadata_fields?: string[];
}

/**
 * Chunking strategy configuration
 */
export interface ChunkingConfig {
  method: 'page-based' | 'section-based' | 'fixed-size' | 'semantic';
  options: {
    targetTokens?: number;
    maxTokens?: number;
    overlap?: number;
    sectionPatterns?: string[];
    createMasterChunk?: boolean;
    combineSmallSections?: boolean;
    splitLargeSections?: boolean;
  };
}

/**
 * Search configuration
 */
export interface SearchConfig {
  defaultStrategy: 'graph' | 'vector' | 'hybrid';
  hybridWeights?: {
    graph: number;
    vector: number;
  };
  vectorThreshold?: number;
  enableMetadataFiltering?: boolean;
  mergeMethod?: 'weighted' | 'rrf';
}

/**
 * Processing pipeline configuration
 */
export interface ProcessingConfig {
  batchSize: number;
  maxConcurrent: number;
  retryAttempts: number;
  retryDelay?: number;
  memoryManagement: boolean;
  enableLogging?: boolean;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * Metadata extraction configuration
 */
export interface MetadataExtractionConfig {
  enabled: boolean;
  fields: {
    surfaces?: boolean;
    problems?: boolean;
    safety?: boolean;
    technical?: boolean;
    applications?: boolean;
    complementary?: boolean;
    incompatible?: boolean;
    environmental?: boolean;
  };
  customPatterns?: Record<string, string[]>; // field_name -> regex patterns
}

/**
 * Complete instance configuration
 */
export interface InstanceConfig {
  instanceName: string;
  description?: string;
  useCase: string;
  version?: string;

  // Entity and relationship definitions
  entityTypes: EntityTypeConfig[];
  relationshipTypes?: RelationshipTypeConfig[];

  // Processing configuration
  chunkingConfig: ChunkingConfig;
  searchConfig: SearchConfig;
  processingConfig: ProcessingConfig;
  metadataExtraction?: MetadataExtractionConfig;

  // Data sources
  dataSources?: {
    pdfs?: {
      directory: string;
      filePattern?: string;
      metadataFile?: string;
    };
    web?: {
      baseUrl: string;
      enabled: boolean;
    };
  };

  // Additional metadata
  metadata?: Record<string, any>;

  // Environment overrides
  env?: Record<string, string>;
}

/**
 * Default configuration values
 */
export const DEFAULT_INSTANCE_CONFIG: Partial<InstanceConfig> = {
  version: '1.0.0',
  chunkingConfig: {
    method: 'fixed-size',
    options: {
      targetTokens: 400,
      maxTokens: 600,
      overlap: 150
    }
  },
  searchConfig: {
    defaultStrategy: 'hybrid',
    hybridWeights: {
      graph: 0.4,
      vector: 0.6
    },
    vectorThreshold: 0.7,
    enableMetadataFiltering: true,
    mergeMethod: 'weighted'
  },
  processingConfig: {
    batchSize: 10,
    maxConcurrent: 3,
    retryAttempts: 3,
    retryDelay: 2000,
    memoryManagement: true,
    enableLogging: true,
    logLevel: 'info'
  },
  metadataExtraction: {
    enabled: true,
    fields: {
      surfaces: true,
      problems: true,
      safety: true,
      technical: true,
      applications: true,
      complementary: true,
      incompatible: true,
      environmental: true
    }
  }
};

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate instance configuration
 */
export function validateInstanceConfig(config: InstanceConfig): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required fields
  if (!config.instanceName) {
    errors.push('Instance name is required');
  }

  if (!config.useCase) {
    errors.push('Use case is required');
  }

  if (!config.entityTypes || config.entityTypes.length === 0) {
    errors.push('At least one entity type must be defined');
  }

  // Validate entity types
  if (config.entityTypes) {
    for (const entityType of config.entityTypes) {
      if (!entityType.name) {
        errors.push('Entity type name is required');
      }
      if (!entityType.required_fields || entityType.required_fields.length === 0) {
        warnings.push(`Entity type '${entityType.name}' has no required fields`);
      }
    }
  }

  // Validate chunking config
  if (config.chunkingConfig) {
    const { method, options } = config.chunkingConfig;
    if (!method) {
      errors.push('Chunking method is required');
    }
    if (method === 'section-based' && (!options.sectionPatterns || options.sectionPatterns.length === 0)) {
      warnings.push('Section-based chunking requires section patterns');
    }
  }

  // Validate search config
  if (config.searchConfig) {
    const { defaultStrategy, hybridWeights } = config.searchConfig;
    if (!defaultStrategy) {
      errors.push('Default search strategy is required');
    }
    if (defaultStrategy === 'hybrid' && hybridWeights) {
      const total = hybridWeights.graph + hybridWeights.vector;
      if (Math.abs(total - 1.0) > 0.01) {
        warnings.push(`Hybrid weights should sum to 1.0 (currently ${total})`);
      }
    }
  }

  // Validate processing config
  if (config.processingConfig) {
    const { batchSize, maxConcurrent } = config.processingConfig;
    if (batchSize < 1) {
      errors.push('Batch size must be at least 1');
    }
    if (maxConcurrent < 1) {
      errors.push('Max concurrent must be at least 1');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}
