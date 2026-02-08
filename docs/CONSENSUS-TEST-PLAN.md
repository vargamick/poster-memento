# Consensus Processing Test Plan

## Objective

Reset the database, process 10 carefully selected poster images using local LLMs in consensus mode (minicpm-v + llava:13b), and evaluate whether consensus improves extraction accuracy over the single-model issues documented in `examples/`.

---

## Pre-Test: Database Reset

### Step 1: Preview current state

```bash
curl http://localhost:3030/api/v1/admin/reset/preview \
  -H "Accept: application/json"
```

### Step 2: Reset database

```bash
curl -X POST http://localhost:3030/api/v1/admin/reset \
  -H "x-admin-confirm: RESET" \
  -H "Content-Type: application/json"
```

This will:
- Back up current data automatically
- Clear Neo4j and PostgreSQL
- Re-seed PosterType entities (concert, festival, comedy, theater, film, album, promo, exhibition, unknown)

### Step 3: Verify clean state

```bash
curl http://localhost:3030/api/v1/admin/stats
```

Expected: 0 Poster entities, 0 Artist entities, PosterType entities seeded.

---

## Test Image Selection (10 images)

Select images that cover the **known failure patterns** from the initial analysis, plus the known-good baseline. These images should be uploaded to a session via the UI.

### Selection Criteria

| # | Filename | Expected Type | Tests |
|---|----------|--------------|-------|
| 1 | A comedy poster (e.g. `arjbarker2.JPG` or `adamhills.JPG`) | comedy | Baseline — comedy works well |
| 2 | A clear single-headliner gig (e.g. `nodoubt*.JPG` or similar to `gig.png` example) | concert | Album name vs band name, venue/date separation |
| 3 | A gig with support acts listed (e.g. `silverchair*.JPG` or similar) | concert | Headliner vs support act ordering |
| 4 | A poster with stylized text (e.g. `tool2.JPG` or `primus.JPG`) | concert | OCR of difficult fonts |
| 5 | A festival poster with dense lineup (e.g. `beastieboys5.JPG` or a Big Day Out) | festival | Dense multi-artist extraction |
| 6 | A theater/play poster (e.g. `39steps.JPG`) | theater | Multi-venue/date, playwright extraction |
| 7 | An album/release poster (e.g. `powderfingerlost.JPG` or `newpowersoul.JPG`) | album | Type classification, no venue expected |
| 8 | A film poster (e.g. `thecorruptor.JPG` or `2046.JPG`) | film | Director/cast extraction |
| 9 | A poster with prominent date/venue (e.g. `interpol.JPG` or `pearljam5.JPG`) | concert | Venue/date field separation |
| 10 | An ambiguous or hybrid poster (e.g. `50cent.JPG` or `endoffashion.JPG`) | hybrid/unknown | Type classification confidence |

> **Note:** Adjust filenames based on what's actually in `SourceImages/`. The goal is type diversity and coverage of the known failure patterns.

---

## Processing Configuration

### Consensus Settings (default in ConsensusProcessor)

| Setting | Value | Notes |
|---------|-------|-------|
| Models | `minicpm-v`, `llava:13b` | Two local Ollama models |
| Min Agreement Ratio | 0.5 | Majority required |
| Min Vote Confidence | 0.3 | Threshold for counting a vote |
| Parallel | true | Run both models simultaneously |
| Strict Majority Fields | `poster_type` | Type must have consensus |
| Model Timeout | 120s | Per model per image |

### Processing Mode

The current UI session processing (`POST /api/v1/sessions/:id/process`) uses **single-model mode** via `PosterProcessor`. To use consensus, either:

**Option A: Use the UI** with `enableReview: true` to at least get the LLM self-review layer on top of single-model extraction.

**Option B: Use the iterative batch API** which supports the full 7-phase pipeline:
```bash
curl -X POST http://localhost:3030/api/v1/iterative/batch/start \
  -H "Content-Type: application/json" \
  -H "X-API-Key: posters-api-key-2024" \
  -d '{
    "imagePaths": [
      "/app/source-images/image1.JPG",
      "/app/source-images/image2.JPG"
    ],
    "options": {
      "validateArtists": true,
      "validateVenues": true,
      "validateEvents": true,
      "confidenceThreshold": 0.5
    }
  }'
```

**Option C: Use the ConsensusProcessor directly** via a test script that processes each image through both models and stores the merged result.

> **Important:** Confirm which processing path will be used before starting. The session-based UI path (`sessions.ts`) includes `cleanPosterData` + `enrichPosterEntity` (artist splitting, venue/date separation) but does NOT use consensus. The iterative path uses phased extraction but consensus integration may need to be verified.

---

## Post-Consensus Evaluation Checklist

After processing all 10 images, review each result in the browse UI and check the following fields against the actual poster image.

### Per-Image Checklist

For each processed poster, record results in this table:

| Field | Check | Pass/Fail | Notes |
|-------|-------|-----------|-------|
| **poster_type** | Correct classification? | | |
| **headliner** | Is this actually the main act (largest text)? | | |
| **headliner** | Not the support act, venue, date, or album name? | | |
| **supporting_acts** | Are these actual band/performer names? | | |
| **supporting_acts** | No album names mixed in? (e.g. "Bitter and Twisted") | | |
| **supporting_acts** | Each artist is a separate entry (not concatenated)? | | |
| **venue_name** | Contains ONLY the venue name? | | |
| **venue_name** | No day names? (Monday, Thursday, etc.) | | |
| **venue_name** | No dates? (19 October, 27 January, etc.) | | |
| **venue_name** | No times? (8pm, doors 7pm, etc.) | | |
| **event_date** | Is this the poster's event date, not the processing date? | | |
| **event_date** | Valid format? (not "826/2009" or similar corruption) | | |
| **year** | Matches the poster's year, not current year? | | |
| **title** | Meaningful title? (not raw concatenated text) | | |
| **tour_name** | Captured if present on poster? | | |

### Known Failure Pattern Recheck

These are the specific patterns that failed in the initial single-model run. Mark whether consensus resolved them:

#### Pattern 1: Headliner/Support Act Swap
- **Test case:** Poster with "X presents special guests Y" or "X with Y"
- **Expected:** X = headliner, Y = supporting_acts
- **Previously failed:** Silverchair poster had Magic Dirt as headliner
- [ ] **RESOLVED by consensus?**
- Notes: ___

#### Pattern 2: Album Name in Supporting Acts
- **Test case:** Poster where a support act has "NEW ALBUM OUT NOW" next to their name
- **Expected:** Only band name in supporting_acts, not album title
- **Previously failed:** No Doubt poster had "AREA-7 BITTER AND TWISTED"
- [ ] **RESOLVED by consensus?**
- Notes: ___

#### Pattern 3: Date Text in Venue Field
- **Test case:** Poster with "DAY DD MONTH VENUE NAME" layout
- **Expected:** venue_name contains only the venue
- **Previously failed:** No Doubt poster had "THURSDAY 19 OCTOBER FESTIVAL HALL"
- [ ] **RESOLVED by consensus?**
- **Also check:** Does the `splitVenueDate()` function in sessions.ts catch this during enrichment?
- Notes: ___

#### Pattern 4: Missing Venue Entirely
- **Test case:** Poster with clearly printed venue name
- **Expected:** venue_name populated
- **Previously failed:** UNKLE (Prince of Wales), Silverchair (missing venue)
- [ ] **RESOLVED by consensus?**
- Notes: ___

#### Pattern 5: Corrupted or Processing Date
- **Test case:** Any poster with a clear date
- **Expected:** event_date matches poster, not today's date
- **Previously failed:** UNKLE showed 24/02/08, No Doubt showed 826/2009
- [ ] **RESOLVED by consensus?**
- Notes: ___

#### Pattern 6: Dense Festival Lineup
- **Test case:** Festival poster with 10+ artists in small text
- **Expected:** Most artists captured in supporting_acts
- **Previously failed:** Big Day Out — most lineup missed
- [ ] **RESOLVED by consensus?**
- **Expected consensus benefit:** Union merge should combine artists found by different models
- Notes: ___

#### Pattern 7: Multi-Venue Theater/Touring Shows
- **Test case:** Theater poster listing multiple cities/venues
- **Expected:** At least primary venue captured, ideally all venues noted
- **Previously failed:** Popcorn — zero venues captured from three listed
- [ ] **RESOLVED by consensus?**
- Notes: ___

#### Pattern 8: Title Quality
- **Test case:** Any poster
- **Expected:** Concise, meaningful title (not full extracted text dump)
- **Previously failed:** Silverchair title was entire poster text concatenated
- [ ] **RESOLVED by consensus?**
- Notes: ___

---

## Consensus-Specific Metrics to Capture

After the run, examine the processing logs or results for these consensus health indicators:

| Metric | What to Look For |
|--------|-----------------|
| **Agreement Score** | Are the two models agreeing (>0.7) or conflicting (<0.5)? |
| **poster_type consensus** | Did both models agree on type? (strict majority field) |
| **Conflict fields** | Which fields had conflicts? Were conflicts resolved well? |
| **Union merge benefit** | Did supporting_acts get more artists from union than either model alone? |
| **Confidence-weighted wins** | For conflicting venue/date, did the higher-confidence model win correctly? |
| **Processing time** | Total time for 10 images with 2 models. Is it practical? |

---

## Decision Matrix: Next Steps After Consensus Run

| Outcome | Action |
|---------|--------|
| Consensus resolves most patterns (6+/8) | Ship consensus as default, minor prompt tweaks only |
| Consensus resolves some (3-5/8) | Implement prompt improvements for remaining patterns, re-test |
| Consensus resolves few (<3/8) | Implement prompt + code fixes before next run (see recommendations below) |
| Dense festival text still fails | Consider cloud model fallback for festival type specifically |
| Processing time >10 min for 10 images | Consider sequential mode or reducing to one model + review |

---

## Recommended Prompt/Code Fixes (apply if consensus doesn't resolve)

These are ready to implement after evaluating results. Prioritized by impact:

### HIGH Priority

1. **Headliner identification rules** — Add to concert/festival artist prompt:
   - "Largest text = headliner"
   - "'presents', 'with', 'special guests' prefix the support act"

2. **Album name vs band name distinction** — Add to concert artist prompt:
   - "Text near 'NEW ALBUM', 'OUT NOW' = album title, not a band"
   - Post-extraction filter in `enrichPosterEntity()`

3. **Venue sanitization strengthening** — Enhance `splitVenueDate()`:
   - Strip day names (Monday-Sunday) from venue field
   - Strip month-day patterns more aggressively

4. **Date validation** — Add to `parseStructuredResponse()`:
   - Reject dates matching today's date (processing date leak)
   - Reject dates with >2 digit day component (e.g. "826")

### MEDIUM Priority

5. **Title generation** — Build meaningful title from headliner + venue/tour instead of raw text
6. **Multi-venue theater support** — Update theater prompts to request array of venues
7. **Review phase expansion** — Add album-in-acts and date-in-venue checks to review prompt

### LOW Priority

8. **Cloud model fallback for festivals** — Use Anthropic/OpenAI when festival type detected and OCR coverage is low
