# Poster Memento - Claude Desktop Project Instructions

You have access to the **poster-memento** MCP server, a knowledge graph containing digitized poster metadata. This system stores information about posters, artists, venues, events, and their relationships extracted via vision AI.

## Available MCP Tools

### Primary Search Tools

| Tool | Purpose |
|------|---------|
| `search_nodes` | Keyword search across entity names, types, and observations |
| `semantic_search` | Vector-based semantic similarity search |
| `advanced_search` | Hybrid search combining keyword + semantic with faceting |
| `find_similar_entities` | Find entities similar to a text query |
| `list_entities_by_type` | List all entities of specific types |

### Entity Retrieval Tools

| Tool | Purpose |
|------|---------|
| `open_nodes` | Retrieve specific entities by exact name |
| `read_graph` | Read the entire graph with pagination |
| `get_entity_embedding` | Get vector embedding for an entity |

### Relationship Tools

| Tool | Purpose |
|------|---------|
| `get_relation` | Get a specific relationship between entities |
| `find_paths` | Find connection paths between two entities |
| `get_node_analytics` | Analyze an entity's connections and importance |

### Analytics Tools

| Tool | Purpose |
|------|---------|
| `get_graph_statistics` | Overall graph metrics and counts |
| `get_processing_status` | Processing progress and poster counts |

---

## Entity Types in the Graph

The knowledge graph contains these entity types:

- **Poster** - The primary entity, representing a digitized poster image
- **Artist** - Musicians, bands, performers appearing on posters
- **Venue** - Locations where events took place
- **Event** - Specific concerts, shows, or performances
- **City** - Geographic locations

---

## How to Search for Posters

### 1. Basic Keyword Search

Use `search_nodes` for simple text matching:

```json
{
  "tool": "search_nodes",
  "arguments": {
    "query": "concert 1970s",
    "limit": 20
  }
}
```

### 2. Search by Entity Type

Use `list_entities_by_type` to find all posters:

```json
{
  "tool": "list_entities_by_type",
  "arguments": {
    "entityTypes": ["Poster"],
    "limit": 50,
    "includeTotalCount": true
  }
}
```

### 3. Semantic Search (Recommended)

Use `semantic_search` for natural language queries. This finds conceptually similar results even without exact keyword matches:

```json
{
  "tool": "semantic_search",
  "arguments": {
    "query": "psychedelic rock concert posters from San Francisco",
    "limit": 15,
    "min_similarity": 0.6,
    "hybrid_search": true
  }
}
```

### 4. Advanced Hybrid Search

Use `advanced_search` for the most comprehensive results:

```json
{
  "tool": "advanced_search",
  "arguments": {
    "query": "jazz festival outdoor venue",
    "semanticSearch": true,
    "hybridSearch": true,
    "limit": 20,
    "threshold": 0.5,
    "entityTypes": ["Poster"]
  }
}
```

---

## Understanding Poster Observations

Each poster entity contains `observations` - an array of extracted metadata:

```
observations: [
  "Extracted from image: filename.jpg",
  "Poster type: event",
  "Title: Summer Jazz Festival",
  "Headliner: Miles Davis",
  "Supporting acts: John Coltrane, Herbie Hancock",
  "Venue: Fillmore West",
  "City: San Francisco",
  "Event date: August 15, 1968",
  "Visual style: psychedelic",
  "Dominant colors: Purple, orange, yellow"
]
```

### Key Observation Fields to Search

| Field | Description | Example Values |
|-------|-------------|----------------|
| Poster type | Category of poster | event, release, tour, promotional |
| Title | Main title or event name | "Summer Jam", "World Tour 2024" |
| Headliner | Main performer | Artist/band name |
| Supporting acts | Opening acts | Comma-separated artist names |
| Venue | Location name | "Madison Square Garden" |
| City | Geographic location | "New York", "Los Angeles" |
| Event date | When the event occurred | Various date formats |
| Visual style | Artistic style | psychedelic, typographic, photographic, illustrated |
| Dominant colors | Color palette | Color names |

---

## Search Strategies

### Finding Posters by Artist

```json
{
  "tool": "search_nodes",
  "arguments": {
    "query": "Grateful Dead",
    "limit": 30
  }
}
```

Or search for the Artist entity first, then find related posters:

```json
{
  "tool": "search_nodes",
  "arguments": {
    "query": "Grateful Dead",
    "entityTypes": ["Artist"]
  }
}
```

### Finding Posters by Venue

```json
{
  "tool": "semantic_search",
  "arguments": {
    "query": "Fillmore concerts",
    "entity_types": ["Poster", "Venue"],
    "hybrid_search": true
  }
}
```

### Finding Posters by Visual Style

```json
{
  "tool": "semantic_search",
  "arguments": {
    "query": "psychedelic art style colorful posters",
    "min_similarity": 0.5
  }
}
```

### Finding Posters by Era/Decade

```json
{
  "tool": "advanced_search",
  "arguments": {
    "query": "1960s 1970s rock concert",
    "semanticSearch": true,
    "hybridSearch": true,
    "entityTypes": ["Poster"]
  }
}
```

### Finding Posters by Color

```json
{
  "tool": "semantic_search",
  "arguments": {
    "query": "purple and orange psychedelic colors",
    "hybrid_search": true
  }
}
```

---

## Using Relationships

Posters are connected to other entities via relationships:

- `Poster` → FEATURES → `Artist`
- `Poster` → HELD_AT → `Venue`
- `Poster` → LOCATED_IN → `City`
- `Poster` → FOR_EVENT → `Event`
- `Artist` → PERFORMED_AT → `Venue`

### Finding Connections Between Entities

```json
{
  "tool": "find_paths",
  "arguments": {
    "fromEntity": "artist_grateful_dead",
    "toEntity": "venue_fillmore_west",
    "maxDepth": 3
  }
}
```

### Analyzing an Entity's Relationships

```json
{
  "tool": "get_node_analytics",
  "arguments": {
    "entityName": "venue_fillmore_west",
    "includeNeighbors": true,
    "neighborDepth": 2
  }
}
```

---

## Weighted Query Strategies

### Balancing Keyword vs Semantic Search

The `semantic_search` tool supports `semantic_weight` (0.0-1.0):

- **Higher weight (0.7-1.0)**: Better for conceptual/thematic queries
  - "energetic punk rock aesthetic"
  - "peaceful nature-inspired artwork"

- **Lower weight (0.3-0.5)**: Better for specific terms
  - "Madison Square Garden 1975"
  - "Pink Floyd Dark Side"

```json
{
  "tool": "semantic_search",
  "arguments": {
    "query": "dark moody atmospheric concert posters",
    "semantic_weight": 0.8,
    "hybrid_search": true
  }
}
```

### Adjusting Similarity Thresholds

- **High threshold (0.7-0.9)**: Precise matches, fewer results
- **Medium threshold (0.5-0.7)**: Balanced results (recommended)
- **Low threshold (0.3-0.5)**: Broad matches, more results

```json
{
  "tool": "find_similar_entities",
  "arguments": {
    "query": "vintage rock and roll poster art",
    "threshold": 0.5,
    "limit": 25
  }
}
```

---

## Best Practices

### 1. Start Broad, Then Narrow

Begin with a semantic search to understand what's available:
```json
{"tool": "semantic_search", "arguments": {"query": "rock concerts", "limit": 30}}
```

Then refine with specific filters:
```json
{"tool": "advanced_search", "arguments": {"query": "rock concerts 1970s San Francisco", "entityTypes": ["Poster"]}}
```

### 2. Use Entity Type Filters

Always specify `entityTypes` when you know what you're looking for:
```json
{"entityTypes": ["Poster"]}      // Only posters
{"entityTypes": ["Artist"]}       // Only artists
{"entityTypes": ["Poster", "Artist", "Venue"]}  // Multiple types
```

### 3. Combine Search Approaches

For complex queries, use multiple tool calls:

1. First, find relevant artists/venues
2. Then search for posters mentioning those entities
3. Use `find_paths` to discover connections

### 4. Pagination for Large Results

Use `offset` and `limit` for paginated results:
```json
{
  "tool": "list_entities_by_type",
  "arguments": {
    "entityTypes": ["Poster"],
    "limit": 50,
    "offset": 0,
    "includeTotalCount": true
  }
}
```

### 5. Check Graph Statistics First

Before extensive searching, understand the data:
```json
{"tool": "get_graph_statistics", "arguments": {}}
```

---

## Example Workflows

### "Find all posters featuring jazz artists"

1. Search for jazz-related content:
   ```json
   {"tool": "semantic_search", "arguments": {"query": "jazz music posters", "limit": 30}}
   ```

2. Or list by type and filter in observations:
   ```json
   {"tool": "search_nodes", "arguments": {"query": "jazz", "entityTypes": ["Poster"]}}
   ```

### "Show me colorful psychedelic posters from the 1960s"

```json
{
  "tool": "advanced_search",
  "arguments": {
    "query": "psychedelic colorful 1960s sixties art",
    "semanticSearch": true,
    "hybridSearch": true,
    "entityTypes": ["Poster"],
    "limit": 20
  }
}
```

### "Find connections between The Beatles and San Francisco venues"

```json
{
  "tool": "find_paths",
  "arguments": {
    "fromEntity": "artist_the_beatles",
    "toEntity": "city_san_francisco",
    "maxDepth": 4,
    "findAllPaths": true
  }
}
```

---

## Tips for Better Results

1. **Use descriptive queries** - "vintage hand-drawn concert poster" works better than "old poster"

2. **Include context** - "rock concert at outdoor amphitheater summer festival" gives richer semantic matches

3. **Try synonyms** - If "gig" doesn't work, try "concert", "show", "performance"

4. **Check observations** - The extracted text and metadata in observations often contains searchable details

5. **Use hybrid mode** - `hybrid_search: true` combines the best of keyword and semantic search

6. **Iterate** - Start with broad queries, examine results, then refine your search terms
