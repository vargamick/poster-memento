# Poster Type Inference: Aligning Ingestion and Validation

## Problem Statement

Many posters are being ingested with `poster_type = 'unknown'` even when the content clearly indicates a specific type. For example, a "1200 Techniques - Consistency Theory" poster is marked as `unknown` despite:
- "1200 Techniques" being a known artist in MusicBrainz/Discogs
- "Consistency Theory" being a known album by that artist

This document outlines a plan to improve poster type detection at both the **ingestion stage** (vision model extraction) and the **validation stage** (QA with external APIs).

---

## Current Architecture

### Ingestion Flow

```
Image File
    │
    ▼
┌─────────────────────────────────────────────┐
│           OllamaVisionProvider              │
│  - Sends image to vision model (minicpm-v)  │
│  - Parses structured response               │
│  - Returns poster_type from model response  │
└─────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────┐
│            PosterProcessor                   │
│  - line 173: poster_type = structured.      │
│              poster_type || 'unknown'       │
│  - Falls back to 'unknown' if model         │
│    doesn't return a type                    │
└─────────────────────────────────────────────┘
    │
    ▼
  Database
```

### Validation Flow (Current)

```
┌─────────────────────────────────────────────┐
│         QAValidationService                  │
│  - Fetches entities from database           │
│  - Routes to appropriate validators         │
└─────────────────────────────────────────────┘
    │
    ├─► ArtistValidator (validates headliner, supporting_acts)
    │
    ├─► VenueValidator (validates venue, location)
    │
    ├─► DateValidator (validates date formats)
    │
    └─► ReleaseValidator
            │
            └─► ONLY runs if poster_type is:
                - 'film' → TMDB lookup
                - 'release' or 'promo' → MusicBrainz/Discogs lookup
                - OTHERWISE SKIPPED ← THIS IS THE GAP
```

---

## Identified Issues

### Issue 1: Vision Model Type Detection Limitations

**Location**: `src/image-processor/providers/OllamaVisionProvider.ts`

The vision model determines `poster_type` based on visual cues:
- If it sees "NEW ALBUM", "OUT NOW" → `release`
- If it sees venue + date → `concert`
- If it can't determine → `unknown`

**Problem**: Release posters that show an artist name + album title but lack explicit "release" keywords get marked as `unknown`.

### Issue 2: Enum Mismatch

**Config** (`instances/posters/config/instance-config.json:17`):
```json
"poster_type_enum": ["event", "release", "promo", "exhibition", "hybrid", "unknown"]
```

**Vision Prompt** (`OllamaVisionProvider.ts:28-40`):
```
concert, festival, comedy, theater, film, release, promo, exhibition, hybrid, unknown
```

The config uses `event` but the vision prompt uses `concert/festival/comedy/theater`.

### Issue 3: QA Validation Skips Unknown Types

**Location**: `src/qa-validation/validators/ReleaseValidator.ts:70-86`

```typescript
// For film posters, validate against TMDB
if (posterType === 'film' && !this.isEmpty(entity.title)) {
  // validates
}
// For release/promo posters, validate against music databases
else if (
  (posterType === 'release' || posterType === 'promo') &&
  !this.isEmpty(entity.title)
) {
  // validates
}
// ELSE: nothing happens for 'unknown' type!
```

### Issue 4: No Poster Type Inference in QA

There's no validator that attempts to **infer** the correct `poster_type` by cross-referencing:
- Artist name → MusicBrainz/Discogs artist database
- Title → MusicBrainz release search (scoped to artist)
- Title → TMDB movie search

---

## Proposed Solutions

### Phase 1: Add PosterTypeValidator (QA Enhancement)

**New file**: `src/qa-validation/validators/PosterTypeValidator.ts`

This validator will:

1. **Run on ALL posters** (especially those with `poster_type = 'unknown'`)

2. **Inference Logic**:
   ```
   For each poster with headliner + title:
     1. Search MusicBrainz for artist by headliner name
     2. If found, search for releases by that artist matching title
     3. If album match found → suggest poster_type = 'release'

   For each poster with title but no headliner:
     1. Search TMDB for movie matching title
     2. If movie match found → suggest poster_type = 'film'

   For each poster with venue + date:
     1. If has headliner → suggest poster_type = 'concert'
     2. If multiple artists listed → suggest poster_type = 'festival'
   ```

3. **Output**: Suggestions to change `poster_type` field with confidence scores

**Implementation Tasks**:
- [ ] Create `PosterTypeValidator.ts` extending `BaseValidator`
- [ ] Add `poster_type` to `supportedFields`
- [ ] Implement inference logic using existing API clients
- [ ] Register validator in `QAValidationService.ts`
- [ ] Add 'poster_type' validator option to UI

### Phase 2: Improve Vision Model Prompt

**File**: `src/image-processor/providers/OllamaVisionProvider.ts`

Enhance the prompt to be more aggressive about type detection:

```diff
- - release: Promotes an album, single, EP, or music release
+ - release: Promotes an album, single, EP, or music release.
+   HINT: If you see an artist name AND an album/title name together
+   (especially with text like "OUT NOW", "NEW ALBUM", or just the
+   artist + title without a venue), this is likely a RELEASE poster.
```

Add examples in prompt:
```
EXAMPLES:
- "1200 TECHNIQUES - CONSISTENCY THEORY" = release (artist + album title)
- "METALLICA - ARENA TOUR 2024 - MADISON SQUARE GARDEN" = concert
- "GLASTONBURY FESTIVAL - COLDPLAY, FOO FIGHTERS..." = festival
```

**Implementation Tasks**:
- [ ] Update default prompt in `OllamaVisionProvider.ts`
- [ ] Add inference hints for ambiguous cases
- [ ] Add examples to guide the model
- [ ] Test with sample posters to validate improvements

### Phase 3: Align Enums

**Files to update**:
- `instances/posters/config/instance-config.json`
- `src/image-processor/types.ts`
- `src/qa-validation/types.ts`

**New unified enum**:
```typescript
type PosterType =
  | 'concert'     // Single artist/band live show
  | 'festival'    // Multi-act festival
  | 'comedy'      // Comedy/standup show
  | 'theater'     // Theatrical production
  | 'film'        // Movie/film
  | 'release'     // Album/single/EP release
  | 'promo'       // Promotional poster
  | 'exhibition'  // Art exhibition
  | 'hybrid'      // Combines multiple types
  | 'unknown';    // Cannot determine
```

**Implementation Tasks**:
- [ ] Update `instance-config.json` to use new enum
- [ ] Update type definitions in `types.ts` files
- [ ] Migration script to normalize existing data:
  - `event` → `concert` (most likely)
  - Keep other values as-is

### Phase 4: Post-Ingestion Validation Hook (Optional)

Add an optional hook to run lightweight type inference immediately after ingestion.

**Location**: `src/image-processor/PosterProcessor.ts`

```typescript
// After buildPosterEntity(), if type is unknown:
if (entity.poster_type === 'unknown' && entity.headliner && entity.title) {
  const inferredType = await this.inferPosterType(entity);
  if (inferredType && inferredType !== 'unknown') {
    entity.poster_type = inferredType;
    entity.metadata.inferred_type = true;
  }
}
```

**Implementation Tasks**:
- [ ] Add optional `runTypeInference` flag to `ProcessingOptions`
- [ ] Implement `inferPosterType()` method (can reuse API clients)
- [ ] Rate limit API calls during batch processing
- [ ] Mark inferred types in metadata for transparency

---

## Data Flow After Implementation

```
                    INGESTION
                        │
Image File ─────────────┤
                        ▼
              ┌─────────────────────┐
              │   Vision Model      │
              │ (improved prompt)   │
              └─────────────────────┘
                        │
                        ▼
              ┌─────────────────────┐
              │  PosterProcessor    │
              │ + optional type     │
              │   inference hook    │
              └─────────────────────┘
                        │
                        ▼
                   Database
                        │
                        │
                    VALIDATION
                        │
                        ▼
              ┌─────────────────────┐
              │ QAValidationService │
              └─────────────────────┘
                        │
       ┌────────────────┼────────────────────┐
       ▼                ▼                    ▼
 ┌───────────┐   ┌─────────────────┐   ┌───────────┐
 │ Artist    │   │ PosterType      │   │ Release   │
 │ Validator │   │ Validator (NEW) │   │ Validator │
 └───────────┘   │                 │   └───────────┘
                 │ - Infers type   │
                 │   from APIs     │
                 │ - Suggests fix  │
                 └─────────────────┘
```

---

## Testing Plan

### Unit Tests
- Test `PosterTypeValidator` with mock API responses
- Test inference logic for each poster type
- Test handling of ambiguous cases

### Integration Tests
- Process sample posters through full pipeline
- Verify type detection accuracy before/after changes
- Measure API call efficiency (caching, rate limiting)

### Test Cases
| Poster Content | Expected Type | Inference Source |
|----------------|---------------|------------------|
| Artist + Album title, no venue | `release` | MusicBrainz release lookup |
| Artist + Venue + Date | `concert` | Venue/date presence |
| Multiple artists + Festival name | `festival` | Multi-artist detection |
| Movie title only | `film` | TMDB lookup |
| Artist + Album + Venue + Date | `hybrid` | Both release and event detected |

---

## Priority Order

1. **Phase 1** (High Priority): Add `PosterTypeValidator` - immediate value, no changes to ingestion
2. **Phase 3** (Medium Priority): Align enums - prevents future confusion
3. **Phase 2** (Medium Priority): Improve vision prompt - reduces unknown at source
4. **Phase 4** (Low Priority): Post-ingestion hook - nice-to-have optimization

---

## Files to Modify

| File | Phase | Changes |
|------|-------|---------|
| `src/qa-validation/validators/PosterTypeValidator.ts` | 1 | NEW FILE |
| `src/qa-validation/QAValidationService.ts` | 1 | Register new validator |
| `src/qa-validation/types.ts` | 1, 3 | Add types, align enum |
| `instances/posters/ui/index.html` | 1 | Add validator option |
| `instances/posters/ui/js/qa-validation.js` | 1 | Handle new validator |
| `src/image-processor/providers/OllamaVisionProvider.ts` | 2 | Improve prompt |
| `instances/posters/config/instance-config.json` | 3 | Update enum |
| `src/image-processor/PosterProcessor.ts` | 4 | Add inference hook |

---

## Acceptance Criteria

- [ ] Posters with artist + album that match MusicBrainz get `poster_type = 'release'` suggested
- [ ] Unknown poster types are flagged for review in QA results
- [ ] API calls are rate-limited and cached appropriately
- [ ] UI shows poster type suggestions with "Apply Fix" option
- [ ] Enum values are consistent across config, types, and prompt
- [ ] Test coverage for type inference logic
