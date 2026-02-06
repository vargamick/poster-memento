# Poster Processing Pipeline

## Overview Flowchart

```mermaid
flowchart TB
    subgraph Discovery["1. IMAGE DISCOVERY"]
        A1[SourceImages/ Directory] --> A2[Scan for images]
        A2 --> A3[Filter by pattern: *.jpg,*.jpeg,*.png]
        A3 --> A4[Return paginated file list]
    end

    subgraph Processing["2. IMAGE PROCESSING"]
        B1[Validate file exists] --> B2[Calculate SHA-256 hash]
        B2 --> B3{Skip if exists?}
        B3 -->|Yes, already processed| B4[Skip]
        B3 -->|No| B5[Store in MinIO]
        B5 --> B6[Read image as base64]
    end

    subgraph Vision["3. VISION MODEL EXTRACTION"]
        C1[Send to Ollama minicpm-v] --> C2[5-Step Analysis Prompt]
        C2 --> C3[Step 1: Type Detection]
        C3 --> C4[Step 2: Extract All Text]
        C4 --> C5[Step 3: Structure Data]
        C5 --> C6[Step 4: Visual Elements]
        C6 --> C7[Parse Response with Regex]
    end

    subgraph TypeClassification["4. TYPE CLASSIFICATION"]
        D1{Analyze Poster Purpose}
        D1 -->|Has venue + date| D2[concert]
        D1 -->|Multiple acts + festival name| D3[festival]
        D1 -->|Comedy performance| D4[comedy]
        D1 -->|Theatrical production| D5[theater]
        D1 -->|Movie/film| D6[film]
        D1 -->|Album + artist, NO venue| D7[release]
        D1 -->|General promo| D8[promo]
        D1 -->|Art/gallery| D9[exhibition]
        D1 -->|Event + Release| D10[hybrid]
        D1 -->|Cannot determine| D11[unknown]
    end

    subgraph EntityBuilding["5. ENTITY BUILDING"]
        E1[Create Poster entity] --> E2[Build inferred_types array]
        E2 --> E3[Calculate decade from year]
        E3 --> E4[Add processing metadata]
        E4 --> E5[Extract visual_elements]
    end

    subgraph KnowledgeGraph["6. KNOWLEDGE GRAPH CREATION"]
        F1[Store Poster in Neo4j] --> F2[Create Artist entities]
        F2 --> F3[Create Venue entity]
        F3 --> F4[Create PosterType relations]

        F2 --> F5[HEADLINED_ON relation]
        F2 --> F6[PERFORMED_ON relations]
        F3 --> F7[ADVERTISES_VENUE relation]
        F4 --> F8[HAS_TYPE relation with confidence]
    end

    subgraph Results["7. RESULTS & TRACKING"]
        G1[Record in ProcessingRunManager] --> G2[Return batch statistics]
        G2 --> G3[Track for pagination]
    end

    Discovery --> Processing
    Processing --> Vision
    Vision --> TypeClassification
    TypeClassification --> EntityBuilding
    EntityBuilding --> KnowledgeGraph
    KnowledgeGraph --> Results
```

## Detailed Component Flow

```mermaid
flowchart LR
    subgraph Input
        IMG[Poster Image]
    end

    subgraph Processor["PosterProcessor"]
        PP1[processImage]
        PP2[buildPosterEntity]
    end

    subgraph VisionModel["OllamaVisionProvider"]
        VM1[extractMetadata]
        VM2[parseResponse]
    end

    subgraph Services
        ES[EntityService]
        RS[RelationService]
        PTQS[PosterTypeQueryService]
    end

    subgraph Storage
        NEO[Neo4j Graph DB]
        MINIO[MinIO Object Storage]
    end

    IMG --> PP1
    PP1 --> VM1
    VM1 --> VM2
    VM2 --> PP2
    PP2 --> ES
    ES --> NEO
    PP1 --> MINIO
    ES --> RS
    RS --> NEO
    PTQS --> NEO
```

## Type Classification Logic

```mermaid
flowchart TD
    START[Analyze Poster] --> Q1{Has venue + specific date?}

    Q1 -->|Yes| Q2{Multiple headline acts?}
    Q1 -->|No| Q3{Has album/single title + artist?}

    Q2 -->|Yes| FESTIVAL[festival]
    Q2 -->|No| Q4{Comedy performance?}

    Q4 -->|Yes| COMEDY[comedy]
    Q4 -->|No| Q5{Theater/play?}

    Q5 -->|Yes| THEATER[theater]
    Q5 -->|No| CONCERT[concert]

    Q3 -->|Yes| Q6{Also has venue + date?}
    Q3 -->|No| Q7{Movie poster indicators?}

    Q6 -->|Yes| HYBRID[hybrid - release + concert]
    Q6 -->|No| RELEASE[release]

    Q7 -->|Yes| FILM[film]
    Q7 -->|No| Q8{Art exhibition?}

    Q8 -->|Yes| EXHIBITION[exhibition]
    Q8 -->|No| Q9{Any promotional content?}

    Q9 -->|Yes| PROMO[promo]
    Q9 -->|No| UNKNOWN[unknown]
```

## HAS_TYPE Relationship Structure

```mermaid
erDiagram
    Poster ||--o{ HAS_TYPE : has
    HAS_TYPE }o--|| PosterType : classifies

    Poster {
        string name PK
        string entityType
        string title
        string headliner
        array inferred_types
        object visual_elements
        object metadata
    }

    PosterType {
        string name PK
        string entityType
        string type_key
        string description
    }

    HAS_TYPE {
        float confidence
        string source
        string evidence
        boolean is_primary
        datetime inferred_at
    }
```

## Key Files

| Component | File | Purpose |
|-----------|------|---------|
| PosterProcessor | `src/image-processor/PosterProcessor.ts` | Main orchestrator |
| OllamaVisionProvider | `src/image-processor/providers/OllamaVisionProvider.ts` | Vision model + parsing |
| VisionModelFactory | `src/image-processor/VisionModelFactory.ts` | Provider factory |
| processPosterBatch | `src/server/handlers/toolHandlers/processPosterBatch.ts` | MCP tool + KG creation |
| PosterTypeQueryService | `src/core/services/PosterTypeQueryService.ts` | Type queries |
| EntityService | `src/core/services/EntityService.ts` | Entity CRUD |
| RelationService | `src/core/services/RelationService.ts` | Relation CRUD |

## Configuration

Located in: `instances/posters/config/instance-config.json`

```json
{
  "processingConfig": {
    "providerType": "vision",
    "providerSettings": {
      "vision": {
        "model": "minicpm-v",
        "provider": "ollama",
        "baseUrl": "http://localhost:11434",
        "confidenceThreshold": 0.7,
        "options": {
          "temperature": 0.1,
          "maxTokens": 2048
        }
      }
    },
    "batchSize": 5,
    "maxConcurrent": 2
  }
}
```

## Processing Entry Points

1. **MCP Tool**: `process_poster_batch` - for interactive processing
2. **Script**: `scripts/poster-processing/process-posters.ts` - for bulk processing
3. **API**: `POST /api/processing/batch` - for REST API access
