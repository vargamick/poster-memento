# Poster Memento

Music Poster Knowledge Store - Extract and organize music poster metadata using local vision models.

## Overview

Poster Memento is a complete standalone clone of the Memento knowledge graph system, specialized for extracting and organizing metadata from music concert posters. It uses local Hugging Face vision models (no paid APIs) and runs entirely in Docker.

## Features

- **Local Vision Models**: Uses MiniCPM-V, Llama-3.2-Vision, or other models via Ollama
- **Interchangeable Models**: Easy switching between vision models for comparison
- **S3-Compatible Storage**: MinIO for storing original poster images
- **Knowledge Graph**: Neo4j for storing structured poster metadata
- **Vector Search**: PostgreSQL with pgvector for semantic similarity
- **Local Embeddings**: Sentence-transformers (no OpenAI API needed)
- **MCP Server**: Integrates with Claude Desktop

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Docker Network: poster-memento                        │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐   │
│  │  poster-memento  │    │     Ollama       │    │      MinIO       │   │
│  │  (MCP Server +   │───▶│  (Vision Model)  │    │  (Image Storage) │   │
│  │   REST API)      │    │  Port: 11434     │    │  Port: 9000/9001 │   │
│  │                  │    └──────────────────┘    └──────────────────┘   │
│  └────────┬─────────┘                                                    │
│           │                                                              │
│     ┌─────┴─────┐                                                        │
│     ▼           ▼                                                        │
│  ┌──────┐   ┌────────┐   ┌──────────────┐                               │
│  │Neo4j │   │Postgres│   │  Embeddings  │                               │
│  │:7687 │   │:5432   │   │   (TEI)      │                               │
│  │:7474 │   │pgvector│   │   :8080      │                               │
│  └──────┘   └────────┘   └──────────────┘                               │
└─────────────────────────────────────────────────────────────────────────┘
```

## Quick Start

### 1. Start Docker Services

```bash
cd /Users/mick/AI/GregRako/PastedandWasted/poster-memento

# Start all services
npm run docker:up

# Wait for services to be healthy (1-2 minutes)
docker ps

# Pull the vision model (first time only)
npm run ollama:pull
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Build the Project

```bash
npm run build
```

### 4. Discover Source Files

```bash
npm run process:discover
```

### 5. Process Posters

```bash
# Process all posters
npm run process:posters

# Process with limit
npm run process:posters -- --limit=10

# Skip already processed files
npm run process:posters -- --skip-existing

# Dry run (see what would be processed)
npm run process:posters -- --dry-run
```

## Vision Model Management

### List Available Models

```bash
npm run vision:models
```

### Switch Models

```bash
# Set in environment
export VISION_MODEL=llama-vision-ollama

# Or in .env file
VISION_MODEL=minicpm-v-ollama
```

### Test Extraction

```bash
npm run vision:test -- ./source-images/poster.jpg
```

### Compare Models

```bash
npm run vision:compare -- ./source-images/poster.jpg
```

## Supported Vision Models

| Model | Key | Provider | Parameters | Best For |
|-------|-----|----------|------------|----------|
| MiniCPM-V 4.5 | `minicpm-v-ollama` | Ollama | 8.7B | OCR, documents (default) |
| Llama 3.2 Vision | `llama-vision-ollama` | Ollama | 11B | General multimodal |
| LLaVA | `llava-ollama` | Ollama | 7B | Fast processing |
| Qwen 2.5 VL | `qwen-vl-vllm` | vLLM | 8.3B | Structured JSON output |
| SmolDocling | `smoldocling-local` | Transformers | 256M | Fast CPU processing |

## Services & Ports

| Service | Port | URL |
|---------|------|-----|
| Neo4j Browser | 7474 | http://localhost:7474 |
| Neo4j Bolt | 7687 | bolt://localhost:7687 |
| MinIO API | 9000 | http://localhost:9000 |
| MinIO Console | 9001 | http://localhost:9001 |
| PostgreSQL | 5432 | localhost:5432 |
| Ollama | 11434 | http://localhost:11434 |
| Embeddings | 8080 | http://localhost:8080 |

## Configuration

Configuration is done via environment variables in `.env`:

```bash
# Vision Model
OLLAMA_URL=http://localhost:11434
VISION_MODEL=minicpm-v

# Embeddings (local)
EMBEDDING_PROVIDER=local
EMBEDDING_MODEL=all-mpnet-base-v2
EMBEDDING_DIMENSIONS=768

# Source Images
SOURCE_IMAGES_PATH=/Users/mick/AI/GregRako/PastedandWasted/Posters/SourceImages
```

## Entity Schema

### Poster Entity

```json
{
  "name": "poster_abc123",
  "entityType": "poster",
  "title": "Summer of Love Festival",
  "headliner": "Grateful Dead",
  "supporting_acts": ["Jefferson Airplane", "Big Brother"],
  "venue_name": "Fillmore West",
  "city": "San Francisco",
  "state": "CA",
  "event_date": "June 15, 1967",
  "year": 1967,
  "decade": "1960s",
  "metadata": {
    "source_image_url": "s3://poster-images/originals/abc123-poster.jpg",
    "source_image_hash": "abc123def456",
    "vision_model": "minicpm-v"
  }
}
```

### Relationships

- `poster --features_artist--> artist`
- `poster --at_venue--> venue`
- `poster --from_era--> era`
- `poster --belongs_to_genre--> genre`

## MCP Integration

Add to Claude Desktop config:

```json
{
  "mcpServers": {
    "poster-memento": {
      "command": "node",
      "args": ["/Users/mick/AI/GregRako/PastedandWasted/poster-memento/dist/index.js"],
      "env": {
        "NEO4J_URI": "bolt://localhost:7687",
        "NEO4J_PASSWORD": "poster-memento-neo4j"
      }
    }
  }
}
```

## License

MIT
