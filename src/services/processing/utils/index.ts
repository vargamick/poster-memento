/**
 * Processing Utilities Index
 *
 * Re-exports all utility modules for the processing service.
 */

// Entity builder for creating product, category, brand entities
export {
  EntityBuilder,
  ProductMetadata,
  EquipmentType,
  STANDARD_EQUIPMENT
} from './entity-builder.js';

// Observation parser for extracting structured data from observations
export {
  ObservationParser,
  DilutionRatio,
  StructuredProductData,
  IncompatibleSurfaceInfo
} from './observation-parser.js';

// Catalog loader for synonym-aware entity extraction
export {
  CatalogLoader,
  createCatalogLoader,
  CatalogInstance,
  CatalogEntityType,
  DiscoveryEntry,
  ExtractionConfig,
  CatalogMetadata,
  EntityTypeCatalog,
  ExtractionResult,
  GraphSyncResult,
  CatalogLoaderOptions
} from './catalog-loader.js';

// Validation utilities for schema compliance
export {
  ProductValidator,
  EntityValidator,
  ValidationResult,
  ValidationError,
  ValidationWarning,
  BatchValidationResult
} from './validation.js';
