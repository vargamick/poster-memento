# Data Quality Improvement Plan

## Executive Summary

Analysis of processed poster data reveals systematic issues with field validation, date formatting, and field classification. This document outlines the problems and proposed solutions.

---

## Identified Issues

### 1. Date Format Inconsistency

**Problem:** Dates appear in various formats instead of consistent EN-AU (DD/MM/YYYY).

| Example | Current Value | Expected |
|---------|---------------|----------|
| PRIMOGENESIS | `31/03-95 (released on March 31, 1995)` | `31/03/1995` |
| AMERICAN GANGSTER | `ONLY AT THE MOVIES JANUARY 10` | `10/01/YYYY` or `null` |

**Root Cause:** Vision model output is not being normalized before storage.

---

### 2. Commentary Text in Data Fields

**Problem:** Descriptive/explanatory text is being stored in data fields instead of actual values.

| Field | Current Value | Should Be |
|-------|---------------|-----------|
| Venue | `Not specified in the text provided.` | `null` or empty string |
| Date | `6453` with explanation text | `null` |

**Root Cause:** Vision model includes uncertainty commentary in responses, and these aren't being filtered out.

**Solution:**
- Create a separate `commentary` or `extraction_notes` field on the poster entity
- Store vision model uncertainty/notes there
- Data fields should contain only valid data or `null`

---

### 3. Field Misclassification

**Problem:** Data is being placed in wrong columns.

| Example | Field | Current Value | Correct Field |
|---------|-------|---------------|---------------|
| Alice Cooper | People | `Paul Rodgers Had Company, Rod Laver Arena` | Split: Promoter → `Paul Rodgers Had Company`, Venue → `Rod Laver Arena` |

**Root Cause:** Vision model is concatenating multiple extracted values into single fields.

---

### 4. Invalid/Garbage Data

**Problem:** Non-parseable values stored in typed fields.

| Field | Value | Issue |
|-------|-------|-------|
| Date | `6453` | Not a valid date format |
| Date | Marketing text | Not a date |

**Root Cause:** No validation layer between vision model output and database storage.

---

## Proposed Solutions

### Phase 1: Schema Changes

#### 1.1 Add Commentary Field

Add `extraction_notes` field to poster entity schema:

```typescript
interface PosterEntity {
  // ... existing fields
  extraction_notes?: string;  // Store vision model commentary here
}
```

#### 1.2 Define Default Values

| Field | Default When Unavailable |
|-------|-------------------------|
| date | `null` |
| venue | `null` |
| people | `[]` (empty array) |
| promoter | `null` |

---

### Phase 2: Output Parsing Improvements

#### 2.1 Date Normalization

Location: `src/image-processor/providers/OllamaVisionProvider.ts`

```typescript
function normalizeDate(rawDate: string): string | null {
  // 1. Strip commentary text (anything in parentheses, explanatory phrases)
  // 2. Attempt to parse various formats
  // 3. Convert to EN-AU format (DD/MM/YYYY)
  // 4. Return null if unparseable
}
```

Supported input formats to handle:
- `31/03-95` → `31/03/1995`
- `March 31, 1995` → `31/03/1995`
- `JANUARY 10` → `10/01/YYYY` (year from context or null)
- `6453` → `null` (invalid)

#### 2.2 Commentary Extraction

Detect and separate commentary phrases:
- "Not specified in the text provided"
- "Not specified in the image"
- Parenthetical explanations: `(released on...)`
- Uncertainty markers: "could be", "might be", "unclear"

#### 2.3 Field Validation

Add validation rules per field type:

| Field | Validation Rule |
|-------|-----------------|
| date | Must match date pattern or be null |
| venue | Must not contain "not specified" phrases |
| people | Array of names, no venue/promoter data |

---

### Phase 3: Prompt Engineering

#### 3.1 Update Vision Model Prompts

Modify prompts to request structured output:

```
IMPORTANT:
- Return ONLY the extracted value, no explanations
- If a field cannot be determined, return exactly: NULL
- Dates must be in DD/MM/YYYY format
- Do not include commentary in field values
```

#### 3.2 Add Field-Specific Instructions

```
VENUE: The physical location name only (e.g., "Rod Laver Arena")
PROMOTER: The presenting company only (e.g., "Paul Rodgers Had Company")
PEOPLE: Only artist/performer names, not venues or promoters
```

---

### Phase 4: Post-Processing Pipeline

#### 4.1 Validation Layer

Add validation step after vision model response, before database write:

```
Vision Model → Parser → Validator → Normalizer → Database
                           ↓
                    extraction_notes
```

#### 4.2 Locale Configuration

Add to instance config:

```json
{
  "locale": {
    "dateFormat": "DD/MM/YYYY",
    "region": "EN-AU"
  }
}
```

---

## Implementation Priority

| Priority | Task | Effort | Impact |
|----------|------|--------|--------|
| 1 | Add `extraction_notes` field | Low | High |
| 2 | Date normalization function | Medium | High |
| 3 | Filter commentary from data fields | Medium | High |
| 4 | Update vision prompts | Low | Medium |
| 5 | Add validation layer | High | High |
| 6 | Field misclassification detection | High | Medium |

---

## Current Entity Creation Behavior

**Artist entities ARE being created** - see [sessions.ts:383-501](src/api/routes/sessions.ts#L383-L501)

The `createPosterRelationships` function creates:
- `Artist` entities for headliner → `HEADLINED_ON` relationship
- `Artist` entities for supporting acts → `PERFORMED_ON` relationship
- `Venue` entities → `ADVERTISES_VENUE` relationship
- `HAS_TYPE` relationships to PosterType entities

**The problem:** When vision model extracts incorrect data (e.g., "Paul Rodgers Had Company, Rod Laver Arena" as headliner), this creates **garbage artist entities**:
- `artist_paul_rodgers_had_company__rod_laver_arena`

This pollutes the knowledge graph with invalid entities that need cleanup.

---

## Additional Phase: Data Cleanup

### 5.1 Identify Invalid Entities

Query for entities that are likely misclassified:
- Artist names containing venue keywords ("Arena", "Theatre", "Hall")
- Artist names containing promoter patterns ("Presents", "Productions")
- Artist names with unusual length (too long = concatenated fields)

### 5.2 Entity Merge/Delete Tool

Add UI capability to:
- Flag entities for review
- Merge duplicate entities
- Delete invalid entities
- Reassign relationships when merging

---

## Files to Modify

1. **Schema/Entity Definition**
   - `src/core/types/entities.ts` - Add extraction_notes field

2. **Vision Provider**
   - `src/image-processor/providers/OllamaVisionProvider.ts` - Output parsing
   - `src/image-processor/prompts/` - Prompt templates

3. **Instance Config**
   - `instances/posters/config/instance-config.json` - Locale settings

4. **Processing Pipeline**
   - `src/image-processor/PosterProcessor.ts` - Validation layer

---

## Success Criteria

- [ ] All dates in DD/MM/YYYY format or null
- [ ] No commentary text in data fields
- [ ] People field contains only performer names
- [ ] Venue field contains only location names
- [ ] Unavailable fields show as empty/null, not explanatory text
- [ ] Vision model notes preserved in extraction_notes field
