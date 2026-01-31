# Poster Processing Pipeline Implementation Plan

## Overview

This document outlines the implementation of a processing pipeline for the Posters knowledge graph project, leveraging patterns from the poster-memento project while adapting to the schema defined in `schemas/poster-schema.json`.

---

## Part 1: Processing Pipeline Architecture

### Current State

| Component | Posters Project | poster-memento |
|-----------|-----------------|----------------|
| Schema | ✅ `poster-schema.json` | ✅ `types.ts` |
| Source Images | ✅ 2,197 images | ✅ Variable |
| Vision Processing | ❌ Not implemented | ✅ `PosterProcessor.ts` |
| Entity Generation | ❌ Not implemented | ✅ `EntityService.ts` |
| Knowledge Graph | ❌ Not implemented | ✅ Neo4j + pgvector |
| MCP Server | ❌ Not implemented | ✅ 28+ tools |
| Reprocessing | ❌ Not implemented | ✅ `AdminService.ts` |

### Recommended Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        PROCESSING PIPELINE                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐               │
│  │ Source       │───▶│ Vision       │───▶│ Entity       │               │
│  │ Discovery    │    │ Extraction   │    │ Builder      │               │
│  └──────────────┘    └──────────────┘    └──────────────┘               │
│         │                   │                   │                        │
│         ▼                   ▼                   ▼                        │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐               │
│  │ File Hash    │    │ Structured   │    │ Relation     │               │
│  │ Registry     │    │ Data Parser  │    │ Extractor    │               │
│  └──────────────┘    └──────────────┘    └──────────────┘               │
│                             │                   │                        │
│                             ▼                   ▼                        │
│                      ┌──────────────────────────┐                        │
│                      │   Knowledge Graph Store   │                        │
│                      │   (Neo4j + pgvector)      │                        │
│                      └──────────────────────────┘                        │
│                                   │                                      │
│                                   ▼                                      │
│                      ┌──────────────────────────┐                        │
│                      │      MCP Server          │                        │
│                      │   (Query Interface)       │                        │
│                      └──────────────────────────┘                        │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Processing Stages

#### Stage 1: Source Discovery
```typescript
// Scan SourceImages directory, build file inventory
interface SourceFile {
  path: string;
  filename: string;
  hash: string;  // SHA256 for deduplication
  size: number;
  status: 'pending' | 'processed' | 'failed';
}
```

#### Stage 2: Vision Extraction
```typescript
// Extract text and visual elements using vision model
interface VisionExtractionResult {
  extracted_text: string;
  structured_data: {
    title?: string;
    artists?: string[];
    headliner?: string;
    supporting_acts?: string[];
    venue?: string;
    city?: string;
    state?: string;
    country?: string;
    date?: string;
    year?: number;
    ticket_price?: string;
    ticket_outlets?: string[];
    age_restriction?: string;
  };
  visual_elements: {
    artist_photo: boolean;
    album_artwork: boolean;
    logo: boolean;
    dominant_colors: string[];
    style: string;
  };
  model: string;
  provider: string;
  processing_time_ms: number;
  confidence?: number;
}
```

#### Stage 3: Entity Building
Maps extraction results to the poster-schema.json entities:
- **Poster** (core entity)
- **Artist** (extracted from headliner/supporting_acts)
- **Venue** (extracted from venue/city/state)
- **Event** (extracted from date/time/ticket info)
- **Release** (for album/release posters)
- **Organization** (labels, promoters, sponsors)

#### Stage 4: Relation Extraction
Builds relationships between entities:
- `PERFORMED_AT` (Artist → Venue)
- `HEADLINED` (Artist → Event)
- `SUPPORTED` (Artist → Event)
- `PROMOTED_BY` (Event → Organization)
- `RELEASED_BY` (Release → Organization)
- `FEATURED_ON` (Artist → Poster)
- `ADVERTISES` (Poster → Event/Release)

#### Stage 5: Knowledge Graph Persistence
Stores entities and relations in Neo4j with vector embeddings in pgvector.

---

## Part 2: Reprocessing Workflow

### Backup Strategy

```typescript
interface BackupConfig {
  backupDir: string;           // e.g., ./backups/
  retention: number;           // Days to keep backups
  compressionEnabled: boolean;
  includeVectors: boolean;     // Include pgvector embeddings
}

interface BackupResult {
  timestamp: string;
  backupPath: string;
  entityCount: number;
  relationCount: number;
  vectorCount: number;
  sizeBytes: number;
  duration_ms: number;
}
```

### Reprocessing Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    REPROCESSING WORKFLOW                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. BACKUP PHASE                                                 │
│     ├─ Export Neo4j entities/relations to JSON                  │
│     ├─ Export pgvector embeddings                               │
│     ├─ Compress and timestamp                                   │
│     └─ Verify backup integrity                                  │
│                                                                  │
│  2. TRUNCATE PHASE                                               │
│     ├─ Clear Neo4j database (MATCH (n) DETACH DELETE n)         │
│     ├─ Clear pgvector tables (TRUNCATE embeddings)              │
│     ├─ Reset processing registry                                │
│     └─ Verify empty state                                       │
│                                                                  │
│  3. REPROCESS PHASE                                              │
│     ├─ Re-scan SourceImages                                     │
│     ├─ Run vision extraction (with updated model/prompt)        │
│     ├─ Build entities with new schema                           │
│     ├─ Store in knowledge graph                                 │
│     └─ Generate new embeddings                                  │
│                                                                  │
│  4. VALIDATION PHASE                                             │
│     ├─ Compare entity counts                                    │
│     ├─ Run sample queries                                       │
│     ├─ Verify embedding similarity                              │
│     └─ Generate diff report                                     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Implementation: AdminService

```typescript
// Adapted from poster-memento/src/services/AdminService.ts
class AdminService {
  constructor(
    private neo4jProvider: Neo4jStorageProvider,
    private vectorStore: PostgresVectorStore,
    private backupConfig: BackupConfig
  ) {}

  async getDatabaseStats(): Promise<DatabaseStats> {
    const [neo4jStats, vectorStats] = await Promise.all([
      this.neo4jProvider.getStats(),
      this.vectorStore.getStats()
    ]);
    return { neo4j: neo4jStats, vectors: vectorStats };
  }

  async backup(): Promise<BackupResult> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${this.backupConfig.backupDir}/${timestamp}`;

    // Export entities and relations
    const entities = await this.neo4jProvider.exportAllEntities();
    const relations = await this.neo4jProvider.exportAllRelations();

    // Export vectors if configured
    let vectors = [];
    if (this.backupConfig.includeVectors) {
      vectors = await this.vectorStore.exportAll();
    }

    // Write and compress
    await this.writeBackup(backupPath, { entities, relations, vectors });

    return {
      timestamp,
      backupPath,
      entityCount: entities.length,
      relationCount: relations.length,
      vectorCount: vectors.length,
      sizeBytes: await this.getBackupSize(backupPath),
      duration_ms: Date.now() - startTime
    };
  }

  async reset(): Promise<ResetResult> {
    // Clear Neo4j
    await this.neo4jProvider.execute('MATCH (n) DETACH DELETE n');

    // Clear pgvector
    await this.vectorStore.truncate();

    return { success: true, timestamp: new Date().toISOString() };
  }

  async reprocess(options: ReprocessOptions): Promise<ReprocessResult> {
    // 1. Backup current state
    const backup = await this.backup();

    // 2. Reset databases
    await this.reset();

    // 3. Trigger full reprocessing
    const processor = new PosterProcessor(this.config);
    const result = await processor.processAll(options);

    // 4. Validate
    const validation = await this.validate(backup, result);

    return { backup, result, validation };
  }
}
```

---

## Part 3: MCP Integration Analysis

### Current MCP Tools (from poster-memento)

The poster-memento project provides 28+ MCP tools:

| Category | Tools |
|----------|-------|
| Entity CRUD | `create_entities`, `read_graph`, `update_entity`, `delete_entities` |
| Relations | `create_relations`, `get_relation`, `update_relation`, `delete_relations` |
| Observations | `add_observations`, `delete_observations` |
| Search | `advanced_search`, `find_similar_entities`, `semantic_search` |
| Analytics | `get_graph_statistics`, `get_node_analytics`, `find_paths` |

### Gap Analysis: What's Missing

For a **Claude-driven processing pipeline**, the following MCP tools are needed:

#### Required New Tools

```typescript
// 1. Processing Control
interface ProcessPostersTool {
  name: 'process_posters';
  description: 'Process poster images and extract knowledge graph entities';
  input_schema: {
    source_path?: string;      // Default: ./SourceImages
    batch_size?: number;       // Default: 10
    skip_existing?: boolean;   // Default: true
    dry_run?: boolean;         // Default: false
    vision_model?: string;     // Default: minicpm-v
  };
  output: {
    job_id: string;
    status: 'started' | 'running' | 'completed' | 'failed';
    total: number;
    processed: number;
    failed: number;
  };
}

// 2. Job Management
interface GetProcessingStatusTool {
  name: 'get_processing_status';
  description: 'Get status of a processing job';
  input_schema: {
    job_id: string;
  };
  output: ProcessingJobStatus;
}

// 3. Database Administration
interface BackupDatabaseTool {
  name: 'backup_database';
  description: 'Create a backup of the knowledge graph';
  input_schema: {
    include_vectors?: boolean;
    compression?: boolean;
  };
  output: BackupResult;
}

interface ResetDatabaseTool {
  name: 'reset_database';
  description: 'Truncate the knowledge graph (requires confirmation)';
  input_schema: {
    confirm: boolean;  // Must be true
  };
  output: ResetResult;
}

interface ReprocessAllTool {
  name: 'reprocess_all';
  description: 'Backup, reset, and reprocess all posters';
  input_schema: {
    confirm: boolean;
    vision_model?: string;
  };
  output: ReprocessResult;
}

// 4. Image Management
interface ListSourceImagesTool {
  name: 'list_source_images';
  description: 'List available source images';
  input_schema: {
    status?: 'all' | 'pending' | 'processed' | 'failed';
    limit?: number;
    offset?: number;
  };
  output: {
    images: SourceFile[];
    total: number;
    pending: number;
    processed: number;
    failed: number;
  };
}

interface GetImageDetailsTool {
  name: 'get_image_details';
  description: 'Get details about a specific source image';
  input_schema: {
    filename: string;
  };
  output: {
    file: SourceFile;
    extraction?: VisionExtractionResult;
    entity?: PosterEntity;
  };
}

// 5. Validation & Quality
interface ValidateExtractionTool {
  name: 'validate_extraction';
  description: 'Validate an extraction result against the schema';
  input_schema: {
    entity_id: string;
  };
  output: {
    valid: boolean;
    errors: ValidationError[];
    warnings: ValidationWarning[];
    suggestions: string[];
  };
}

interface GetProcessingQualityTool {
  name: 'get_processing_quality';
  description: 'Get quality metrics for processed posters';
  input_schema: {
    date_range?: { from: string; to: string };
  };
  output: {
    total_processed: number;
    avg_confidence: number;
    avg_processing_time_ms: number;
    entity_type_distribution: Record<string, number>;
    low_confidence_count: number;
    missing_fields_summary: Record<string, number>;
  };
}
```

### MCP Tool Implementation Pattern

```typescript
// src/server/handlers/toolHandlers/processPosters.ts
import { ToolHandler } from '../types';
import { PosterProcessor } from '../../../image-processor/PosterProcessor';
import { ProcessingJobManager } from '../../../services/processing/ProcessingJobManager';

export const handleProcessPosters: ToolHandler = async (args, context) => {
  const {
    source_path = './SourceImages',
    batch_size = 10,
    skip_existing = true,
    dry_run = false,
    vision_model = 'minicpm-v'
  } = args;

  const jobManager = context.getService('processingJobManager');
  const processor = context.getService('posterProcessor');

  // Create job for tracking
  const job = jobManager.createJob('poster-processing', {
    source_path,
    batch_size,
    skip_existing,
    vision_model
  });

  // Start processing (async, returns immediately)
  processor.processAll({
    sourcePath: source_path,
    batchSize: batch_size,
    skipExisting: skip_existing,
    dryRun: dry_run,
    visionModel: vision_model,
    onProgress: (progress) => {
      jobManager.updateProgress(job.jobId, progress);
    },
    onComplete: (result) => {
      jobManager.completeJob(job.jobId, result);
    },
    onError: (error) => {
      jobManager.failJob(job.jobId, error);
    }
  });

  return {
    job_id: job.jobId,
    status: 'started',
    total: 0,  // Updated async
    processed: 0,
    failed: 0
  };
};
```

---

## Part 4: Implementation Approach

### Option A: Extend poster-memento

Leverage the existing poster-memento infrastructure and add the missing tools.

**Pros:**
- Faster implementation
- Proven architecture
- Existing Neo4j/pgvector setup

**Cons:**
- Coupled to poster-memento codebase
- May diverge from Posters schema

### Option B: Build Standalone Pipeline

Create a new processing pipeline in the Posters project, using poster-memento as reference.

**Pros:**
- Clean separation
- Schema-aligned
- Simpler codebase

**Cons:**
- More initial work
- Duplicates some infrastructure

### Recommended: Hybrid Approach

1. **Use poster-memento as the MCP server** (already working)
2. **Add processing tools to poster-memento** (extend existing)
3. **Create processing scripts in Posters project** (standalone)
4. **Share database infrastructure** (Neo4j + pgvector)

---

## Part 5: File Structure Proposal

```
Posters/
├── schemas/
│   └── poster-schema.json          # ✅ Exists
├── SourceImages/                    # ✅ Exists (2,197 images)
├── scripts/
│   ├── process-all.ts              # Batch processing script
│   ├── reprocess.ts                # Reprocessing workflow
│   ├── validate.ts                 # Schema validation
│   └── migrate.ts                  # Data migration tools
├── src/
│   ├── processor/
│   │   ├── PosterProcessor.ts      # Main processing logic
│   │   ├── EntityBuilder.ts        # Schema-aligned entity creation
│   │   └── RelationExtractor.ts    # Relationship inference
│   ├── storage/
│   │   ├── ProcessingRegistry.ts   # Track processed files
│   │   └── BackupService.ts        # Backup/restore
│   └── mcp/
│       └── tools/                  # Additional MCP tool handlers
│           ├── processPosters.ts
│           ├── backupDatabase.ts
│           ├── resetDatabase.ts
│           └── listSourceImages.ts
├── config/
│   ├── vision-models.json          # Vision model configuration
│   └── processing.json             # Processing settings
├── backups/                         # Database backups
└── docs/
    └── IMPLEMENTATION-PLAN.md      # This document
```

---

## Next Steps

1. **Decide on approach** (Extend vs Standalone vs Hybrid)
2. **Set up database infrastructure** (or reuse poster-memento's)
3. **Implement processing scripts** for the Posters project
4. **Add MCP tools** for Claude-driven processing
5. **Create reprocessing workflow** with backup/restore
6. **Test end-to-end** with sample posters
7. **Scale to full 2,197 image corpus**

---

## Questions to Resolve

1. Should processing be synchronous (wait for completion) or async (job-based)?
2. What vision model to use? (minicpm-v is working, but consider accuracy vs speed)
3. Where should backups be stored? (local vs S3/MinIO)
4. Should the MCP server run in poster-memento or as a new service?
5. How to handle low-confidence extractions? (manual review queue?)
