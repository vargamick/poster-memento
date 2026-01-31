# Generalized Processing Architecture for Memento-new

## Overview

This document proposes extending Memento-new's existing instance architecture to support **pluggable processing pipelines** that can handle different content types (PDFs, images, web content) while sharing the core knowledge graph infrastructure.

---

## Current Architecture (Memento-new)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         MEMENTO-NEW CORE                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐   │
│  │ ConfigLoader     │    │ KnowledgeGraph   │    │ MCP Server       │   │
│  │ (instance-config)│───▶│ Manager          │◀───│ (28+ tools)      │   │
│  └──────────────────┘    └──────────────────┘    └──────────────────┘   │
│           │                       │                                      │
│           ▼                       ▼                                      │
│  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐   │
│  │ Entity Types     │    │ Storage Provider │    │ Embedding        │   │
│  │ Relation Types   │    │ (Neo4j/Postgres) │    │ Service          │   │
│  └──────────────────┘    └──────────────────┘    └──────────────────┘   │
│                                                                          │
├─────────────────────────────────────────────────────────────────────────┤
│                         INSTANCE: ASK-AGAR                               │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ PDF Processor (agar-pdf-processor.ts)                             │   │
│  │ - processAllAgarPDFs()                                            │   │
│  │ - extractAgarProductData()                                        │   │
│  │ - createAgarProductRelationships()                                │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Proposed: Generalized Processing Framework

### 1. Processing Provider Interface

```typescript
// src/processing/ProcessingProvider.ts

interface ProcessingProvider {
  /** Unique identifier for this processor type */
  readonly type: string;

  /** Content types this processor handles */
  readonly contentTypes: ContentType[];

  /** Initialize the processor with instance config */
  initialize(config: ProcessingConfig): Promise<void>;

  /** Process a single source item */
  processItem(source: SourceItem): Promise<ProcessingResult>;

  /** Process multiple items with progress tracking */
  processBatch(
    sources: SourceItem[],
    options: BatchOptions,
    onProgress?: (progress: BatchProgress) => void
  ): Promise<BatchResult>;

  /** Health check for processor dependencies */
  healthCheck(): Promise<HealthStatus>;

  /** Clean up resources */
  shutdown(): Promise<void>;
}

type ContentType = 'pdf' | 'image' | 'web' | 'document' | 'audio' | 'video';

interface SourceItem {
  id: string;
  path: string;           // Local path or S3 URI
  contentType: ContentType;
  metadata?: Record<string, unknown>;
}

interface ProcessingResult {
  success: boolean;
  sourceId: string;
  entities: Entity[];
  relations: Relation[];
  processingTime_ms: number;
  confidence?: number;
  errors?: string[];
}
```

### 2. Processing Provider Factory

```typescript
// src/processing/ProcessingProviderFactory.ts

class ProcessingProviderFactory {
  private static providers: Map<string, ProcessingProviderConstructor> = new Map();

  /** Register a processing provider */
  static register(type: string, provider: ProcessingProviderConstructor): void {
    this.providers.set(type, provider);
  }

  /** Create provider from instance config */
  static createFromConfig(config: InstanceConfig): ProcessingProvider {
    const providerType = config.processingConfig.providerType;
    const Provider = this.providers.get(providerType);

    if (!Provider) {
      throw new Error(`Unknown processing provider: ${providerType}`);
    }

    return new Provider(config);
  }

  /** Get all registered providers */
  static getAvailableProviders(): string[] {
    return Array.from(this.providers.keys());
  }
}

// Register built-in providers
ProcessingProviderFactory.register('pdf', PDFProcessingProvider);
ProcessingProviderFactory.register('vision', VisionProcessingProvider);
ProcessingProviderFactory.register('web', WebScrapingProvider);
```

### 3. Instance Configuration Extension

```typescript
// Extended instance-config.json structure

interface InstanceConfig {
  instanceName: string;
  useCase: string;
  version: string;

  // Existing fields...
  entityTypes: EntityTypeConfig[];
  relationshipTypes: RelationshipTypeConfig[];
  searchConfig: SearchConfig;

  // NEW: Processing configuration
  processingConfig: {
    providerType: 'pdf' | 'vision' | 'web' | 'custom';

    // Provider-specific settings
    providerSettings: {
      // For PDF provider
      pdf?: {
        extractImages: boolean;
        ocrEnabled: boolean;
        chunkingMethod: 'page-based' | 'section-based' | 'semantic';
      };

      // For Vision provider (images)
      vision?: {
        model: string;           // e.g., 'minicpm-v', 'llava', 'gpt-4-vision'
        provider: string;        // e.g., 'ollama', 'vllm', 'openai'
        baseUrl?: string;        // For local models
        extractionPrompt?: string;
        confidence_threshold: number;
      };

      // For Web provider
      web?: {
        scrapeDepth: number;
        respectRobots: boolean;
        rateLimit_ms: number;
      };
    };

    // Common settings
    batchSize: number;
    maxConcurrent: number;
    retryAttempts: number;
    retryDelay_ms: number;
    memoryManagement: boolean;
    logLevel: 'debug' | 'info' | 'warn' | 'error';
  };

  // NEW: Source configuration
  dataSourceConfig: {
    type: 'local' | 's3' | 'url';

    local?: {
      directory: string;
      filePattern: string;
      recursive: boolean;
    };

    s3?: {
      bucket: string;
      prefix: string;
      region: string;
      // Credentials from env: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
      // Or instance-specific: INSTANCE_AWS_ACCESS_KEY_ID
    };

    url?: {
      baseUrl: string;
      endpoints: string[];
    };
  };

  // NEW: Output/storage configuration
  storageConfig: {
    // Image/file storage (for processed outputs)
    objectStorage?: {
      type: 's3' | 'minio' | 'local';
      bucket: string;
      prefix: string;
      region?: string;
    };
  };
}
```

### 4. Vision Processing Provider (for Posters)

```typescript
// src/processing/providers/VisionProcessingProvider.ts

import { VisionModelFactory } from '../vision/VisionModelFactory';

class VisionProcessingProvider implements ProcessingProvider {
  readonly type = 'vision';
  readonly contentTypes: ContentType[] = ['image'];

  private visionModel: VisionModel;
  private config: VisionProviderSettings;
  private imageStorage: ObjectStorageService;

  async initialize(config: ProcessingConfig): Promise<void> {
    this.config = config.providerSettings.vision!;

    // Initialize vision model
    this.visionModel = VisionModelFactory.create({
      model: this.config.model,
      provider: this.config.provider,
      baseUrl: this.config.baseUrl,
    });

    // Initialize image storage
    this.imageStorage = await ObjectStorageFactory.create(
      config.storageConfig.objectStorage
    );

    await this.visionModel.initialize();
  }

  async processItem(source: SourceItem): Promise<ProcessingResult> {
    const startTime = Date.now();

    try {
      // 1. Load image
      const imageBuffer = await this.loadImage(source.path);
      const imageHash = await this.hashImage(imageBuffer);

      // 2. Store original image
      const storedImageUrl = await this.imageStorage.store(
        imageBuffer,
        `originals/${imageHash}-${source.metadata?.filename}`
      );

      // 3. Extract via vision model
      const extraction = await this.visionModel.extract(imageBuffer, {
        prompt: this.config.extractionPrompt,
      });

      // 4. Build entities from extraction
      const entities = this.buildEntities(source, extraction, storedImageUrl);

      // 5. Extract relations
      const relations = this.extractRelations(entities);

      return {
        success: true,
        sourceId: source.id,
        entities,
        relations,
        processingTime_ms: Date.now() - startTime,
        confidence: extraction.confidence,
      };
    } catch (error) {
      return {
        success: false,
        sourceId: source.id,
        entities: [],
        relations: [],
        processingTime_ms: Date.now() - startTime,
        errors: [error.message],
      };
    }
  }

  private buildEntities(
    source: SourceItem,
    extraction: VisionExtractionResult,
    storedImageUrl: string
  ): Entity[] {
    const entities: Entity[] = [];

    // Create poster entity
    const poster: Entity = {
      name: `poster_${source.id}`,
      entityType: 'Poster',
      poster_type: this.inferPosterType(extraction),
      extracted_text: extraction.extracted_text,
      visual_elements: extraction.visual_elements,
      metadata: {
        source_image_url: storedImageUrl,
        source_image_hash: source.id,
        original_filename: source.metadata?.filename,
        vision_model: this.config.model,
        processing_time_ms: extraction.processing_time_ms,
        processing_date: new Date().toISOString(),
        confidence_score: extraction.confidence,
      },
      observations: [],
    };
    entities.push(poster);

    // Create related entities (artists, venues, events, etc.)
    if (extraction.structured_data?.headliner) {
      entities.push(this.createArtistEntity(extraction.structured_data.headliner));
    }

    if (extraction.structured_data?.venue) {
      entities.push(this.createVenueEntity(extraction.structured_data));
    }

    // ... more entity creation

    return entities;
  }
}
```

### 5. MCP Tools for Processing

```typescript
// src/server/handlers/toolHandlers/processing/index.ts

// New MCP tools for generalized processing

export const processingTools = [
  {
    name: 'process_sources',
    description: 'Process source files using the configured processing provider',
    inputSchema: {
      type: 'object',
      properties: {
        source_path: { type: 'string', description: 'Path or S3 URI to process' },
        batch_size: { type: 'number', default: 10 },
        skip_existing: { type: 'boolean', default: true },
        dry_run: { type: 'boolean', default: false },
      },
    },
  },

  {
    name: 'get_processing_status',
    description: 'Get status of a processing job',
    inputSchema: {
      type: 'object',
      properties: {
        job_id: { type: 'string', required: true },
      },
    },
  },

  {
    name: 'list_sources',
    description: 'List available source files for processing',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['all', 'pending', 'processed', 'failed'],
          default: 'all',
        },
        limit: { type: 'number', default: 100 },
        offset: { type: 'number', default: 0 },
      },
    },
  },

  {
    name: 'backup_knowledge_graph',
    description: 'Create a backup of the knowledge graph',
    inputSchema: {
      type: 'object',
      properties: {
        include_vectors: { type: 'boolean', default: true },
        compression: { type: 'boolean', default: true },
        destination: { type: 'string', description: 'S3 URI or local path' },
      },
    },
  },

  {
    name: 'reset_knowledge_graph',
    description: 'Truncate the knowledge graph (requires confirmation)',
    inputSchema: {
      type: 'object',
      properties: {
        confirm: { type: 'boolean', required: true },
        backup_first: { type: 'boolean', default: true },
      },
    },
  },

  {
    name: 'reprocess_all',
    description: 'Backup, reset, and reprocess all sources',
    inputSchema: {
      type: 'object',
      properties: {
        confirm: { type: 'boolean', required: true },
        reason: { type: 'string', description: 'Reason for reprocessing' },
      },
    },
  },

  {
    name: 'get_processing_quality',
    description: 'Get quality metrics for processed items',
    inputSchema: {
      type: 'object',
      properties: {
        date_range: {
          type: 'object',
          properties: {
            from: { type: 'string', format: 'date-time' },
            to: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  },
];
```

---

## Instance Comparison: Ask Agar vs Posters

| Aspect | Ask Agar | Posters |
|--------|----------|---------|
| **Content Type** | PDF documents | Image files |
| **Processing Provider** | `pdf` | `vision` |
| **Vision Model** | N/A | minicpm-v (Ollama) |
| **Source Location** | S3: `agar/pdfs/` | Local: `./SourceImages/` |
| **Entity Types** | agar_product, document_chunk, surface_type... | Poster, Artist, Venue, Event, Release, Organization |
| **Chunking** | section-based (400 tokens) | N/A (whole image) |
| **Embeddings** | Voyage AI (text) | Voyage AI (entity text) |

---

## Configuration Examples

### Ask Agar Instance Config

```json
{
  "instanceName": "ask-agar",
  "useCase": "pdf-product-catalog",
  "version": "2.1.0",

  "processingConfig": {
    "providerType": "pdf",
    "providerSettings": {
      "pdf": {
        "extractImages": false,
        "ocrEnabled": false,
        "chunkingMethod": "section-based"
      }
    },
    "batchSize": 10,
    "maxConcurrent": 3
  },

  "dataSourceConfig": {
    "type": "s3",
    "s3": {
      "bucket": "agar-data",
      "prefix": "scrapes/",
      "region": "ap-southeast-2"
    }
  }
}
```

### Posters Instance Config

```json
{
  "instanceName": "posters",
  "useCase": "music-poster-knowledge-graph",
  "version": "1.0.0",

  "processingConfig": {
    "providerType": "vision",
    "providerSettings": {
      "vision": {
        "model": "minicpm-v",
        "provider": "ollama",
        "baseUrl": "http://localhost:11434",
        "extractionPrompt": "Extract all text and structured data from this music poster...",
        "confidence_threshold": 0.7
      }
    },
    "batchSize": 5,
    "maxConcurrent": 2
  },

  "dataSourceConfig": {
    "type": "local",
    "local": {
      "directory": "./SourceImages",
      "filePattern": "*.{jpg,jpeg,png,JPG,JPEG,PNG}",
      "recursive": false
    }
  },

  "storageConfig": {
    "objectStorage": {
      "type": "minio",
      "bucket": "poster-images",
      "prefix": "originals/"
    }
  }
}
```

---

## Implementation Roadmap

### Phase 1: Processing Provider Interface
1. Define `ProcessingProvider` interface
2. Create `ProcessingProviderFactory`
3. Refactor `agar-pdf-processor` to implement interface
4. Add provider registration in startup

### Phase 2: Vision Processing Provider
1. Port `VisionModelFactory` from poster-memento
2. Implement `VisionProcessingProvider`
3. Register in factory

### Phase 3: MCP Processing Tools
1. Add processing tools to tool list
2. Implement tool handlers that use factory
3. Add job tracking via `ProcessingJobManager`

### Phase 4: Instance Configuration
1. Extend `ConfigSchema.ts` with processing config
2. Update `ConfigLoader.ts` to load processing settings
3. Create Posters instance config

### Phase 5: Admin Tools
1. Implement backup/restore for Neo4j + pgvector
2. Add reprocessing workflow
3. Add quality metrics collection

---

## Environment Variables by Instance

```bash
# Common (all instances)
NEO4J_URI=bolt://localhost:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=password
VOYAGE_API_KEY=your-key

# Ask Agar specific
AGAR_AWS_ACCESS_KEY_ID=xxx
AGAR_AWS_SECRET_ACCESS_KEY=xxx
AGAR_S3_BUCKET=agar-data
AGAR_S3_PREFIX=scrapes/

# Posters specific
POSTERS_MINIO_ENDPOINT=localhost:9000
POSTERS_MINIO_ACCESS_KEY=xxx
POSTERS_MINIO_SECRET_KEY=xxx
POSTERS_MINIO_BUCKET=poster-images
POSTERS_VISION_MODEL=minicpm-v
POSTERS_OLLAMA_URL=http://localhost:11434
```

---

## Benefits of Generalized Architecture

1. **Code Reuse** - Same MCP tools work across all instances
2. **Configuration-Driven** - New instances don't require code changes
3. **Pluggable Processors** - Easy to add new content types
4. **Isolated Storage** - Each instance can have its own S3 bucket/credentials
5. **Consistent API** - Claude interacts the same way with all instances
6. **Shared Infrastructure** - Neo4j, embeddings, search all shared
7. **Independent Scaling** - Instances can be deployed separately
