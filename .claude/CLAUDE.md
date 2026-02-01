# Posters Instance - Project Knowledge

## Project Structure

This project uses a **two-level architecture**:

### Framework Level: poster-memento
**Location:** `/Users/mick/AI/GregRako/PastedandWasted/poster-memento`

The `poster-memento` directory is a clone of Memento-new, providing:
- MCP Server implementation (`src/server/`)
- REST API endpoints (`src/api/routes/`)
- Service layer (`src/core/services/`)
- Storage providers (Neo4j, pgvector)
- Processing infrastructure (`src/image-processor/`)
- McpAdapter that bridges MCP tools to services (`src/api/mcpAdapter.ts`)

**Key framework files:**
- `src/api/server.ts` - Express API server
- `src/api/mcpAdapter.ts` - MCP to Services bridge
- `src/api/routes/processing.ts` - Processing API endpoints
- `src/image-processor/PosterProcessor.ts` - Poster image processing
- `src/image-processor/VisionModelFactory.ts` - Vision model integration
- `src/core/services/` - Business logic services

### Instance Level: instances/posters
**Location:** `/Users/mick/AI/GregRako/PastedandWasted/poster-memento/instances/posters`

The `instances/posters` directory provides:
- Instance configuration (entity types, vision model settings)
- Source images (`SourceImages/`)
- Instance-specific Docker infrastructure
- Instance-specific environment variables

**Instance files:**
- `config/instance-config.json` - Entity types, vision config, search settings
- `SourceImages/` - Poster images to process
- `docker-compose.yml` - Instance-specific Docker services
- `.env` - Environment variables for this instance

## Architecture Pattern

```
┌─────────────────────────────────────────────────────────────────┐
│                     MCP Tool Calls                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    McpAdapter (poster-memento)                   │
│                    src/api/mcpAdapter.ts                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Service Layer                                │
│  EntityService, RelationService, SearchService, etc.            │
│  src/core/services/                                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Storage Providers                             │
│  Neo4j (graph), PostgreSQL+pgvector (embeddings), MinIO (files) │
└─────────────────────────────────────────────────────────────────┘
```

The REST API endpoints in `src/api/routes/` also call the same Service layer.

## Configuration Loading

The framework loads instance configuration via `CONFIG_PATH` environment variable:
- Default: `./config/instance-config.json` (relative to cwd)
- Override: Set `CONFIG_PATH` in environment or MCP server config

## Development Guidelines

1. **Framework changes** (API, services, MCP) → Edit in `poster-memento/src/`
2. **Instance changes** (config, entity types) → Edit in `instances/posters/`

## Port Configuration (This Instance)

| Service | Port | Purpose |
|---------|------|---------|
| Neo4j HTTP | 7480 | Web interface |
| Neo4j Bolt | 7693 | Database connection |
| PostgreSQL | 5440 | Embeddings storage |
| MinIO API | 9010 | Object storage |
| MinIO Console | 9011 | MinIO web UI |

## Symlinks

- `poster-memento/source-images` → `instances/posters/SourceImages`

## MCP Configuration

In Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "poster-memento": {
      "command": "node",
      "args": ["/Users/mick/AI/GregRako/PastedandWasted/poster-memento/dist/index.js"],
      "env": {
        "CONFIG_PATH": "/Users/mick/AI/GregRako/PastedandWasted/poster-memento/instances/posters/config/instance-config.json",
        "NEO4J_URI": "bolt://localhost:7693",
        "NEO4J_PASSWORD": "posters_password",
        "EMBEDDING_PROVIDER": "voyage",
        "VOYAGE_API_KEY": "your-voyage-api-key",
        "VOYAGE_EMBEDDING_MODEL": "voyage-3",
        "EMBEDDING_DIMENSIONS": "1024"
      }
    }
  }
}
```

## Processing Pipeline

The `PosterProcessor` class in `src/image-processor/` handles image processing:
- Accepts image paths from `source-images/` (symlinked to `instances/posters/SourceImages/`)
- Extracts metadata using vision models (Ollama with minicpm-v, llama-vision, etc.)
- Builds poster entities with artist, venue, event relations
- Stores results in Neo4j knowledge graph
