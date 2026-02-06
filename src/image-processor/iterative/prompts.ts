/**
 * Type-Specific Prompts for Iterative Processing
 *
 * Provides optimized prompts for each phase of processing,
 * tailored to the detected poster type.
 */

import { PosterType } from './types.js';

// ============================================================================
// Phase 1: Type Classification Prompts
// ============================================================================

export const TYPE_CLASSIFICATION_PROMPT = `Analyze this poster image and classify its type.

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
}`;

export const TYPE_REFINEMENT_PROMPT = `The initial classification was uncertain. Please re-examine this poster.

Previous classification: {{previous_type}} ({{previous_confidence}}% confidence)
Detected evidence: {{previous_evidence}}

Please look more carefully at:
1. Is there a specific venue AND date? (concert/comedy/theater)
2. Is there release language like "Out Now" or streaming logos? (album)
3. Is there film credit formatting? (film)
4. Does it announce both an album AND a live show? (hybrid)

Return the same JSON format with your refined classification.`;

// ============================================================================
// Phase 2: Artist Extraction Prompts (by type)
// ============================================================================

export const ARTIST_PROMPTS: Record<PosterType, string> = {
  concert: `Extract artist/performer information from this CONCERT poster.

Look for:
- HEADLINER: The main act (usually largest text, top billing)
- SUPPORTING ACTS: Opening bands, special guests (smaller text, "with", "featuring")
- TOUR NAME: If this is part of a named tour
- RECORD LABEL: If visible (often at bottom)

Return JSON:
{
  "headliner": "main artist name",
  "supporting_acts": ["support1", "support2"],
  "tour_name": "tour name if visible",
  "record_label": "label if visible"
}`,

  festival: `Extract artist/performer information from this FESTIVAL poster.

Look for:
- HEADLINERS: Multiple main acts (often listed with equal prominence)
- LINEUP: Full list of performing artists
- Order usually indicates billing (top = biggest)

Return JSON:
{
  "headliner": "top billed artist",
  "supporting_acts": ["artist2", "artist3", "..."],
  "festival_name": "name of festival"
}`,

  album: `Extract artist information from this RELEASE/ALBUM poster.

Look for:
- ARTIST NAME: Who released this album/single
- ALBUM TITLE: Name of the release
- RECORD LABEL: Label releasing it
- FEATURED ARTISTS: "feat." or "ft." credits

Return JSON:
{
  "headliner": "main artist",
  "album_title": "album/single name",
  "record_label": "label name",
  "featured_artists": ["feat. artist1", "feat. artist2"]
}`,

  film: `Extract credits from this FILM poster.

Look for:
- DIRECTOR: "Directed by" or "A Film by"
- LEAD ACTORS: Starring credits (usually top billing)
- SUPPORTING CAST: Additional actors listed
- STUDIO: Production company

Return JSON:
{
  "director": "director name",
  "lead_actors": ["actor1", "actor2"],
  "supporting_cast": ["actor3", "actor4"],
  "studio": "production company"
}`,

  theater: `Extract credits from this THEATER poster.

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
}`,

  comedy: `Extract performer information from this COMEDY poster.

Look for:
- HEADLINER: Main comedian
- FEATURED COMICS: Opening acts, guest comedians
- HOST: If there's an MC/host

Return JSON:
{
  "headliner": "main comedian",
  "supporting_acts": ["opener1", "opener2"],
  "host": "host/mc if any"
}`,

  promo: `Extract artist/brand information from this PROMOTIONAL poster.

Look for:
- ARTIST/BAND: Who is being promoted
- PRODUCT: What's being advertised (merch, tour, album)
- BRAND: Any sponsor or brand names

Return JSON:
{
  "headliner": "main artist/brand",
  "product": "what's being promoted",
  "sponsors": ["sponsor1", "sponsor2"]
}`,

  exhibition: `Extract artist information from this EXHIBITION poster.

Look for:
- EXHIBITING ARTIST: Whose work is being shown
- CURATOR: If listed
- GALLERY/MUSEUM: Hosting institution

Return JSON:
{
  "exhibiting_artist": "artist name",
  "curator": "curator if listed",
  "institution": "gallery/museum name"
}`,

  hybrid: `Extract artist information from this HYBRID poster (release + concert).

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
}`,

  unknown: `Extract any artist/performer information from this poster.

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
}`,
};

// ============================================================================
// Phase 3: Venue Extraction Prompts (by type)
// ============================================================================

export const VENUE_PROMPTS: Record<PosterType, string> = {
  concert: `Extract venue information from this CONCERT poster.

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
}`,

  festival: `Extract location information from this FESTIVAL poster.

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
}`,

  album: `Extract any location information from this ALBUM poster.

Note: Album posters often don't have venue info unless it's a release show.

Look for:
- RELEASE SHOW VENUE: If this is also announcing a show
- RECORD STORE: If in-store event

Return JSON:
{
  "venue_name": "venue if any",
  "city": "city if any",
  "is_streaming_only": true|false
}`,

  film: `Extract theater/screening information from this FILM poster.

Look for:
- THEATER NAME: Specific theater
- DISTRIBUTION: "In Theaters Everywhere" or specific locations
- PREMIERE VENUE: If a premiere event

Return JSON:
{
  "theater_name": "specific theater if listed",
  "distribution": "wide release|limited|single theater",
  "city": "city if specific"
}`,

  theater: `Extract theater venue information from this THEATER poster.

Look for:
- THEATER NAME: Broadway theater, playhouse, etc.
- CITY: Usually indicates the theater district
- ADDRESS: Theater address

Return JSON:
{
  "venue_name": "theater name",
  "city": "city",
  "theater_district": "broadway/west end/etc if applicable"
}`,

  comedy: `Extract venue information from this COMEDY poster.

Look for:
- COMEDY CLUB: Club or venue name
- CITY: City location
- STATE: State location

Return JSON:
{
  "venue_name": "comedy club name",
  "city": "city",
  "state": "state"
}`,

  promo: `Extract any location information from this PROMO poster.

Look for:
- STORE LOCATIONS: If retail promotion
- EVENT VENUE: If promotional event

Return JSON:
{
  "venue_name": "location if any",
  "city": "city if any",
  "is_promotional_only": true|false
}`,

  exhibition: `Extract gallery/museum information from this EXHIBITION poster.

Look for:
- GALLERY/MUSEUM NAME: Institution hosting
- CITY: Location city
- ADDRESS: Gallery address

Return JSON:
{
  "venue_name": "gallery/museum name",
  "city": "city",
  "address": "address if visible"
}`,

  hybrid: `Extract venue information from this HYBRID poster.

Look for both release and event venue info:
- VENUE: Where the release show is happening
- CITY/STATE: Location

Return JSON:
{
  "venue_name": "venue name",
  "city": "city",
  "state": "state"
}`,

  unknown: `Extract any location/venue information from this poster.

Look for:
- Any venue, location, or place names
- City and state/country
- Addresses

Return JSON:
{
  "venue_name": "location if any",
  "city": "city if any",
  "state": "state if any"
}`,
};

// ============================================================================
// Phase 4: Event/Date Extraction Prompts (by type)
// ============================================================================

export const EVENT_PROMPTS: Record<PosterType, string> = {
  concert: `Extract event details from this CONCERT poster.

Look for:
- DATE: Event date (various formats: "March 15", "3/15/24", "15.03.2024")
- YEAR: If not in date
- DOOR TIME: When doors open ("Doors at 7pm", "7pm doors")
- SHOW TIME: When show starts ("Show at 8pm", "8pm")
- TICKET PRICE: Cost ("$20", "$20 adv / $25 dos")
- AGE RESTRICTION: ("21+", "All Ages", "18+")
- PROMOTER: Presenting company

Return JSON:
{
  "event_date": "date as written",
  "year": 2024,
  "door_time": "7:00 PM",
  "show_time": "8:00 PM",
  "ticket_price": "$20",
  "age_restriction": "21+",
  "promoter": "promoter name"
}`,

  festival: `Extract event details from this FESTIVAL poster.

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
}`,

  album: `Extract release details from this ALBUM poster.

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
}`,

  film: `Extract release details from this FILM poster.

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
}`,

  theater: `Extract show details from this THEATER poster.

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
}`,

  comedy: `Extract show details from this COMEDY poster.

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
}`,

  promo: `Extract any date information from this PROMO poster.

Look for:
- PROMOTION DATES: "Sale ends March 1"
- TOUR DATES: If tour announcement

Return JSON:
{
  "start_date": "promo start if shown",
  "end_date": "promo end if shown",
  "year": 2024
}`,

  exhibition: `Extract exhibition details from this EXHIBITION poster.

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
}`,

  hybrid: `Extract event details from this HYBRID poster.

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
}`,

  unknown: `Extract any date/event information from this poster.

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
}`,
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get the appropriate prompt for a phase and poster type
 */
export function getPhasePrompt(
  phase: 'type' | 'artist' | 'venue' | 'event',
  posterType?: PosterType
): string {
  switch (phase) {
    case 'type':
      return TYPE_CLASSIFICATION_PROMPT;
    case 'artist':
      return ARTIST_PROMPTS[posterType ?? 'unknown'];
    case 'venue':
      return VENUE_PROMPTS[posterType ?? 'unknown'];
    case 'event':
      return EVENT_PROMPTS[posterType ?? 'unknown'];
    default:
      throw new Error(`Unknown phase: ${phase}`);
  }
}

/**
 * Get refinement prompt with context from previous attempt
 */
export function getRefinementPrompt(
  previousType: PosterType,
  previousConfidence: number,
  previousEvidence: string[]
): string {
  return TYPE_REFINEMENT_PROMPT
    .replace('{{previous_type}}', previousType)
    .replace('{{previous_confidence}}', String(Math.round(previousConfidence * 100)))
    .replace('{{previous_evidence}}', previousEvidence.join(', '));
}

/**
 * Combine multiple prompts for comprehensive extraction
 */
export function getCombinedExtractionPrompt(posterType: PosterType): string {
  return `${ARTIST_PROMPTS[posterType]}

---

${VENUE_PROMPTS[posterType]}

---

${EVENT_PROMPTS[posterType]}

Combine all extracted information into a single JSON response with sections for "artist", "venue", and "event".`;
}
