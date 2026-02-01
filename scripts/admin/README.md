# Poster Memento - Admin Scripts

Database management and processing pipeline scripts for the Poster Memento knowledge graph system.

## Prerequisites

Before running these scripts, ensure:

1. Docker containers are running:
   ```bash
   cd instances/posters
   docker-compose up -d
   ```

2. Environment variables are set:
   ```bash
   # From the instances/posters directory
   source .env
   # Or export them manually:
   export NEO4J_PASSWORD=posters_password
   export POSTGRES_PASSWORD=posters_password
   ```

## Available Scripts

### 1. Backup Databases

Creates timestamped backups of Neo4j and PostgreSQL databases.

```bash
# Basic backup
npx tsx scripts/admin/backup-databases.ts

# Backup with compression
npx tsx scripts/admin/backup-databases.ts --compress
```

**Output:** Creates files in `./backups/`:
- `neo4j_backup_<timestamp>.json` - All nodes and relationships
- `postgres_backup_<timestamp>.sql` - Entity embeddings SQL dump
- `backup_manifest_<timestamp>.json` - Backup metadata

### 2. Reset Databases

Truncates all data from databases while preserving schemas. **Destructive operation!**

```bash
# Interactive (requires confirmation)
npx tsx scripts/admin/reset-databases.ts

# Skip confirmation (dangerous!)
npx tsx scripts/admin/reset-databases.ts --yes
```

### 3. Reprocess All Posters

Full pipeline: Backup → Reset → Reprocess all posters.

```bash
# Interactive (requires confirmation)
npx tsx scripts/admin/reprocess-posters.ts

# With options
npx tsx scripts/admin/reprocess-posters.ts \
  --source-path ./SourceImages \
  --batch-size 10 \
  --compress

# Skip backup (not recommended)
npx tsx scripts/admin/reprocess-posters.ts --skip-backup

# Non-interactive (dangerous!)
npx tsx scripts/admin/reprocess-posters.ts --skip-confirm
```

## MCP Tools

These operations are also available as MCP tools, callable from Claude or other MCP clients:

### `backup_database`
Create a database backup.
```json
{
  "compress": false,
  "backupDirectory": "./backups"
}
```

### `get_database_stats`
Get current database statistics without backing up.
```json
{}
```

### `reset_database`
Reset databases. **Requires confirmation token.**
```json
{
  "confirmationToken": "CONFIRM_RESET"
}
```

### `reprocess_posters`
Full reprocessing pipeline. **Requires confirmation token.**
```json
{
  "confirmationToken": "CONFIRM_REPROCESS",
  "skipBackup": false,
  "sourcePath": "./SourceImages",
  "batchSize": 5,
  "compressBackup": false
}
```

## Pipeline Workflow

The reprocessing pipeline follows this workflow:

```
┌─────────────────────────────────────────────────────────────┐
│                    REPROCESS PIPELINE                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. BACKUP (optional)                                        │
│     ├─ Export Neo4j nodes and relationships                  │
│     ├─ Export PostgreSQL embeddings                          │
│     └─ Create backup manifest                                │
│                                                              │
│  2. RESET                                                    │
│     ├─ Delete all Neo4j relationships                        │
│     ├─ Delete all Neo4j nodes                                │
│     ├─ Truncate PostgreSQL entity_embeddings                 │
│     └─ Verify empty state                                    │
│                                                              │
│  3. REPROCESS                                                │
│     ├─ Scan source directory for images                      │
│     ├─ Process images in batches                             │
│     │   ├─ Extract metadata with vision model                │
│     │   ├─ Create Poster entity                              │
│     │   ├─ Create Artist entities                            │
│     │   ├─ Create Venue entities                             │
│     │   └─ Create relationships                              │
│     └─ Report processing results                             │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NEO4J_URI` | `bolt://localhost:7693` | Neo4j connection URI |
| `NEO4J_USERNAME` | `neo4j` | Neo4j username |
| `NEO4J_PASSWORD` | (required) | Neo4j password |
| `NEO4J_DATABASE` | `neo4j` | Neo4j database name |
| `POSTGRES_HOST` | `localhost` | PostgreSQL host |
| `POSTGRES_PORT` | `5440` | PostgreSQL port |
| `POSTGRES_USER` | `posters` | PostgreSQL username |
| `POSTGRES_PASSWORD` | (required) | PostgreSQL password |
| `POSTGRES_DB` | `posters` | PostgreSQL database name |
| `SOURCE_IMAGES_PATH` | `./SourceImages` | Source images directory |
| `BATCH_SIZE` | `5` | Default processing batch size |
| `BACKUP_DIRECTORY` | `./backups` | Backup output directory |

## Restoring from Backup

To restore from a backup:

```bash
# Coming soon - restore-databases.ts
npx tsx scripts/admin/restore-databases.ts <timestamp>
```

For now, manual restoration can be done:

1. **Neo4j:** Import the JSON backup using a custom script
2. **PostgreSQL:** Execute the SQL backup file:
   ```bash
   psql -h localhost -p 5440 -U posters -d posters < postgres_backup_<timestamp>.sql
   ```

## Safety Notes

1. **Always backup before reset** - The `reprocess_posters` tool does this by default
2. **Confirmation tokens** - MCP tools require specific tokens to prevent accidental data loss
3. **Test with small batches** - Use small batch sizes when testing new configurations
4. **Check logs** - Monitor the output for errors during processing
