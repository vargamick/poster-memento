# Event-Centric Model Refactor Plan

## Overview

Refactor from a poster-centric model to an event-centric model where:
- **Poster** = A physical/digital artifact (the image itself)
- **Content** = What the poster advertises (Event, Release, Film, Exhibition)
- **Relationships** belong to Content, not Poster

This enables multiple posters for the same event, proper semantic relationships, and richer querying.

---

## Current Model (Poster-Centric)

```
(Poster)
   ├── poster_type: "concert"
   ├── headliner: "Metallica"
   ├── venue_name: "Madison Square Garden"
   ├── event_date: "2024-03-15"
   │
   ├──[HEADLINED_ON]──► (Artist: Metallica)
   ├──[PERFORMED_ON]──► (Artist: Greta Van Fleet)
   └──[ADVERTISES_VENUE]──► (Venue: MSG)
```

**Problems:**
- "Artist HEADLINED_ON Poster" is semantically wrong
- Two posters for same concert = duplicated relationships
- Can't track events independently of posters
- Film/comedy relationships don't fit (director, actors, comedian)

---

## Target Model (Event-Centric)

```
(Poster)                              (Event: Concert)
   │                                      ├── event_type: "concert"
   │                                      ├── event_date: "2024-03-15"
   │                                      │
   └──[ADVERTISES]────────────────────────┤
         confidence: 0.95                 ├──[HEADLINED_BY]──► (Artist: Metallica)
         inferred_at: "..."               ├──[FEATURED]──► (Artist: Greta Van Fleet)
                                          └──[HELD_AT]──► (Venue: MSG)
```

**Benefits:**
- Semantically correct relationships
- Multiple posters can reference same event
- Events exist independently (could come from other sources)
- Content-type-specific relationships (director for film, comedian for comedy)

---

## Entity Types

### Poster (Artifact)
The physical/digital poster image.

```typescript
interface Poster {
  name: string;                    // poster_<hash>
  entityType: 'Poster';
  extracted_text: string;          // Raw OCR text
  visual_elements: VisualElements;
  metadata: PosterMetadata;        // Image source, processing info
  observations: string[];
  // NO artist/venue/date properties - those belong to Content
}
```

### Event (Content)
A live performance or gathering.

```typescript
interface Event {
  name: string;                    // event_<hash> or human-readable
  entityType: 'Event';
  event_type: EventType;           // concert, festival, comedy, theater
  event_name?: string;             // "Metallica World Tour 2024"
  event_date?: string;
  event_date_end?: string;         // For festivals
  door_time?: string;
  show_time?: string;
  ticket_price?: string;
  age_restriction?: string;
  observations: string[];
}

type EventType = 'concert' | 'festival' | 'comedy' | 'theater' | 'exhibition';
```

### Release (Content)
A music release (album, single, EP).

```typescript
interface Release {
  name: string;
  entityType: 'Release';
  title: string;
  release_type?: 'album' | 'single' | 'ep' | 'compilation';
  release_date?: string;
  release_year?: number;
  record_label?: string;
  observations: string[];
}
```

### Film (Content)
A movie or film.

```typescript
interface Film {
  name: string;
  entityType: 'Film';
  title: string;
  release_year?: number;
  genre?: string[];
  runtime_minutes?: number;
  tmdb_id?: string;
  imdb_id?: string;
  observations: string[];
}
```

### Artist (Unchanged)
Musicians, bands, performers.

### Venue (Unchanged)
Physical locations.

### Person (New)
For film credits (directors, actors) and other non-musical people.

```typescript
interface Person {
  name: string;
  entityType: 'Person';
  display_name: string;
  profession?: string[];           // ['director', 'actor', 'comedian']
  tmdb_id?: string;
  observations: string[];
}
```

### Organization (Unchanged)
Labels, promoters, studios.

---

## Relationship Types

### Poster → Content

| Relationship | From | To | Description |
|--------------|------|----|-------------|
| `ADVERTISES` | Poster | Event, Release, Film | Poster advertises this content |

**Metadata on ADVERTISES:**
```typescript
{
  confidence: number;       // 0-1, how confident the link is
  is_primary: boolean;      // For hybrid posters (release party = event + release)
  source: string;           // 'vision' | 'qa_validation' | 'manual'
  inferred_at: string;      // ISO timestamp
  evidence?: string;        // "Found matching event in MusicBrainz"
}
```

### Event Relationships

| Relationship | From | To | Description |
|--------------|------|----|-------------|
| `HEADLINED_BY` | Event | Artist | Main performer |
| `FEATURED` | Event | Artist | Supporting act |
| `HELD_AT` | Event | Venue | Event location |
| `PROMOTED_BY` | Event | Organization | Promoter |
| `HOSTED_BY` | Event | Person/Artist | For comedy shows, MC |
| `PART_OF_TOUR` | Event | Tour | Links to tour entity |

**Metadata on performance relationships:**
```typescript
{
  billing_order?: number;     // 1 = headliner, 2 = first support, etc.
  set_time?: string;          // "21:00"
  performance_type?: string;  // 'headliner' | 'support' | 'special_guest'
}
```

### Release Relationships

| Relationship | From | To | Description |
|--------------|------|----|-------------|
| `CREATED_BY` | Release | Artist | Artist who made the release |
| `RELEASED_BY` | Release | Organization | Record label |
| `FEATURES` | Release | Artist | Featured artist on tracks |

### Film Relationships

| Relationship | From | To | Description |
|--------------|------|----|-------------|
| `DIRECTED_BY` | Film | Person | Director |
| `STARRED` | Person | Film | Lead actor |
| `PRODUCED_BY` | Film | Organization | Studio |
| `SCORED_BY` | Film | Artist/Person | Composer |

---

## Content Type Inference

The "poster type" is now **inferred from what the poster ADVERTISES**:

```
Poster --[ADVERTISES]--> Event (event_type: concert)  →  "concert poster"
Poster --[ADVERTISES]--> Release                       →  "release poster"
Poster --[ADVERTISES]--> Film                          →  "film poster"
Poster --[ADVERTISES]--> Event + Release (both)        →  "hybrid poster"
```

No more `poster_type` property needed - it's derived from relationships.

---

## Processing Pipeline Changes

### Current Flow
```
Image → Vision Model → Poster Entity (with all properties)
                           ↓
                    Create Artist/Venue entities
                           ↓
                    Create Poster→Artist/Venue relationships
```

### New Flow
```
Image → Vision Model → Extract structured data
                           ↓
                    Determine content type (Event/Release/Film)
                           ↓
                    Create Poster entity (minimal)
                           ↓
                    Create Content entity (Event/Release/Film)
                           ↓
                    Create Poster→Content relationship (ADVERTISES)
                           ↓
                    Create Content→Artist/Venue/Person relationships
```

### PosterProcessor Changes

```typescript
class PosterProcessor {
  async processImage(imagePath: string): Promise<ProcessingResult> {
    // 1. Extract with vision model
    const extraction = await this.vision.extractFromImage(imagePath);

    // 2. Create poster entity (artifact only)
    const poster = this.buildPosterEntity(imagePath, extraction);
    await this.createEntity(poster);

    // 3. Determine and create content
    const contentType = this.inferContentType(extraction);
    const content = await this.createContentEntity(contentType, extraction);

    // 4. Create ADVERTISES relationship
    await this.createRelationship(poster, 'ADVERTISES', content, {
      confidence: extraction.confidence ?? 0.8,
      source: 'vision',
      inferred_at: new Date().toISOString(),
      is_primary: true
    });

    // 5. Create content relationships (artists, venue, etc.)
    await this.createContentRelationships(content, extraction);

    return { poster, content, relationships };
  }

  private inferContentType(extraction: VisionExtractionResult): ContentType {
    const data = extraction.structured_data;

    // Has venue + date + performer = Event
    if (data?.venue && data?.date && (data?.headliner || data?.artists)) {
      // Multiple major artists = festival
      if (data.artists?.length >= 3) return 'festival';
      return 'concert';
    }

    // Has title + artist, no venue/date = Release
    if (data?.title && data?.headliner && !data?.venue && !data?.date) {
      return 'release';
    }

    // Film indicators (TMDB match, "IN THEATERS", etc.)
    if (data?.title && !data?.headliner && this.looksLikeFilm(data)) {
      return 'film';
    }

    return 'unknown';
  }
}
```

---

## Schema Updates

### instance-config.json Changes

```json
{
  "entityTypes": [
    {
      "name": "Poster",
      "description": "A physical or digital poster image (artifact)",
      "required_fields": ["name", "entityType", "extracted_text"],
      "optional_fields": ["visual_elements", "metadata", "observations"]
      // REMOVED: poster_type, headliner, venue_name, event_date, etc.
    },
    {
      "name": "Event",
      "description": "A live performance, show, or gathering",
      "required_fields": ["name", "entityType", "event_type"],
      "optional_fields": ["event_name", "event_date", "event_date_end", "door_time", "show_time", "ticket_price", "age_restriction", "observations"],
      "event_type_enum": ["concert", "festival", "comedy", "theater", "exhibition"]
    },
    {
      "name": "Film",
      "description": "A movie or film",
      "required_fields": ["name", "entityType", "title"],
      "optional_fields": ["release_year", "genre", "runtime_minutes", "tmdb_id", "imdb_id", "observations"]
    },
    {
      "name": "Person",
      "description": "A non-musical person (director, actor, comedian)",
      "required_fields": ["name", "entityType"],
      "optional_fields": ["display_name", "profession", "tmdb_id", "observations"]
    }
    // ... existing Artist, Venue, Release, Organization
  ],

  "relationshipTypes": [
    {
      "name": "ADVERTISES",
      "description": "Poster advertises this content",
      "from_entity_types": ["Poster"],
      "to_entity_types": ["Event", "Release", "Film"],
      "cardinality": "one-to-many",
      "metadata_schema": {
        "confidence": "number",
        "is_primary": "boolean",
        "source": "string",
        "inferred_at": "string",
        "evidence": "string"
      }
    },
    {
      "name": "HEADLINED_BY",
      "description": "Event was headlined by this artist",
      "from_entity_types": ["Event"],
      "to_entity_types": ["Artist"],
      "cardinality": "one-to-many",
      "metadata_schema": {
        "billing_order": "number",
        "set_time": "string"
      }
    },
    {
      "name": "FEATURED",
      "description": "Event featured this supporting artist",
      "from_entity_types": ["Event"],
      "to_entity_types": ["Artist"],
      "cardinality": "one-to-many",
      "metadata_schema": {
        "billing_order": "number",
        "set_time": "string"
      }
    },
    {
      "name": "HELD_AT",
      "description": "Event was held at this venue",
      "from_entity_types": ["Event"],
      "to_entity_types": ["Venue"],
      "cardinality": "many-to-one"
    },
    {
      "name": "HOSTED_BY",
      "description": "Event was hosted/MCd by this person",
      "from_entity_types": ["Event"],
      "to_entity_types": ["Person", "Artist"],
      "cardinality": "one-to-many"
    },
    {
      "name": "DIRECTED_BY",
      "description": "Film was directed by this person",
      "from_entity_types": ["Film"],
      "to_entity_types": ["Person"],
      "cardinality": "many-to-one"
    },
    {
      "name": "STARRED",
      "description": "Person starred in this film",
      "from_entity_types": ["Person"],
      "to_entity_types": ["Film"],
      "cardinality": "many-to-many",
      "metadata_schema": {
        "role": "string",
        "billing_order": "number"
      }
    }
    // ... keep existing CREATED_BY, RELEASED_BY for Release
  ]
}
```

---

## Migration Strategy

### Phase 1: Add New Schema (Non-Breaking)
- Add Event, Film, Person entity types
- Add ADVERTISES and new relationship types
- Keep existing Poster properties for backward compat

### Phase 2: Create Content Entities from Existing Data
For each existing Poster with relationships:
1. Infer content type from `poster_type` property
2. Create corresponding Event/Release/Film entity
3. Move properties (event_date, venue_name) to Content entity
4. Create ADVERTISES relationship

```typescript
async function migratePosters() {
  const posters = await getAllPosters();

  for (const poster of posters) {
    // Determine content type
    const contentType = inferContentTypeFromPoster(poster);

    // Create content entity
    const content = await createContentFromPoster(poster, contentType);

    // Create ADVERTISES relationship
    await createRelationship(poster.name, 'ADVERTISES', content.name, {
      confidence: 1.0,
      source: 'migration',
      is_primary: true,
      inferred_at: new Date().toISOString()
    });

    // Migrate artist relationships
    const artistRels = await getRelationships(poster.name, 'HEADLINED_ON');
    for (const rel of artistRels) {
      await createRelationship(content.name, 'HEADLINED_BY', rel.targetEntity, {
        billing_order: rel.metadata?.billing_order ?? 1
      });
      await deleteRelationship(rel.id);  // Remove old Poster→Artist
    }

    // Migrate venue relationships
    const venueRels = await getRelationships(poster.name, 'ADVERTISES_VENUE');
    for (const rel of venueRels) {
      await createRelationship(content.name, 'HELD_AT', rel.targetEntity);
      await deleteRelationship(rel.id);
    }
  }
}
```

### Phase 3: Update Processing Pipeline
- Update PosterProcessor to use new model
- Update vision prompt to better separate poster/content data
- Update QA validators

### Phase 4: Deprecate Old Properties
- Remove `poster_type`, `headliner`, `venue_name`, etc. from Poster
- Remove old relationship types (HEADLINED_ON, ADVERTISES_VENUE)

---

## Query Pattern Changes

### "Show all concert posters"
**Before:**
```cypher
MATCH (p:Poster {poster_type: 'concert'})
RETURN p
```

**After:**
```cypher
MATCH (p:Poster)-[:ADVERTISES]->(e:Event {event_type: 'concert'})
RETURN p, e
```

### "Show all posters featuring Artist X"
**Before:**
```cypher
MATCH (p:Poster)-[:HEADLINED_ON|PERFORMED_ON]->(a:Artist {name: 'Metallica'})
RETURN p
```

**After:**
```cypher
MATCH (p:Poster)-[:ADVERTISES]->(e:Event)-[:HEADLINED_BY|FEATURED]->(a:Artist {name: 'Metallica'})
RETURN p, e
```

### "What events happened at Venue X in 2024?"
**Before:** Not easily possible

**After:**
```cypher
MATCH (e:Event)-[:HELD_AT]->(v:Venue {name: 'Madison Square Garden'})
WHERE e.event_date STARTS WITH '2024'
RETURN e
ORDER BY e.event_date
```

### "Show all posters for the same event"
**Before:** Not possible (events not deduplicated)

**After:**
```cypher
MATCH (p1:Poster)-[:ADVERTISES]->(e:Event)<-[:ADVERTISES]-(p2:Poster)
WHERE p1 <> p2
RETURN e, collect(p1) + collect(p2) as posters
```

---

## Implementation Phases

### Phase 1: Schema Foundation
- [ ] Update instance-config.json with new entity types
- [ ] Update instance-config.json with new relationship types
- [ ] Add TypeScript interfaces for Event, Film, Person
- [ ] Create seed script for any reference data

### Phase 2: Processing Pipeline
- [ ] Update PosterProcessor.buildPosterEntity() to only include artifact data
- [ ] Add inferContentType() method
- [ ] Add createContentEntity() for Event/Release/Film
- [ ] Add createContentRelationships()
- [ ] Update vision prompt to better separate data

### Phase 3: Migration Script
- [ ] Create migration script with dry-run mode
- [ ] Handle Event creation from poster properties
- [ ] Migrate HEADLINED_ON → HEADLINED_BY (through Event)
- [ ] Migrate ADVERTISES_VENUE → HELD_AT (through Event)
- [ ] Add rollback capability

### Phase 4: QA Validation Updates
- [ ] Update validators to work with Content entities
- [ ] PosterTypeValidator → ContentTypeValidator
- [ ] Update fix application for relationship changes

### Phase 5: UI Updates
- [ ] Update poster detail view to show Content
- [ ] Show Event/Release/Film details
- [ ] Update search/filter to work with new model

### Phase 6: Cleanup
- [ ] Remove deprecated Poster properties
- [ ] Remove old relationship types
- [ ] Update documentation

---

## Example: Full Data Model

### Concert Poster Example
```
(Poster: poster_abc123)
   ├── extracted_text: "METALLICA WORLD TOUR 2024..."
   ├── visual_elements: { style: "photographic", ... }
   └── metadata: { source_image_url: "...", ... }
         │
         └──[ADVERTISES { confidence: 0.95, is_primary: true }]
                    │
                    ▼
(Event: event_metallica_msg_20240315)
   ├── event_type: "concert"
   ├── event_name: "Metallica World Tour 2024"
   ├── event_date: "2024-03-15"
   ├── show_time: "20:00"
   │
   ├──[HEADLINED_BY { billing_order: 1 }]──► (Artist: Metallica)
   ├──[FEATURED { billing_order: 2 }]──► (Artist: Greta Van Fleet)
   ├──[HELD_AT]──► (Venue: Madison Square Garden)
   └──[PROMOTED_BY]──► (Organization: Live Nation)
```

### Film Poster Example
```
(Poster: poster_def456)
   ├── extracted_text: "THE GODFATHER..."
   └── visual_elements: { ... }
         │
         └──[ADVERTISES { confidence: 0.92 }]
                    │
                    ▼
(Film: film_godfather_1972)
   ├── title: "The Godfather"
   ├── release_year: 1972
   ├── tmdb_id: "238"
   │
   ├──[DIRECTED_BY]──► (Person: Francis Ford Coppola)
   ├──[STARRED { role: "Don Vito Corleone" }]◄──(Person: Marlon Brando)
   ├──[STARRED { role: "Michael Corleone" }]◄──(Person: Al Pacino)
   └──[PRODUCED_BY]──► (Organization: Paramount Pictures)
```

### Release Poster Example
```
(Poster: poster_ghi789)
   ├── extracted_text: "1200 TECHNIQUES - CONSISTENCY THEORY..."
   └── visual_elements: { ... }
         │
         └──[ADVERTISES { confidence: 0.88 }]
                    │
                    ▼
(Release: release_1200tech_consistency)
   ├── title: "Consistency Theory"
   ├── release_type: "album"
   ├── release_year: 2003
   │
   ├──[CREATED_BY]──► (Artist: 1200 Techniques)
   └──[RELEASED_BY]──► (Organization: Hydrofunk Records)
```

---

## Acceptance Criteria

- [ ] Poster entity contains only artifact/image data
- [ ] Content entities (Event, Release, Film) exist for all content types
- [ ] ADVERTISES relationship links Poster → Content with metadata
- [ ] Content entities have proper relationships (HEADLINED_BY, HELD_AT, etc.)
- [ ] Multiple posters can reference the same Event
- [ ] Film posters have DIRECTED_BY, STARRED relationships
- [ ] Comedy/theater events have HOSTED_BY relationships
- [ ] Migration preserves all existing data
- [ ] QA validation works with new model
- [ ] UI displays Content information correctly
- [ ] "Poster type" is derived from ADVERTISES target, not stored

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Complex migration | Dry-run mode, rollback, backup |
| Query performance | Index on event_type, relationship traversal |
| UI complexity | Progressive disclosure, tabs for Poster vs Content |
| Deduplication of Events | Hash-based naming, merge detection |
| Breaking existing API | Versioned endpoints, backward compat period |

---

## Notes

- This model is more aligned with knowledge graph best practices
- Could extend to other content types (podcast, sports event, etc.)
- Consider adding `Tour` entity for tour-level grouping
- Person entity enables richer film/comedy modeling
- ADVERTISES relationship is key - it's what makes a poster a poster
