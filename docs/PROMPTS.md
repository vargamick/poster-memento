# Poster Memento - LLM Prompts Reference

This document catalogs all LLM prompts used in the poster-memento project for vision model extraction and data validation.

## Table of Contents

1. [Vision Model Default Prompts](#1-vision-model-default-prompts)
2. [Iterative Processing Prompts](#2-iterative-processing-prompts)
   - [Type Classification Phase](#21-type-classification-phase)
   - [Artist Extraction Phase](#22-artist-extraction-phase)
   - [Venue Extraction Phase](#23-venue-extraction-phase)
   - [Event/Date Extraction Phase](#24-eventdate-extraction-phase)
3. [Review/QA Prompts](#3-reviewqa-prompts)
4. [Prompt Statistics](#4-prompt-statistics)

---

## 1. Vision Model Default Prompts

### 1.1 Cloud Vision Providers (Anthropic, OpenAI, Google)

**File:** `src/image-processor/providers/BaseCloudVisionProvider.ts:195-239`
**Context:** Used by Anthropic, OpenAI, and Google vision providers when no custom prompt is provided

```
Analyze this music/event poster image carefully.

STEP 1: Determine the POSTER TYPE - what is the primary purpose of this poster?
- concert: Advertises a concert, gig, or live music performance at a specific venue with a date
- festival: Advertises a music festival with multiple acts (3+ artists typically)
- comedy: Advertises a comedy show or standup performance
- theater: Advertises a theatrical production or play
- film: Advertises a movie or film screening
- album: Promotes an album, single, EP, or music release (NO venue/date, just artist + title)
- promo: General promotional/advertising poster
- exhibition: Art exhibition, gallery show, or museum display
- hybrid: Combines event AND release promotion (e.g., album release party with venue/date)
- unknown: Cannot determine the type

STEP 2: Extract ALL visible text from the image exactly as shown.

STEP 3: Return a JSON object with this structure:
{
  "poster_type": "concert|festival|comedy|theater|film|album|promo|exhibition|hybrid|unknown",
  "title": "event or release title",
  "headliner": "main artist/performer",
  "supporting_acts": ["list", "of", "supporting", "artists"],
  "venue": "venue name only",
  "city": "city name",
  "state": "state or country",
  "date": "formatted date string",
  "year": 2024,
  "ticket_price": "$XX or null",
  "door_time": "time or null",
  "show_time": "time or null",
  "age_restriction": "18+ or null",
  "tour_name": "tour name or null",
  "record_label": "label name or null",
  "promoter": "promoter name or null",
  "visual_elements": {
    "has_artist_photo": true/false,
    "has_album_artwork": true/false,
    "has_logo": true/false,
    "dominant_colors": ["color1", "color2"],
    "style": "photographic|illustrated|typographic|mixed|other"
  }
}

Return ONLY the JSON object, no other text.
```

---

### 1.2 Ollama Vision Provider (minicpm-v, llama-vision, llava)

**File:** `src/image-processor/providers/OllamaVisionProvider.ts:28-128`
**Context:** Used by local Ollama models when no custom prompt provided

```
Analyze this music/event poster image carefully.

STEP 1: Determine the POSTER TYPE - what is the primary purpose of this poster?
- concert: Advertises a concert, gig, or live music performance at a specific venue with a date
- festival: Advertises a music festival with multiple acts (3+ artists typically)
- comedy: Advertises a comedy show or standup performance
- theater: Advertises a theatrical production or play
- film: Advertises a movie or film screening
- album: Promotes an album, single, EP, or music release.
  IMPORTANT: If you see an artist/band name AND an album/title name together
  WITHOUT a venue or specific event date, this is likely an ALBUM poster.
  Look for text like "OUT NOW", "NEW ALBUM", "AVAILABLE", or just artist + title format.
- promo: General promotional/advertising poster (endorsements, competitions)
- exhibition: Art exhibition, gallery show, or museum display
- hybrid: Combines event AND release promotion (e.g., album release party with venue/date)
- unknown: Cannot determine the type - use this ONLY if truly ambiguous

TYPE DETECTION EXAMPLES:
- "1200 TECHNIQUES - CONSISTENCY THEORY" (no venue/date) = album (artist + album title)
- "METALLICA - ARENA TOUR 2024 - MADISON SQUARE GARDEN - MARCH 15" = concert (has venue + date)
- "GLASTONBURY FESTIVAL - COLDPLAY, FOO FIGHTERS, ARCTIC MONKEYS..." = festival (multiple artists + festival name)
- "THE GODFATHER - IN THEATERS NOW" = film
- "KENDRICK LAMAR - MR. MORALE & THE BIG STEPPERS - AVAILABLE EVERYWHERE" = release

STEP 2: Extract ALL visible text from the image exactly as shown.

STEP 3: Identify and structure the following based on poster type:

FOR CONCERT/FESTIVAL/COMEDY/THEATER POSTERS:
- Event name/title
- HEADLINER: Main artist (usually largest text)
- SUPPORTING ACTS: Other artists (usually smaller, often "with" or "and")
- Venue name (IMPORTANT: Extract venue name separately from date)
- City (extract city name separately)
- State/Country
- Date (IMPORTANT: Only the date portion - do NOT include venue in date)
- Door time, Show time
- Ticket price
- Age restriction if shown
- Promoter/Presenter

FOR RELEASE POSTERS:
- Release title (album/single name)
- Artist name
- Release date
- Record label
- Track listing if shown

FOR PROMO POSTERS:
- Product/Brand name
- Promotion type
- Call to action
- Contact info

STEP 4: Describe VISUAL ELEMENTS:
- Has artist photo? (yes/no)
- Has album artwork? (yes/no)
- Has logos? (yes/no)
- Dominant colors (list 2-3)
- Visual style: photographic, illustrated, typographic, mixed, other

STEP 5: Return findings in this format:

IMPORTANT OUTPUT RULES:
- Return ONLY the extracted value for each field, NO explanations or commentary
- If a field cannot be determined, leave it BLANK (do not write "Not specified" or "Unknown")
- Dates MUST be in DD/MM/YYYY format (e.g., 20/04/1995, not "April 20, 1995")
- If only partial date is available, use what you have (e.g., "20/04" if no year)
- Do NOT include marketing text in date field (e.g., "ONLY AT THE MOVIES" is not a date)
- Venue and Headliner must be separate - do NOT combine them

POSTER TYPE: [concert|festival|comedy|theater|film|album|promo|exhibition|hybrid|unknown]

EXTRACTED TEXT:
[All text from the poster]

STRUCTURED DATA:
Title: [event/release title]
Headliner: [main artist name only]
Supporting Acts: [comma separated list of artist names only]
Venue: [venue name only, no city or date]
City: [city name only]
State: [state/country only]
Date: [DD/MM/YYYY format only]
Year: [4-digit year as number]
Ticket Price: [price with currency]
Door Time: [time in HH:MM format]
Show Time: [time in HH:MM format]
Age Restriction: [age limit if shown]
Tour Name: [tour name if shown]
Record Label: [label name if shown]
Promoter: [promoter name if shown]

VISUAL ELEMENTS:
Has Artist Photo: [yes/no]
Has Album Artwork: [yes/no]
Has Logo: [yes/no]
Dominant Colors: [comma separated]
Style: [photographic|illustrated|typographic|mixed|other]

Be accurate. Only include information clearly visible in the image. Leave fields BLANK if not determinable.
```

---

### 1.3 vLLM Vision Provider

**File:** `src/image-processor/providers/VLLMVisionProvider.ts:29-31`
**Context:** Used for vLLM-based models (Qwen2.5-VL, Pixtral, etc.)

```
Analyze this concert/music poster image. Extract ALL visible text.
Then identify: Event title, Headliner artist, Supporting acts, Venue, City/State, Date, Year, Ticket price.
Format as JSON: {"title": "", "headliner": "", "supporting_acts": [], "venue": "", "city": "", "state": "", "date": "", "year": 0, "ticket_price": ""}
```

---

### 1.4 Transformers Vision Provider

**File:** `src/image-processor/providers/TransformersVisionProvider.ts:29`
**Context:** Used for Hugging Face Transformers models

```
Extract all text from this music poster image and identify: title, artists, venue, location, date, and ticket price.
```

---

## 2. Iterative Processing Prompts

All iterative prompts are in: `src/image-processor/iterative/prompts.ts`

### 2.1 Type Classification Phase

**Phase 1 - Initial Classification**
**Lines:** 14-69

```
Analyze this poster image and classify its type.

CLASSIFICATION RULES:
1. CONCERT: Live music performance at a specific venue on a specific date
   - Look for: venue name, date, door/show times, ticket prices
   - Example: "Band X at Club Y, March 15"

2. FESTIVAL: Multi-day/multi-artist outdoor event
   - Look for: multiple headliners listed equally, festival name, multi-day dates
   - Example: "Summer Fest 2024 - Day 1, Day 2, Day 3"

3. RELEASE: Album, single, or EP announcement
   - Look for: "New Album", "Out Now", release date, streaming platforms
   - NO venue or show time indicates release, not concert
   - Example: "New Album 'Title' - Available Now"

4. FILM: Movie poster
   - Look for: "In Theaters", movie credits, rating (PG, R, etc.)
   - Example: Credits with "Directed by", "Starring"

5. THEATER: Stage play, musical, broadway
   - Look for: Theater name, show run dates, playwright credits
   - Example: "Now Playing at Broadway Theater"

6. COMEDY: Stand-up comedy show
   - Look for: Comedian names, comedy club venues, "Live Stand-Up"
   - Example: "John Doe Live at Comedy Club"

7. PROMO: Promotional material without specific event
   - Look for: Brand promotion, no specific date/venue
   - Example: Band merchandise, tour announcement without dates

8. EXHIBITION: Art show, museum exhibit
   - Look for: Gallery/museum name, exhibit dates, artist exhibition
   - Example: "Art Exhibition at Modern Gallery"

9. HYBRID: Combines two types (e.g., album release show)
   - Look for: Both release announcement AND venue/date
   - Example: "Album Release Party at Club X"

10. UNKNOWN: Cannot determine type

Return JSON:
{
  "poster_type": "concert|festival|album|film|theater|comedy|promo|exhibition|hybrid|unknown",
  "confidence": 0.0-1.0,
  "evidence": ["reason 1", "reason 2"],
  "visual_cues": {
    "has_artist_photo": true|false,
    "has_album_artwork": true|false,
    "has_logo": true|false,
    "dominant_colors": ["color1", "color2"],
    "style": "photographic|illustrated|typographic|mixed|other"
  },
  "extracted_text": "all visible text"
}
```

**Type Refinement (Low Confidence)**
**Lines:** 71-82

```
The initial classification was uncertain. Please re-examine this poster.

Previous classification: {{previous_type}} ({{previous_confidence}}% confidence)
Detected evidence: {{previous_evidence}}

Please look more carefully at:
1. Is there a specific venue AND date? (concert/comedy/theater)
2. Is there release language like "Out Now" or streaming logos? (album)
3. Is there film credit formatting? (film)
4. Does it announce both an album AND a live show? (hybrid)

Return the same JSON format with your refined classification.
```

---

### 2.2 Artist Extraction Phase

**Phase 2** - Type-specific artist/performer extraction prompts

#### Concert Type
```
Extract artist/performer information from this CONCERT poster.

Look for:
- HEADLINER: The main act (usually largest text, top billing)
- SUPPORTING ACTS: Opening bands, special guests (smaller text, "with", "featuring")
- TOUR NAME: If this is part of a named tour
- RECORD LABEL: If visible (often at bottom)

IMPORTANT FORMATTING RULES:
- Each artist/band MUST be a SEPARATE entry in the array
- Do NOT concatenate multiple artists into a single string
- If poster shows "Artist A with Artist B and Artist C", return them as separate array entries
- Band members are part of the band name, not separate entries

CORRECT:
{
  "headliner": "Artist A",
  "supporting_acts": ["Artist B", "Artist C", "Artist D"]
}

WRONG (do NOT do this):
{
  "headliner": "Artist A Artist B Artist C",
  "supporting_acts": ["Artist B Artist C Artist D"]
}

Return JSON:
{
  "headliner": "main artist name only",
  "supporting_acts": ["support1", "support2"],
  "tour_name": "tour name if visible",
  "record_label": "label if visible"
}
```

#### Festival Type
```
Extract artist/performer information from this FESTIVAL poster.

Look for:
- HEADLINERS: Multiple main acts (often listed with equal prominence)
- LINEUP: Full list of performing artists
- Order usually indicates billing (top = biggest)

CRITICAL FORMATTING RULES:
- List EACH artist as a SEPARATE entry in the supporting_acts array
- Do NOT concatenate multiple artist names into a single string
- If the poster lists "Band1  Band2  Band3", create separate entries for each
- Festival lineups often have many artists - list each one separately

CORRECT example for a festival with 6 bands:
{
  "headliner": "Main Headliner",
  "supporting_acts": ["Band 2", "Band 3", "Band 4", "Band 5", "Band 6"],
  "festival_name": "Summer Fest"
}

Return JSON:
{
  "headliner": "top billed artist only",
  "supporting_acts": ["artist2", "artist3", "artist4", "artist5"],
  "festival_name": "name of festival"
}
```

#### Album Type
```
Extract artist and release information from this ALBUM/RELEASE poster.

Look for:
- ARTIST NAME: Who released this album/single (main artist)
- ALBUM TITLE: Name of the release (usually prominent text)
- RELEASE TYPE: album, single, EP, compilation
- RECORD LABEL: Label releasing it (often at bottom in small text)
- FEATURED ARTISTS: "feat." or "ft." credits
- STREAMING PLATFORMS: Spotify, Apple Music, etc. logos or mentions

IMPORTANT: The album title is different from the artist name!
- "Artist Name" is WHO made it
- "Album Title" is WHAT they made

Return JSON:
{
  "headliner": "main artist name",
  "album_title": "album/single/EP name",
  "release_type": "album|single|EP|compilation",
  "record_label": "label name",
  "featured_artists": ["feat. artist1", "feat. artist2"],
  "streaming_platforms": ["spotify", "apple music"]
}
```

#### Film Type
```
Extract credits and details from this FILM poster.

Look for:
- DIRECTOR: "Directed by", "A Film by", or director credit
- LEAD ACTORS: Starring credits (usually top billing, largest names)
- SUPPORTING CAST: Additional actors listed (smaller text)
- STUDIO: Production company (often at bottom)
- MPAA RATING: G, PG, PG-13, R, NC-17 (usually in a box)
- TAGLINE: The movie's catchphrase or slogan

FORMATTING RULES:
- Each actor MUST be a SEPARATE entry in the arrays
- Do NOT concatenate multiple actor names

Return JSON:
{
  "director": "director name",
  "lead_actors": ["lead actor 1", "lead actor 2"],
  "supporting_cast": ["supporting actor 1", "supporting actor 2"],
  "studio": "production company",
  "mpaa_rating": "G|PG|PG-13|R|NC-17",
  "tagline": "movie tagline if visible"
}
```

#### Theater Type
```
Extract credits from this THEATER poster.

Look for:
- PLAYWRIGHT: "Written by" or "By"
- LEAD PERFORMERS: Starring or featuring
- DIRECTOR: Stage director
- PRODUCTION: Theater company

Return JSON:
{
  "playwright": "writer name",
  "lead_performers": ["performer1", "performer2"],
  "director": "director name",
  "production_company": "theater company"
}
```

#### Comedy Type
```
Extract performer information from this COMEDY poster.

Look for:
- HEADLINER: Main comedian
- FEATURED COMICS: Opening acts, guest comedians
- HOST: If there's an MC/host

FORMATTING RULES:
- Each comedian MUST be a SEPARATE entry in the array
- Do NOT combine multiple comedians into a single string

Return JSON:
{
  "headliner": "main comedian name only",
  "supporting_acts": ["opener1", "opener2"],
  "host": "host/mc if any"
}
```

#### Promo Type
```
Extract artist/brand information from this PROMOTIONAL poster.

Look for:
- ARTIST/BAND: Who is being promoted
- PRODUCT: What's being advertised (merch, tour, album)
- BRAND: Any sponsor or brand names

Return JSON:
{
  "headliner": "main artist/brand",
  "product": "what's being promoted",
  "sponsors": ["sponsor1", "sponsor2"]
}
```

#### Exhibition Type
```
Extract artist information from this EXHIBITION poster.

Look for:
- EXHIBITING ARTIST: Whose work is being shown
- CURATOR: If listed
- GALLERY/MUSEUM: Hosting institution

Return JSON:
{
  "exhibiting_artist": "artist name",
  "curator": "curator if listed",
  "institution": "gallery/museum name"
}
```

#### Hybrid Type
```
Extract artist information from this HYBRID poster (release + concert).

Look for both:
RELEASE INFO:
- Artist, album title, label

CONCERT INFO:
- Venue, date, supporting acts

Return JSON:
{
  "headliner": "main artist",
  "album_title": "album being released",
  "supporting_acts": ["opener1"],
  "record_label": "label",
  "is_release_show": true
}
```

#### Unknown Type
```
Extract any artist/performer information from this poster.

Look for any names that appear to be:
- Musicians, bands, performers
- Directors, actors (if film-related)
- Comedians, speakers
- Artists (if exhibition)

Return JSON:
{
  "primary_name": "most prominent name",
  "other_names": ["name1", "name2"],
  "context": "brief description of how names appear"
}
```

---

### 2.3 Venue Extraction Phase

**Phase 3** - Type-specific venue/location extraction prompts

#### Concert Type
```
Extract venue information from this CONCERT poster.

Look for:
- VENUE NAME: The club, theater, arena, etc.
- CITY: City name
- STATE/REGION: State, province, or region
- ADDRESS: If visible

Common patterns:
- "at [Venue Name]"
- "[City], [State]" at bottom
- Venue logo or address

Return JSON:
{
  "venue_name": "venue name",
  "city": "city",
  "state": "state/province",
  "address": "if visible"
}
```

#### Festival Type
```
Extract location information from this FESTIVAL poster.

Look for:
- VENUE/LOCATION: Park, fairgrounds, outdoor venue
- CITY: Host city
- STATE: Host state/region

Return JSON:
{
  "venue_name": "venue/location name",
  "city": "city",
  "state": "state",
  "festival_grounds": "specific area if mentioned"
}
```

#### Album Type
```
Extract any location information from this ALBUM poster.

Note: Album posters often don't have venue info unless it's a release show.

Look for:
- RELEASE SHOW VENUE: If this is also announcing a show
- RECORD STORE: If in-store event

Return JSON:
{
  "venue_name": "venue if any",
  "city": "city if any",
  "is_streaming_only": true|false
}
```

#### Film Type
```
Extract theater/screening information from this FILM poster.

Look for:
- THEATER NAME: Specific theater
- DISTRIBUTION: "In Theaters Everywhere" or specific locations
- PREMIERE VENUE: If a premiere event

Return JSON:
{
  "theater_name": "specific theater if listed",
  "distribution": "wide release|limited|single theater",
  "city": "city if specific"
}
```

#### Theater Type
```
Extract theater venue information from this THEATER poster.

Look for:
- THEATER NAME: Broadway theater, playhouse, etc.
- CITY: Usually indicates the theater district
- ADDRESS: Theater address

Return JSON:
{
  "venue_name": "theater name",
  "city": "city",
  "theater_district": "broadway/west end/etc if applicable"
}
```

#### Comedy Type
```
Extract venue information from this COMEDY poster.

Look for:
- COMEDY CLUB: Club or venue name
- CITY: City location
- STATE: State location

Return JSON:
{
  "venue_name": "comedy club name",
  "city": "city",
  "state": "state"
}
```

#### Promo Type
```
Extract any location information from this PROMO poster.

Look for:
- STORE LOCATIONS: If retail promotion
- EVENT VENUE: If promotional event

Return JSON:
{
  "venue_name": "location if any",
  "city": "city if any",
  "is_promotional_only": true|false
}
```

#### Exhibition Type
```
Extract gallery/museum information from this EXHIBITION poster.

Look for:
- GALLERY/MUSEUM NAME: Institution hosting
- CITY: Location city
- ADDRESS: Gallery address

Return JSON:
{
  "venue_name": "gallery/museum name",
  "city": "city",
  "address": "address if visible"
}
```

#### Hybrid Type
```
Extract venue information from this HYBRID poster.

Look for both release and event venue info:
- VENUE: Where the release show is happening
- CITY/STATE: Location

Return JSON:
{
  "venue_name": "venue name",
  "city": "city",
  "state": "state"
}
```

#### Unknown Type
```
Extract any location/venue information from this poster.

Look for:
- Any venue, location, or place names
- City and state/country
- Addresses

Return JSON:
{
  "venue_name": "location if any",
  "city": "city if any",
  "state": "state if any"
}
```

---

### 2.4 Event/Date Extraction Phase

**Phase 4** - Type-specific temporal/event information extraction

#### Concert Type
```
Extract event details from this CONCERT poster.

IMPORTANT OUTPUT RULES:
- Dates MUST be in DD/MM/YYYY format (e.g., 15/03/2024)
- If year unknown, use DD/MM only (e.g., 15/03)
- Leave fields empty if not visible - do NOT write "not specified" or similar
- Times should be in HH:MM format (e.g., 19:00, 20:30)

Look for:
- DATE: Event date (convert to DD/MM/YYYY)
- YEAR: 4-digit year
- DOOR TIME: When doors open
- SHOW TIME: When show starts
- TICKET PRICE: Cost with currency
- AGE RESTRICTION: ("21+", "All Ages", "18+")
- PROMOTER: Presenting company

Return JSON:
{
  "event_date": "DD/MM/YYYY",
  "year": 2024,
  "door_time": "19:00",
  "show_time": "20:00",
  "ticket_price": "$20",
  "age_restriction": "21+",
  "promoter": "promoter name"
}
```

#### Festival Type
```
Extract event details from this FESTIVAL poster.

Look for:
- DATES: Festival dates (often multi-day)
- YEAR: Festival year
- TIMES: Gate times
- TICKET INFO: Pricing tiers

Return JSON:
{
  "start_date": "first day",
  "end_date": "last day",
  "year": 2024,
  "gate_time": "gates open time",
  "ticket_price": "price or tier info"
}
```

#### Album Type
```
Extract release details from this ALBUM poster.

Look for:
- RELEASE DATE: Album/single release date
- YEAR: Release year
- PRE-ORDER DATE: If different from release
- STREAMING PLATFORMS: Where available

Return JSON:
{
  "release_date": "release date",
  "year": 2024,
  "pre_order_date": "if different",
  "platforms": ["spotify", "apple music"]
}
```

#### Film Type
```
Extract release details from this FILM poster.

Look for:
- RELEASE DATE: Theatrical release
- YEAR: Release year
- RATING: MPAA rating (G, PG, PG-13, R, NC-17)
- RUNTIME: If shown

Return JSON:
{
  "release_date": "release date",
  "year": 2024,
  "rating": "R",
  "runtime": "2h 15m"
}
```

#### Theater Type
```
Extract show details from this THEATER poster.

Look for:
- RUN DATES: "Now through May 15" or specific dates
- SHOWTIMES: Performance times
- TICKET PRICES: Price ranges
- PREVIEWS: Preview dates if applicable

Return JSON:
{
  "opening_date": "opens date",
  "closing_date": "closes date",
  "showtimes": ["8pm Tue-Sat", "2pm Sun"],
  "ticket_prices": "$50-$150"
}
```

#### Comedy Type
```
Extract show details from this COMEDY poster.

Look for:
- DATE: Show date
- SHOWTIMES: Multiple shows ("7pm & 9:30pm")
- TICKET PRICE: Cost
- AGE RESTRICTION: Usually 18+ or 21+

Return JSON:
{
  "event_date": "show date",
  "year": 2024,
  "showtimes": ["7:00 PM", "9:30 PM"],
  "ticket_price": "$25",
  "age_restriction": "21+"
}
```

#### Promo Type
```
Extract any date information from this PROMO poster.

Look for:
- PROMOTION DATES: "Sale ends March 1"
- TOUR DATES: If tour announcement

Return JSON:
{
  "start_date": "promo start if shown",
  "end_date": "promo end if shown",
  "year": 2024
}
```

#### Exhibition Type
```
Extract exhibition details from this EXHIBITION poster.

Look for:
- EXHIBITION DATES: Run dates
- OPENING RECEPTION: Special opening event
- GALLERY HOURS: Operating hours

Return JSON:
{
  "opening_date": "exhibition opens",
  "closing_date": "exhibition closes",
  "reception_date": "opening reception if any",
  "hours": "gallery hours"
}
```

#### Hybrid Type
```
Extract event details from this HYBRID poster.

Look for both:
RELEASE DATE: Album release date
SHOW DATE: Release show date and time

Return JSON:
{
  "release_date": "album release date",
  "event_date": "release show date",
  "year": 2024,
  "door_time": "doors",
  "show_time": "show start",
  "ticket_price": "price"
}
```

#### Unknown Type
```
Extract any date/event information from this poster.

Look for:
- Any dates in any format
- Times
- Prices
- Age restrictions

Return JSON:
{
  "event_date": "date if any",
  "year": "year if any",
  "time": "time if any",
  "price": "price if any"
}
```

---

## 3. Review/QA Prompts

### LLM Self-Review Prompt

**File:** `src/image-processor/ReviewPhase.ts:64-109`
**Context:** Post-extraction QA - LLM reviews its own work against the original image

```
You are a QA reviewer for poster metadata extraction. Review the following extracted data against the poster image.

EXTRACTED DATA:
{{extractedData}}

YOUR TASK:
1. Compare each field against what you see in the image
2. Identify any OBVIOUS ERRORS such as:
   - Date/venue information labeled as artist name
   - Artist name that is actually a date (e.g., "Sunday 27 January")
   - Venue that contains explanatory text instead of an actual venue name
   - Fields that are clearly swapped (venue in artist field, etc.)
   - Film actors incorrectly labeled as musicians
   - Verbose explanations instead of actual values

3. For each error found, provide a correction

RESPONSE FORMAT (JSON):
{
  "passed": true|false,
  "overallConfidence": 0.0-1.0,
  "reasoning": "Brief explanation of your assessment",
  "corrections": [
    {
      "field": "field_name",
      "originalValue": "what was extracted",
      "correctedValue": "what it should be (or null if should be empty)",
      "reason": "why this is wrong",
      "confidence": 0.0-1.0
    }
  ],
  "flaggedForReview": ["field1", "field2"]
}

IMPORTANT RULES:
- If a field should be EMPTY (no valid data), set correctedValue to null
- Only flag real errors, not minor formatting issues
- "passed" should be true if no corrections needed or all corrections are minor
- "passed" should be false if there are major errors that change the meaning

Examples of what to catch:
- headliner: "Sunday 27 January Prince of Wales" → This is a DATE + VENUE, not an artist. Correct to null.
- venue: "Not applicable as it's an album poster" → This is an explanation, not a venue. Correct to null.
- headliner: "Robert De Niro (actor's name prominently displayed)" → Strip the parenthetical, just "Robert De Niro"

Return ONLY the JSON response, no additional text.
```

---

## 4. Prompt Statistics

| Category | Count | Notes |
|----------|-------|-------|
| Vision Provider Defaults | 4 | Ollama, Cloud, vLLM, Transformers |
| Type Classification | 2 | Initial + Refinement |
| Artist Extraction | 10 | One per poster type |
| Venue Extraction | 10 | One per poster type |
| Event/Date Extraction | 10 | One per poster type |
| Review/QA | 1 | LLM self-review |
| **Total** | **37** | |

### Key Design Patterns

1. **JSON Output Standardization** - All prompts request structured JSON responses
2. **Type-Specific Instructions** - 10 poster types with tailored extraction logic
3. **Date Format Enforcement** - DD/MM/YYYY required throughout
4. **Anti-Concatenation Rules** - Explicit instructions to keep artists separate
5. **Error Prevention** - Examples of what NOT to do included in prompts
6. **Visual Element Classification** - Consistent schema for visual analysis
7. **Confidence Scoring** - Numeric confidence returned for QA gating

### Helper Functions

Located in `src/image-processor/iterative/prompts.ts:644-691`:

- `getPhasePrompt(phase, posterType)` - Returns prompt for phase/type combination
- `getRefinementPrompt(...)` - Generates refinement prompt with context
- `getCombinedExtractionPrompt(posterType)` - Merges artist/venue/event prompts
