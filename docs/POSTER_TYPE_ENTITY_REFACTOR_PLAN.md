# Poster Type Entity Refactor Plan

## Overview

Refactor `poster_type` from a simple string property on Poster entities to a first-class `PosterType` entity with rich relationships, enabling better provenance tracking, confidence scoring, and graph-native queries.

---

## Current State

```
(Poster {
  name: "poster_abc123",
  poster_type: "release",  // ← Simple string property
  headliner: "1200 Techniques",
  title: "Consistency Theory",
  ...
})
```

**Limitations:**
- No metadata about classification (confidence, source, evidence)
- Cannot track when/how the type was determined
- "Hybrid" is awkward - it's really two types forced into one string
- No observations explaining the classification reasoning
- Cannot query type classification history

---

## Target State

```
(Poster {
  name: "poster_abc123",
  headliner: "1200 Techniques",
  title: "Consistency Theory",
  ...
})
  │
  └──[HAS_TYPE]──► (PosterType { name: "PosterType_release" })
        │
        └── relationship metadata:
              confidence: 0.92
              source: "musicbrainz"
              evidence: "Found album 'Consistency Theory' by 1200 Techniques"
              inferred_by: "PosterTypeValidator"
              inferred_at: "2024-02-04T10:30:00Z"
```

**Benefits:**
- Rich provenance on the relationship edge
- Multiple types naturally supported (no "hybrid" hack)
- Observations can explain classification reasoning
- Graph-native queries for type filtering
- Full audit trail of type changes

---

## Schema Changes

### New Entity Type: PosterType

**Location:** `instances/posters/config/instance-config.json`

```json
{
  "name": "PosterType",
  "description": "Classification category for poster content",
  "required_fields": ["name", "entityType", "type_key"],
  "optional_fields": ["display_name", "description", "detection_hints"]
}
```

### New Relationship Type: HAS_TYPE

**Location:** `instances/posters/config/instance-config.json`

```json
{
  "name": "HAS_TYPE",
  "description": "Poster is classified as this type",
  "from_entity_types": ["Poster"],
  "to_entity_types": ["PosterType"],
  "cardinality": "one-to-many",
  "metadata_schema": {
    "confidence": "number",
    "source": "string",
    "evidence": "string",
    "inferred_by": "string",
    "inferred_at": "string",
    "is_primary": "boolean"
  }
}
```

### Seed PosterType Entities

Create one entity per type:

| Entity Name | type_key | display_name | description |
|-------------|----------|--------------|-------------|
| PosterType_concert | concert | Concert | Single artist/band live performance at a venue |
| PosterType_festival | festival | Festival | Multi-act music festival |
| PosterType_comedy | comedy | Comedy | Comedy show or standup performance |
| PosterType_theater | theater | Theater | Theatrical production or play |
| PosterType_film | film | Film | Movie or film screening |
| PosterType_release | release | Release | Album, single, EP, or music release promo |
| PosterType_promo | promo | Promo | General promotional/advertising |
| PosterType_exhibition | exhibition | Exhibition | Art exhibition, gallery, or museum |
| PosterType_unknown | unknown | Unknown | Type could not be determined |

---

## Code Changes

### Phase 1: Schema & Seed Data

**Files to modify:**
- `instances/posters/config/instance-config.json` - Add PosterType entity and HAS_TYPE relationship

**New files:**
- `instances/posters/seeds/poster-types.json` - Seed data for PosterType entities
- `src/scripts/seed-poster-types.ts` - Script to create seed entities

**Tasks:**
- [ ] Add PosterType entity definition to instance-config.json
- [ ] Add HAS_TYPE relationship definition to instance-config.json
- [ ] Create poster-types.json seed file with all type entities
- [ ] Create seed script that creates PosterType entities if they don't exist
- [ ] Add seed script to npm scripts

### Phase 2: PosterProcessor Updates

**Files to modify:**
- `src/image-processor/PosterProcessor.ts`
- `src/image-processor/types.ts`

**Changes:**
1. Remove `poster_type` from `PosterEntity` interface (or deprecate)
2. Add `inferred_types` array to track type inference results
3. After entity creation, create HAS_TYPE relationship(s) with metadata
4. Handle "hybrid" case by creating two relationships

**New interface:**
```typescript
interface TypeInference {
  type_key: string;
  confidence: number;
  source: 'vision' | 'musicbrainz' | 'discogs' | 'tmdb' | 'internal';
  evidence?: string;
  is_primary: boolean;
}
```

**Tasks:**
- [ ] Update PosterEntity type to include `inferred_types?: TypeInference[]`
- [ ] Deprecate `poster_type` property (keep for backward compat)
- [ ] Update buildPosterEntity() to populate inferred_types
- [ ] Add createTypeRelationships() method
- [ ] Update processImage() to call createTypeRelationships() after entity creation

### Phase 3: PosterTypeValidator Updates

**Files to modify:**
- `src/qa-validation/validators/PosterTypeValidator.ts`

**Changes:**
1. Query existing HAS_TYPE relationships instead of poster_type property
2. Suggest relationship changes rather than property changes
3. Include relationship metadata in suggestions
4. Handle multiple type relationships

**Tasks:**
- [ ] Update validate() to fetch existing HAS_TYPE relationships
- [ ] Update inference results to suggest relationship operations
- [ ] Add support for "add relationship" vs "update relationship" suggestions
- [ ] Update confidence comparison to consider existing relationship confidence

### Phase 4: QAValidationService Updates

**Files to modify:**
- `src/qa-validation/QAValidationService.ts`

**Changes:**
1. Update applyFix() to handle relationship changes
2. Add createRelationship() and updateRelationship() operations

**Tasks:**
- [ ] Add applyRelationshipFix() method
- [ ] Update applyFix() to detect relationship vs property fixes
- [ ] Update applyFixBatch() accordingly

### Phase 5: Migration Script

**New files:**
- `src/scripts/migrate-poster-types.ts`

**Migration logic:**
1. Find all Poster entities with `poster_type` property
2. For each poster:
   - Look up corresponding PosterType entity
   - Create HAS_TYPE relationship with metadata:
     - confidence: 1.0 (or lower if type was 'unknown')
     - source: 'migration'
     - evidence: 'Migrated from poster_type property'
     - inferred_by: 'migrate-poster-types'
     - is_primary: true
3. Optionally remove poster_type property (or leave for backward compat)

**Tasks:**
- [ ] Create migration script
- [ ] Add dry-run mode
- [ ] Add batch processing with progress reporting
- [ ] Add rollback capability (delete relationships, restore properties)
- [ ] Add to npm scripts

### Phase 6: Query Pattern Updates

**Files to modify:**
- `src/core/services/EntityService.ts` (if type filtering exists)
- UI components that filter by type

**New query patterns:**
```cypher
// Find all release posters
MATCH (p:Poster)-[:HAS_TYPE]->(t:PosterType {type_key: 'release'})
RETURN p

// Find posters with multiple types
MATCH (p:Poster)-[r:HAS_TYPE]->(t:PosterType)
WITH p, collect(t.type_key) as types
WHERE size(types) > 1
RETURN p, types

// Find posters by type with confidence threshold
MATCH (p:Poster)-[r:HAS_TYPE]->(t:PosterType {type_key: 'release'})
WHERE r.confidence >= 0.8
RETURN p, r.confidence
```

**Tasks:**
- [ ] Update any existing type-based queries
- [ ] Add helper methods for common type queries
- [ ] Update UI type filtering to use relationships

### Phase 7: UI Updates

**Files to modify:**
- `instances/posters/ui/js/app.js` - Poster display
- `instances/posters/ui/js/qa-validation.js` - QA results

**Tasks:**
- [ ] Update poster detail view to show type from relationship
- [ ] Show confidence badge for type
- [ ] Show multiple types if present
- [ ] Update QA results to handle relationship suggestions

---

## Data Model Comparison

### Before (Property)
```
Poster
├── name: "poster_abc123"
├── poster_type: "release"      ← flat string
├── headliner: "1200 Techniques"
└── title: "Consistency Theory"
```

### After (Entity + Relationship)
```
Poster                           PosterType
├── name: "poster_abc123"        ├── name: "PosterType_release"
├── headliner: "1200 Techniques" ├── type_key: "release"
└── title: "Consistency Theory"  ├── display_name: "Release"
         │                       └── description: "Album/single/EP promo"
         │
         └──[HAS_TYPE]──────────────────────►
              ├── confidence: 0.92
              ├── source: "musicbrainz"
              ├── evidence: "Found album..."
              ├── inferred_by: "PosterTypeValidator"
              ├── inferred_at: "2024-02-04T..."
              └── is_primary: true
```

---

## Handling Hybrid Posters

**Current:** `poster_type: "hybrid"` (awkward)

**New:** Two relationships with `is_primary` flag

```
(Poster)
   ├──[HAS_TYPE {is_primary: true, ...}]──► (PosterType_release)
   └──[HAS_TYPE {is_primary: false, ...}]──► (PosterType_concert)
```

This allows:
- Querying by either type
- Knowing which type is dominant
- Tracking confidence for each type independently

---

## Backward Compatibility

During migration period:
1. Keep `poster_type` property on entities (read-only, deprecated)
2. Update property when relationship changes
3. New code reads from relationship, falls back to property
4. After full migration, remove property handling

---

## Testing Plan

### Unit Tests
- [ ] PosterType entity creation
- [ ] HAS_TYPE relationship creation with metadata
- [ ] PosterProcessor creates relationships correctly
- [ ] PosterTypeValidator suggests relationship changes
- [ ] Migration script converts existing posters

### Integration Tests
- [ ] End-to-end: process image → creates poster + type relationship
- [ ] QA validation → detects type issues → applies relationship fix
- [ ] Query by type returns correct posters

### Migration Tests
- [ ] Dry-run produces correct plan
- [ ] Actual migration creates correct relationships
- [ ] Rollback restores original state
- [ ] Performance with large dataset

---

## Implementation Order

1. **Phase 1: Schema & Seeds** - Foundation work, no code changes
2. **Phase 5: Migration Script** - Migrate existing data first
3. **Phase 2: PosterProcessor** - New posters use new model
4. **Phase 3: PosterTypeValidator** - QA works with new model
5. **Phase 4: QAValidationService** - Fix application works
6. **Phase 6: Query Patterns** - Update any type-based queries
7. **Phase 7: UI Updates** - Display updates

---

## Acceptance Criteria

- [ ] PosterType entities exist for all type categories
- [ ] New posters get HAS_TYPE relationships with full metadata
- [ ] Existing posters migrated to HAS_TYPE relationships
- [ ] PosterTypeValidator suggests relationship changes
- [ ] QA can apply relationship-based fixes
- [ ] UI shows type with confidence indicator
- [ ] "Hybrid" posters have multiple type relationships
- [ ] Graph queries work for type filtering
- [ ] No data loss during migration

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Migration corrupts data | Dry-run mode, rollback capability, backup before migration |
| Performance degradation | Relationship queries may need indexes on type_key |
| Breaking existing code | Backward compat period with property fallback |
| UI complexity increase | Progressive disclosure - show confidence only on hover |

---

## Estimated Effort

| Phase | Effort |
|-------|--------|
| Phase 1: Schema & Seeds | Small |
| Phase 2: PosterProcessor | Medium |
| Phase 3: PosterTypeValidator | Medium |
| Phase 4: QAValidationService | Small |
| Phase 5: Migration Script | Medium |
| Phase 6: Query Patterns | Small |
| Phase 7: UI Updates | Small-Medium |
| Testing | Medium |

---

## Notes

- This refactor aligns with knowledge graph best practices
- Similar pattern could be applied to other classifications (visual_style, etc.)
- Consider adding `RECLASSIFIED_FROM` relationship for audit trail
