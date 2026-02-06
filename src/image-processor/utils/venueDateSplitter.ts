/**
 * Venue/Date Splitter Utility
 *
 * Detects and separates venue and date information when they've been
 * incorrectly combined in a single field.
 *
 * Examples:
 * - "In Cinemas August 7th" → venue: "In Cinemas", date: "07/08"
 * - "Madison Square Garden March 15" → venue: "Madison Square Garden", date: "15/03"
 * - "Rod Laver Arena 23/04/2024" → venue: "Rod Laver Arena", date: "23/04/2024"
 */

// ============================================================================
// Types
// ============================================================================

export interface VenueDateSplitResult {
  /** Original input text */
  originalText: string;
  /** Extracted venue name (or null if couldn't extract) */
  venue: string | null;
  /** Extracted date in DD/MM or DD/MM/YYYY format (or null if couldn't extract) */
  date: string | null;
  /** Year if extracted separately */
  year?: number;
  /** Whether the input contained mixed venue/date */
  wasMixed: boolean;
  /** Confidence in the split (0-1) */
  confidence: number;
  /** Processing notes for debugging */
  notes: string[];
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Month name to number mapping
 */
const MONTH_NAMES: Record<string, number> = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};

const MONTH_PATTERN = '(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)';

/**
 * Patterns for cinema/theater release phrases
 * These indicate the "venue" is actually a distribution type
 */
const RELEASE_VENUE_PATTERNS = [
  /^(in\s+cinemas?)\s+(.+)$/i,
  /^(in\s+theaters?)\s+(.+)$/i,
  /^(in\s+theatres?)\s+(.+)$/i,
  /^(only\s+(?:in\s+)?(?:cinemas?|theaters?|theatres?))\s+(.+)$/i,
  /^(coming\s+to\s+(?:cinemas?|theaters?|theatres?))\s+(.+)$/i,
  /^(on\s+(?:dvd|blu-?ray|streaming|netflix|amazon|hulu))\s+(.+)$/i,
];

/**
 * Patterns for date at end of venue string
 */
const VENUE_DATE_END_PATTERNS = [
  // "Venue Name Month DD" or "Venue Name Month DDth"
  new RegExp(`^(.+?)\\s+(${MONTH_PATTERN})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+(\\d{4}))?$`, 'i'),
  // "Venue Name DD Month" or "Venue Name DDth Month"
  new RegExp(`^(.+?)\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_PATTERN})(?:\\s+(\\d{4}))?$`, 'i'),
  // "Venue Name DD/MM/YYYY" or "Venue Name DD-MM-YYYY"
  /^(.+?)\s+(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/,
  // "Venue Name DD/MM/YY" or "Venue Name DD-MM-YY"
  /^(.+?)\s+(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})$/,
  // "Venue Name DD/MM" (no year)
  /^(.+?)\s+(\d{1,2})[\/\-](\d{1,2})$/,
];

/**
 * Keywords that indicate a string is likely a venue name
 */
const VENUE_KEYWORDS = [
  'arena', 'stadium', 'theatre', 'theater', 'hall', 'center', 'centre',
  'club', 'bar', 'pub', 'lounge', 'room', 'auditorium', 'amphitheater',
  'amphitheatre', 'pavilion', 'garden', 'gardens', 'park', 'field',
  'coliseum', 'dome', 'forum', 'palace', 'house', 'ballroom', 'showroom',
  'casino', 'hotel', 'resort', 'cinema', 'cinemas', 'multiplex',
];

// ============================================================================
// Main Function
// ============================================================================

/**
 * Split a venue string that may contain date information.
 */
export function splitVenueDate(venueText: string | undefined | null): VenueDateSplitResult {
  const notes: string[] = [];

  if (!venueText || typeof venueText !== 'string') {
    return {
      originalText: venueText ?? '',
      venue: null,
      date: null,
      wasMixed: false,
      confidence: 0,
      notes: ['Empty input'],
    };
  }

  const trimmed = venueText.trim();

  if (!trimmed) {
    return {
      originalText: venueText,
      venue: null,
      date: null,
      wasMixed: false,
      confidence: 0,
      notes: ['Empty input after trim'],
    };
  }

  // Step 1: Check for cinema/theater release patterns
  for (const pattern of RELEASE_VENUE_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      const venuePart = match[1].trim();
      const datePart = match[2].trim();
      const parsedDate = parseDate(datePart);

      if (parsedDate) {
        notes.push(`Matched release pattern: venue="${venuePart}", date="${datePart}"`);
        return {
          originalText: venueText,
          venue: venuePart,
          date: parsedDate.formatted,
          year: parsedDate.year,
          wasMixed: true,
          confidence: 0.9,
          notes,
        };
      }
    }
  }

  // Step 2: Check for date at end of venue string
  for (const pattern of VENUE_DATE_END_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      // Pattern-specific extraction
      const result = extractFromVenueDateMatch(match, pattern);
      if (result) {
        notes.push(`Matched venue+date pattern: venue="${result.venue}", date="${result.date}"`);
        return {
          originalText: venueText,
          venue: result.venue,
          date: result.date,
          year: result.year,
          wasMixed: true,
          confidence: result.confidence,
          notes,
        };
      }
    }
  }

  // Step 3: Check if the string looks like just a date (no venue)
  const pureDate = parseDate(trimmed);
  if (pureDate && !containsVenueKeyword(trimmed)) {
    notes.push('Input appears to be a date only, not a venue');
    return {
      originalText: venueText,
      venue: null,
      date: pureDate.formatted,
      year: pureDate.year,
      wasMixed: false,
      confidence: 0.8,
      notes,
    };
  }

  // Step 4: No date found - return as pure venue
  notes.push('No date pattern detected, treating as pure venue');
  return {
    originalText: venueText,
    venue: trimmed,
    date: null,
    wasMixed: false,
    confidence: 1.0,
    notes,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

interface ParsedDate {
  formatted: string;  // DD/MM or DD/MM/YYYY
  day: number;
  month: number;
  year?: number;
}

/**
 * Parse various date formats into a normalized format
 */
function parseDate(text: string): ParsedDate | null {
  const trimmed = text.trim();

  // Month DD, YYYY or Month DDth, YYYY
  let match = trimmed.match(new RegExp(`^(${MONTH_PATTERN})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?$`, 'i'));
  if (match) {
    const month = MONTH_NAMES[match[1].toLowerCase()];
    const day = parseInt(match[2], 10);
    const year = match[3] ? parseInt(match[3], 10) : undefined;

    if (isValidDayMonth(day, month)) {
      return {
        formatted: formatDate(day, month, year),
        day,
        month,
        year,
      };
    }
  }

  // DD Month YYYY or DDth Month YYYY
  match = trimmed.match(new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_PATTERN})(?:\\s+(\\d{4}))?$`, 'i'));
  if (match) {
    const day = parseInt(match[1], 10);
    const month = MONTH_NAMES[match[2].toLowerCase()];
    const year = match[3] ? parseInt(match[3], 10) : undefined;

    if (isValidDayMonth(day, month)) {
      return {
        formatted: formatDate(day, month, year),
        day,
        month,
        year,
      };
    }
  }

  // DD/MM/YYYY or DD-MM-YYYY
  match = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (match) {
    const day = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const year = parseInt(match[3], 10);

    if (isValidDayMonth(day, month)) {
      return {
        formatted: formatDate(day, month, year),
        day,
        month,
        year,
      };
    }
  }

  // DD/MM/YY or DD-MM-YY
  match = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})$/);
  if (match) {
    const day = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const shortYear = parseInt(match[3], 10);
    const year = shortYear > 50 ? 1900 + shortYear : 2000 + shortYear;

    if (isValidDayMonth(day, month)) {
      return {
        formatted: formatDate(day, month, year),
        day,
        month,
        year,
      };
    }
  }

  // DD/MM (no year)
  match = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})$/);
  if (match) {
    const day = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);

    if (isValidDayMonth(day, month)) {
      return {
        formatted: formatDate(day, month),
        day,
        month,
      };
    }
  }

  return null;
}

/**
 * Extract venue and date from a regex match
 */
function extractFromVenueDateMatch(
  match: RegExpMatchArray,
  pattern: RegExp
): { venue: string; date: string; year?: number; confidence: number } | null {
  const patternStr = pattern.source;

  // Pattern: venue + Month DD [YYYY]
  if (patternStr.includes(MONTH_PATTERN) && patternStr.indexOf('\\d{1,2}') > patternStr.indexOf(MONTH_PATTERN)) {
    const venue = match[1].trim();
    const monthName = match[2].toLowerCase();
    const day = parseInt(match[3], 10);
    const year = match[4] ? parseInt(match[4], 10) : undefined;
    const month = MONTH_NAMES[monthName];

    if (venue && isValidDayMonth(day, month)) {
      return {
        venue,
        date: formatDate(day, month, year),
        year,
        confidence: 0.85,
      };
    }
  }

  // Pattern: venue + DD Month [YYYY]
  if (patternStr.includes(MONTH_PATTERN) && patternStr.indexOf('\\d{1,2}') < patternStr.indexOf(MONTH_PATTERN)) {
    const venue = match[1].trim();
    const day = parseInt(match[2], 10);
    const monthName = match[3].toLowerCase();
    const year = match[4] ? parseInt(match[4], 10) : undefined;
    const month = MONTH_NAMES[monthName];

    if (venue && isValidDayMonth(day, month)) {
      return {
        venue,
        date: formatDate(day, month, year),
        year,
        confidence: 0.85,
      };
    }
  }

  // Pattern: venue + DD/MM/YYYY
  if (patternStr.includes('[/\\-]') && match.length === 5) {
    const venue = match[1].trim();
    const day = parseInt(match[2], 10);
    const month = parseInt(match[3], 10);
    let year: number | undefined;

    if (match[4].length === 4) {
      year = parseInt(match[4], 10);
    } else if (match[4].length === 2) {
      const shortYear = parseInt(match[4], 10);
      year = shortYear > 50 ? 1900 + shortYear : 2000 + shortYear;
    }

    if (venue && isValidDayMonth(day, month)) {
      return {
        venue,
        date: formatDate(day, month, year),
        year,
        confidence: 0.9,
      };
    }
  }

  // Pattern: venue + DD/MM (no year)
  if (patternStr.includes('[/\\-]') && match.length === 4) {
    const venue = match[1].trim();
    const day = parseInt(match[2], 10);
    const month = parseInt(match[3], 10);

    if (venue && isValidDayMonth(day, month)) {
      return {
        venue,
        date: formatDate(day, month),
        confidence: 0.8,
      };
    }
  }

  return null;
}

/**
 * Format day/month/year into DD/MM or DD/MM/YYYY
 */
function formatDate(day: number, month: number, year?: number): string {
  const dd = day.toString().padStart(2, '0');
  const mm = month.toString().padStart(2, '0');

  if (year) {
    return `${dd}/${mm}/${year}`;
  }
  return `${dd}/${mm}`;
}

/**
 * Validate day and month values
 */
function isValidDayMonth(day: number, month: number): boolean {
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  return true;
}

/**
 * Check if a string contains venue-related keywords
 */
function containsVenueKeyword(text: string): boolean {
  const lower = text.toLowerCase();
  return VENUE_KEYWORDS.some(keyword => lower.includes(keyword));
}
