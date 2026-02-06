# Iterative Processing Pipeline Plan

## Overview

Transform the current single-pass poster processing into a multi-phase iterative pipeline where each phase extracts specific data, validates it against external knowledge bases, and refines results before proceeding to the next phase.

## Current vs. Proposed Flow

### Current Flow (Single Pass)
```
Image → Vision Model → Extract ALL metadata → Create Entities → QA Validation (post-hoc)
```

### Proposed Flow (Iterative)
```
Image → Phase 1: Type Classification → Validate Type →
        Phase 2: Artist Extraction → Validate Artists →
        Phase 3: Venue Extraction → Validate Venue →
        Phase 4: Event/Date Extraction → Validate Event →
        Final: Assemble & Store Entities
```

---

## Phase 1: Type Classification

### Purpose
Determine poster type (concert, festival, film, theater, etc.) before extracting type-specific details.

### Processing Steps
1. **Initial Type Extraction**
   - Use vision model with type-focused prompt
   - Extract: `poster_type`, visual cues, confidence level
   - Store as preliminary `TypeInference` objects

2. **Type Validation**
   - Query internal knowledge base for similar posters
   - Use visual element patterns (has_artist_photo → likely concert/release)
   - Cross-reference extracted text patterns against type signatures

3. **Type Refinement**
   - If confidence < threshold (e.g., 0.7):
     - Run secondary type detection prompt
     - Weight results from multiple signals
   - If hybrid type detected:
     - Identify primary and secondary types
     - Store both with relative confidence

### API Calls
```typescript
// Existing APIs to leverage:
SearchService.search(query, { entityTypes: ['Poster'] }) // Find similar posters
QAValidationService.validators.posterType.validate(entity) // Type confidence check
```

### Output
```typescript
interface Phase1Result {
  posterId: string;
  primaryType: {
    type: PosterType;
    confidence: number;
    evidence: string[];
  };
  secondaryTypes?: TypeInference[];
  visualCues: VisualElements;
  readyForPhase2: boolean;
}
```

---

## Phase 2: Artist Extraction & Validation

### Purpose
Extract and validate artist information using type-informed prompts.

### Processing Steps
1. **Type-Informed Extraction**
   - Use type-specific prompt templates:
     - Concert: Focus on headliner, supporting acts, tour name
     - Film: Focus on director, cast, studio
     - Festival: Focus on lineup, multiple headliners
     - Release: Focus on artist, album, label

2. **Artist Validation Pipeline**
   ```
   Extracted Name → Normalize → Search MusicBrainz →
   Search Discogs → Calculate Match Score →
   Return Best Match or Alternatives
   ```

3. **Disambiguation Handling**
   - Multiple matches: Present alternatives with confidence scores
   - No match: Flag for manual review, search broader
   - Partial match: Suggest corrections (spelling, formatting)

4. **Relationship Inference**
   - Query existing Artist entities in graph
   - Check for existing relationships to validate context
   - Infer relationships based on validation results

### API Calls
```typescript
// External validation
ArtistValidator.validate(artistName, {
  musicbrainz: true,
  discogs: true
});

// Internal knowledge base
EntityService.searchEntities(artistName, { entityTypes: ['Artist'] });
RelationService.getRelations({ entityType: 'Artist', name: artistName });
```

### Output
```typescript
interface Phase2Result {
  posterId: string;
  headliner?: {
    extractedName: string;
    validatedName?: string;
    externalId?: string; // MusicBrainz MBID
    confidence: number;
    source: ValidationSource;
    alternatives?: ArtistMatch[];
  };
  supportingActs?: ArtistValidation[];
  existingArtistMatches?: EntityReference[];
  readyForPhase3: boolean;
}
```

---

## Phase 3: Venue Extraction & Validation

### Purpose
Extract and validate venue information with geographic context.

### Processing Steps
1. **Venue Extraction**
   - Extract: venue_name, city, state, address hints
   - Use artist/type context to narrow geography

2. **Venue Validation Pipeline**
   ```
   Extracted Venue → Search Internal Graph →
   Search External APIs (future: Google Places, Songkick) →
   Geographic Validation → Return Match
   ```

3. **Geographic Inference**
   - If city/state missing: Infer from venue name patterns
   - Cross-reference with artist tour data (if available)
   - Validate against known venue locations in graph

4. **Venue Disambiguation**
   - Same name, different cities: Use context clues
   - Historical venues: Check date against venue existence
   - Renamed venues: Match against aliases

### API Calls
```typescript
// Internal search
EntityService.searchEntities(venueName, { entityTypes: ['Venue'] });

// Venue validation
VenueValidator.validate(venueInfo, { context: posterType });

// Geographic search (via observations)
SearchService.search(`venue in ${city}`, { entityTypes: ['Venue'] });
```

### Output
```typescript
interface Phase3Result {
  posterId: string;
  venue?: {
    extractedName: string;
    validatedName?: string;
    city?: string;
    state?: string;
    existingVenueMatch?: EntityReference;
    confidence: number;
  };
  readyForPhase4: boolean;
}
```

---

## Phase 4: Event & Date Extraction

### Purpose
Extract and validate temporal information and event details.

### Processing Steps
1. **Date Extraction**
   - Extract: event_date, year, decade, door_time, show_time
   - Parse multiple date formats
   - Handle partial dates (year only, month/year)

2. **Date Validation**
   - Validate date plausibility:
     - Artist active during period?
     - Venue existed at time?
     - Event type appropriate for era?
   - Cross-reference with known tours/events

3. **Event Assembly**
   - Combine validated components
   - Generate event name if not explicit
   - Calculate overall confidence

### API Calls
```typescript
// Date validation
DateValidator.validate(dateString, { context: { artist, venue } });

// Historical validation via search
SearchService.search(`${artistName} ${year}`, { entityTypes: ['Poster'] });
```

### Output
```typescript
interface Phase4Result {
  posterId: string;
  eventDate?: {
    parsed: Date;
    confidence: number;
    format: string;
  };
  year?: number;
  timeDetails?: {
    doorTime?: string;
    showTime?: string;
  };
  readyForAssembly: boolean;
}
```

---

## Final Assembly Phase

### Purpose
Combine all validated phases into final entity structure.

### Processing Steps
1. **Confidence Aggregation**
   - Calculate overall extraction confidence
   - Identify fields needing review

2. **Entity Creation**
   - Create Poster entity with validated fields
   - Create/link Artist entities (with external IDs)
   - Create/link Venue entities
   - Create HAS_TYPE relationships

3. **Relationship Building**
   - HEADLINED_ON: Headliner → Poster
   - PERFORMED_ON: Supporting acts → Poster
   - ADVERTISES_VENUE: Venue → Poster
   - HAS_TYPE: Poster → PosterType

4. **Quality Flagging**
   - Flag low-confidence fields for review
   - Queue for manual validation if below threshold

---

## Implementation Architecture

### New Service: IterativeProcessor

```typescript
// src/image-processor/IterativeProcessor.ts

export class IterativeProcessor {
  constructor(
    private visionProvider: VisionProvider,
    private entityService: EntityService,
    private searchService: SearchService,
    private validators: ValidatorRegistry
  ) {}

  async processIteratively(
    imagePath: string,
    options: IterativeOptions
  ): Promise<IterativeProcessingResult> {
    // Phase 1
    const typeResult = await this.extractAndValidateType(imagePath);
    if (!typeResult.readyForPhase2) {
      return this.handleTypeUncertainty(typeResult);
    }

    // Phase 2
    const artistResult = await this.extractAndValidateArtists(
      imagePath,
      typeResult
    );

    // Phase 3
    const venueResult = await this.extractAndValidateVenue(
      imagePath,
      typeResult,
      artistResult
    );

    // Phase 4
    const eventResult = await this.extractAndValidateEvent(
      imagePath,
      typeResult,
      artistResult,
      venueResult
    );

    // Assembly
    return this.assembleAndStore({
      typeResult,
      artistResult,
      venueResult,
      eventResult
    });
  }
}
```

### Phase Execution Manager

```typescript
// src/image-processor/PhaseManager.ts

export class PhaseManager {
  private phases: Map<string, PhaseExecutor> = new Map();

  async executePhase<T extends PhaseResult>(
    phaseName: string,
    input: PhaseInput,
    context: ProcessingContext
  ): Promise<T> {
    const executor = this.phases.get(phaseName);

    // Execute with retry logic
    const result = await executor.execute(input, context);

    // Validate phase result
    await this.validatePhaseResult(result);

    // Store intermediate state
    await this.persistPhaseState(context.sessionId, phaseName, result);

    return result;
  }
}
```

### Type-Specific Prompt Templates

```typescript
// src/image-processor/prompts/TypePrompts.ts

export const TYPE_SPECIFIC_PROMPTS = {
  concert: {
    artist: `Extract the performing artists from this concert poster.
      Look for: Headlining act (largest text), Supporting acts, Tour name.
      Return structured JSON.`,
    venue: `Extract venue information from this concert poster.
      Look for: Venue name, City, State, Address.`
  },
  film: {
    artist: `Extract credits from this movie poster.
      Look for: Director, Lead actors, Studio.`,
    venue: `Extract theater/release information.
      Look for: Theater name, Release date, Rating.`
  },
  // ... other types
};
```

---

## API Endpoint Changes

### New Endpoints

```typescript
// POST /processing/iterative/start
// Start iterative processing job for batch of images
{
  imagePaths: string[];
  options: {
    confidenceThreshold: number;  // Minimum confidence to proceed
    validateTypes: boolean;       // Run type validation
    validateArtists: boolean;     // Run artist validation
    validateVenues: boolean;      // Run venue validation
    pauseOnLowConfidence: boolean; // Stop for manual review
  }
}

// GET /processing/iterative/:jobId/phase/:phase
// Get results for specific phase

// POST /processing/iterative/:jobId/phase/:phase/retry
// Retry a specific phase with adjusted parameters

// POST /processing/iterative/:jobId/override
// Manually override a field and continue processing
{
  entityId: string;
  field: string;
  value: any;
  continueProcessing: boolean;
}
```

### Modified Existing Endpoints

```typescript
// POST /processing/posters/batch - Add iterative mode
{
  imagePaths: string[];
  mode: 'single-pass' | 'iterative';  // NEW
  iterativeOptions?: IterativeOptions; // NEW
}
```

---

## UI Changes (instances/posters/ui)

### Processing View Enhancements

1. **Phase Progress Indicator**
   - Visual pipeline showing current phase
   - Per-poster phase status
   - Confidence meters per phase

2. **Validation Results Display**
   - Show external matches found
   - Display alternatives for low-confidence fields
   - Allow selection of correct value

3. **Manual Override Interface**
   - Edit field values mid-processing
   - Approve/reject suggestions
   - Continue to next phase

---

## Configuration

### New Config Options

```json
// instances/posters/config/instance-config.json
{
  "processing": {
    "mode": "iterative",
    "phases": {
      "type": {
        "enabled": true,
        "confidenceThreshold": 0.7,
        "retryOnLowConfidence": true
      },
      "artist": {
        "enabled": true,
        "validationSources": ["musicbrainz", "discogs", "internal"],
        "confidenceThreshold": 0.6
      },
      "venue": {
        "enabled": true,
        "validationSources": ["internal", "geographic"],
        "confidenceThreshold": 0.6
      },
      "event": {
        "enabled": true,
        "validateDates": true,
        "inferFromContext": true
      }
    },
    "onLowConfidence": "flag" | "pause" | "skip",
    "batchSize": 10
  }
}
```

---

## Migration Path

### Phase 1: Foundation (Week 1-2)
- [ ] Create `IterativeProcessor` class
- [ ] Implement `PhaseManager` for state management
- [ ] Add type-specific prompt templates
- [ ] Create phase result interfaces

### Phase 2: Type Phase (Week 2-3)
- [ ] Implement type extraction phase
- [ ] Integrate with existing `PosterTypeValidator`
- [ ] Add type validation API calls
- [ ] Store intermediate type results

### Phase 3: Artist Phase (Week 3-4)
- [ ] Implement artist extraction with type context
- [ ] Enhance `ArtistValidator` integration
- [ ] Add artist disambiguation logic
- [ ] Create artist relationship inference

### Phase 4: Venue & Event Phases (Week 4-5)
- [ ] Implement venue extraction phase
- [ ] Add geographic validation
- [ ] Implement event/date extraction
- [ ] Add temporal validation

### Phase 5: Assembly & UI (Week 5-6)
- [ ] Implement final assembly phase
- [ ] Add API endpoints
- [ ] Update UI for phase visualization
- [ ] Add manual override capability

### Phase 6: Testing & Refinement (Week 6-7)
- [ ] End-to-end testing
- [ ] Confidence threshold tuning
- [ ] Performance optimization
- [ ] Documentation

---

## Benefits

1. **Better Accuracy**: Each phase can use context from previous phases
2. **Early Validation**: Catch errors before full processing completes
3. **Type-Aware Extraction**: Prompts tailored to poster type
4. **Incremental Refinement**: Low-confidence fields identified early
5. **Manual Intervention Points**: Pause and correct without reprocessing
6. **Better External Matching**: More targeted API queries
7. **Audit Trail**: Track confidence and validation at each phase

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Increased processing time | Batch similar types together, cache API responses |
| API rate limits | Rate limiting built into validators, queue system |
| Phase dependencies cause failures | Graceful fallback to single-pass mode |
| State management complexity | Clear phase boundaries, persistent state |

---

## Files to Modify

### New Files
- `src/image-processor/IterativeProcessor.ts`
- `src/image-processor/PhaseManager.ts`
- `src/image-processor/phases/TypePhase.ts`
- `src/image-processor/phases/ArtistPhase.ts`
- `src/image-processor/phases/VenuePhase.ts`
- `src/image-processor/phases/EventPhase.ts`
- `src/image-processor/prompts/TypePrompts.ts`
- `src/api/routes/iterative-processing.ts`

### Modified Files
- `src/api/routes/processing.ts` - Add iterative mode option
- `src/image-processor/PosterProcessor.ts` - Integrate with IterativeProcessor
- `src/qa-validation/QAValidationService.ts` - Expose validators for inline use
- `instances/posters/config/instance-config.json` - Add phase config
- `instances/posters/ui/js/processing.js` - Add phase UI
- `instances/posters/ui/index.html` - Add phase visualization
