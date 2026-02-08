/**
 * Poster Data Cleaner
 *
 * Utilities for cleaning and normalizing vision model output before storage.
 * Handles:
 * - Date normalization (various formats → DD/MM/YYYY)
 * - Commentary detection and extraction
 * - Field validation (reject invalid data)
 * - Default value handling
 * - Garbage detection (dates in artist fields, verbose explanations)
 */

import type { PosterEntity, VisionExtractionResult } from '../types.js';

// ============================================================================
// Field Validation Result
// ============================================================================

export interface FieldValidationResult {
  value: string | null;
  isValid: boolean;
  confidence: number;
  rejectionReason?: string;
}

// ============================================================================
// Commentary Detection
// ============================================================================

/**
 * Phrases that indicate commentary/explanation rather than actual data
 */
const COMMENTARY_PATTERNS = [
  /not specified/i,
  /not available/i,
  /not provided/i,
  /not found/i,
  /not visible/i,
  /not clear/i,
  /cannot be determined/i,
  /could not be determined/i,
  /unable to determine/i,
  /unclear/i,
  /unknown/i,
  /n\/a/i,
  /none specified/i,
  /no \w+ specified/i,
  /no \w+ provided/i,
  /no \w+ found/i,
  /\[not applicable\]/i,
  /in the text provided/i,
  /in the image/i,
  /from the poster/i,
  /appears to be/i,
  /might be/i,
  /could be/i,
  /possibly/i,
  /likely/i,
  /seems to/i,
];

/**
 * Extended patterns for verbose LLM explanations
 * These catch cases like "Not applicable as it's an album poster"
 */
const VERBOSE_EXPLANATION_PATTERNS = [
  /not applicable/i,
  /as it is/i,
  /as it's/i,
  /because it/i,
  /since it/i,
  /since this/i,
  /this is a/i,
  /this is an/i,
  /which is/i,
  /that is/i,
  /rather than/i,
  /instead of/i,
  /does not/i,
  /doesn't/i,
  /cannot/i,
  /can't/i,
  /promotional material/i,
  /advertisement/i,
  /the poster/i,
  /album poster/i,
  /film poster/i,
  /movie poster/i,
  /release poster/i,
  /mentioned above/i,
  /as mentioned/i,
  /prominently displayed/i,
  /at the top/i,
  /at the bottom/i,
  /in the text/i,
  /list of/i,
  /multiple bands/i,
  /multiple artists/i,
  /various artists/i,
];

/**
 * Day of week patterns - indicates a date, not an artist/venue name
 */
const DAY_OF_WEEK_PATTERN = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\b/i;

/**
 * Date-like patterns that shouldn't appear in artist/venue names
 */
const DATE_IN_FIELD_PATTERNS = [
  // "Sunday 27 January" or "27 January"
  /\b\d{1,2}\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
  // "January 27"
  /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}\b/i,
  // Day + date + month: "Sunday 27 January"
  /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+\d{1,2}\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
  // Abbreviated: "Sun 27 Jan"
  /\b(mon|tue|wed|thu|fri|sat|sun)\s+\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i,
];

/**
 * Maximum reasonable lengths for entity names
 */
const MAX_FIELD_LENGTHS = {
  artist: 60,      // Most artist names are under 40 chars
  venue: 80,       // Some venues have longer names
  city: 40,
  state: 40,
  title: 120,
  default: 100,
};

/**
 * Check if a string contains commentary rather than actual data
 */
export function isCommentary(value: string | undefined | null): boolean {
  if (!value || typeof value !== 'string') return true;

  const trimmed = value.trim();
  if (trimmed.length === 0) return true;

  // Check against commentary patterns
  return COMMENTARY_PATTERNS.some(pattern => pattern.test(trimmed));
}

/**
 * Check if a string contains verbose LLM explanation
 */
export function isVerboseExplanation(value: string | undefined | null): boolean {
  if (!value || typeof value !== 'string') return false;

  const trimmed = value.trim();

  // Check against verbose explanation patterns
  return VERBOSE_EXPLANATION_PATTERNS.some(pattern => pattern.test(trimmed));
}

/**
 * Check if a string looks like a date (shouldn't be in artist/venue fields)
 */
export function looksLikeDate(value: string | undefined | null): boolean {
  if (!value || typeof value !== 'string') return false;

  const trimmed = value.trim();

  // Check for day of week at the start
  if (DAY_OF_WEEK_PATTERN.test(trimmed.split(' ')[0])) {
    return true;
  }

  // Check for date patterns
  return DATE_IN_FIELD_PATTERNS.some(pattern => pattern.test(trimmed));
}

/**
 * Check if a value exceeds reasonable length for its field type
 */
export function exceedsMaxLength(value: string | undefined | null, fieldType: keyof typeof MAX_FIELD_LENGTHS = 'default'): boolean {
  if (!value || typeof value !== 'string') return false;

  const maxLen = MAX_FIELD_LENGTHS[fieldType] || MAX_FIELD_LENGTHS.default;
  return value.trim().length > maxLen;
}

// ============================================================================
// Field-Specific Validation
// ============================================================================

/**
 * Validate an artist/headliner name
 * Returns null if invalid, cleaned value if valid
 */
export function validateArtistName(value: string | undefined | null): FieldValidationResult {
  if (!value || typeof value !== 'string') {
    return { value: null, isValid: false, confidence: 0, rejectionReason: 'Empty value' };
  }

  const trimmed = value.trim();

  // Check for commentary
  if (isCommentary(trimmed)) {
    return { value: null, isValid: false, confidence: 0, rejectionReason: 'Commentary detected' };
  }

  // Check for verbose explanation
  if (isVerboseExplanation(trimmed)) {
    return { value: null, isValid: false, confidence: 0, rejectionReason: `Verbose explanation: "${trimmed.slice(0, 50)}..."` };
  }

  // Check for date patterns (artist names shouldn't look like dates)
  if (looksLikeDate(trimmed)) {
    return { value: null, isValid: false, confidence: 0, rejectionReason: `Looks like a date: "${trimmed}"` };
  }

  // Check length
  if (exceedsMaxLength(trimmed, 'artist')) {
    return { value: null, isValid: false, confidence: 0, rejectionReason: `Too long (${trimmed.length} chars): "${trimmed.slice(0, 50)}..."` };
  }

  // Check for suspicious patterns (spacing issues like "N O T _ A P P L I C A B L E")
  if (/^[A-Z]\s[A-Z]\s[A-Z]/.test(trimmed) || /_{2,}/.test(trimmed)) {
    return { value: null, isValid: false, confidence: 0, rejectionReason: `Suspicious formatting: "${trimmed}"` };
  }

  // Passed all checks - calculate confidence based on characteristics
  let confidence = 0.8;

  // Reduce confidence for very short names
  if (trimmed.length < 3) confidence -= 0.2;

  // Reduce confidence for names with lots of numbers
  const digitRatio = (trimmed.match(/\d/g) || []).length / trimmed.length;
  if (digitRatio > 0.3) confidence -= 0.2;

  // Reduce confidence if it contains common venue words (might be mixed up)
  if (/\b(hotel|theatre|theater|hall|arena|stadium|club|bar|pub|venue)\b/i.test(trimmed)) {
    confidence -= 0.15;
  }

  return {
    value: trimmed,
    isValid: true,
    confidence: Math.max(0.3, confidence)
  };
}

/**
 * Validate a venue name
 * Returns null if invalid, cleaned value if valid
 */
export function validateVenueName(value: string | undefined | null): FieldValidationResult {
  if (!value || typeof value !== 'string') {
    return { value: null, isValid: false, confidence: 0, rejectionReason: 'Empty value' };
  }

  const trimmed = value.trim();

  // Check for commentary
  if (isCommentary(trimmed)) {
    return { value: null, isValid: false, confidence: 0, rejectionReason: 'Commentary detected' };
  }

  // Check for verbose explanation
  if (isVerboseExplanation(trimmed)) {
    return { value: null, isValid: false, confidence: 0, rejectionReason: `Verbose explanation: "${trimmed.slice(0, 50)}..."` };
  }

  // Check length
  if (exceedsMaxLength(trimmed, 'venue')) {
    return { value: null, isValid: false, confidence: 0, rejectionReason: `Too long (${trimmed.length} chars): "${trimmed.slice(0, 50)}..."` };
  }

  // Passed all checks
  let confidence = 0.8;

  // Boost confidence for names containing venue-like words
  if (/\b(hotel|theatre|theater|hall|arena|stadium|club|bar|pub|venue|room|centre|center|palace|house)\b/i.test(trimmed)) {
    confidence += 0.1;
  }

  return {
    value: trimmed,
    isValid: true,
    confidence: Math.min(1.0, confidence)
  };
}

/**
 * Extract commentary from a field value, returning the cleaned value and notes
 */
export function extractCommentary(value: string | undefined | null): {
  cleanedValue: string | null;
  commentary: string | null;
} {
  if (!value || typeof value !== 'string') {
    return { cleanedValue: null, commentary: null };
  }

  const trimmed = value.trim();

  // If the whole value is commentary, return null for value
  if (isCommentary(trimmed)) {
    return { cleanedValue: null, commentary: trimmed };
  }

  // Check for parenthetical commentary (e.g., "31/03/95 (released on March 31, 1995)")
  const parenMatch = trimmed.match(/^([^(]+)\s*\((.+)\)$/);
  if (parenMatch) {
    const mainValue = parenMatch[1].trim();
    const parenContent = parenMatch[2].trim();

    // If the parenthetical content is explanatory, extract it as commentary
    if (isCommentary(parenContent) || /released|possibly|likely|could be|might be/i.test(parenContent)) {
      return { cleanedValue: mainValue, commentary: parenContent };
    }
  }

  return { cleanedValue: trimmed, commentary: null };
}

// ============================================================================
// Date Normalization
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

/**
 * Normalize a date string to DD/MM/YYYY format (EN-AU)
 * Returns null if the date cannot be parsed
 */
export function normalizeDate(rawDate: string | undefined | null): string | null {
  if (!rawDate || typeof rawDate !== 'string') return null;

  // First extract any commentary
  const { cleanedValue } = extractCommentary(rawDate);
  if (!cleanedValue) return null;

  const value = cleanedValue.trim();

  // Skip if it's a very short number that's not a valid date (e.g., "6453")
  if (/^\d{1,5}$/.test(value) && !value.includes('/') && !value.includes('-')) {
    // Could be a year if 4 digits starting with 19 or 20
    if (/^(19|20)\d{2}$/.test(value)) {
      // Just a year - return as partial date
      return null; // Or could return `01/01/${value}` if you want a default
    }
    return null; // Not a valid date
  }

  // Skip marketing text like "ONLY AT THE MOVIES JANUARY 10"
  if (/only at|coming soon|now showing|in theaters/i.test(value)) {
    // Try to extract just the date portion
    const dateMatch = value.match(/\b(\d{1,2})\s*(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/i);
    if (dateMatch) {
      const day = parseInt(dateMatch[1], 10);
      const monthName = dateMatch[2].toLowerCase();
      const month = MONTH_NAMES[monthName];
      if (month && day >= 1 && day <= 31) {
        // We don't have year, return partial
        return `${day.toString().padStart(2, '0')}/${month.toString().padStart(2, '0')}`;
      }
    }
    return null;
  }

  // Try various date formats

  // DD/MM/YYYY or DD-MM-YYYY
  let match = value.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (match) {
    const [, day, month, year] = match;
    if (isValidDate(parseInt(day), parseInt(month), parseInt(year))) {
      return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year}`;
    }
  }

  // DD/MM/YY or DD-MM-YY
  match = value.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})$/);
  if (match) {
    const [, day, month, shortYear] = match;
    const year = parseInt(shortYear) > 50 ? `19${shortYear}` : `20${shortYear}`;
    if (isValidDate(parseInt(day), parseInt(month), parseInt(year))) {
      return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year}`;
    }
  }

  // DD/MM-YY (mixed separator like "31/03-95")
  match = value.match(/^(\d{1,2})\/(\d{1,2})-(\d{2})$/);
  if (match) {
    const [, day, month, shortYear] = match;
    const year = parseInt(shortYear) > 50 ? `19${shortYear}` : `20${shortYear}`;
    if (isValidDate(parseInt(day), parseInt(month), parseInt(year))) {
      return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year}`;
    }
  }

  // Month DD, YYYY (e.g., "March 31, 1995")
  match = value.match(/^(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),?\s+(\d{4})$/i);
  if (match) {
    const [, monthName, day, year] = match;
    const month = MONTH_NAMES[monthName.toLowerCase()];
    if (month && isValidDate(parseInt(day), month, parseInt(year))) {
      return `${day.padStart(2, '0')}/${month.toString().padStart(2, '0')}/${year}`;
    }
  }

  // DD Month YYYY (e.g., "31 March 1995")
  match = value.match(/^(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})$/i);
  if (match) {
    const [, day, monthName, year] = match;
    const month = MONTH_NAMES[monthName.toLowerCase()];
    if (month && isValidDate(parseInt(day), month, parseInt(year))) {
      return `${day.padStart(2, '0')}/${month.toString().padStart(2, '0')}/${year}`;
    }
  }

  // Abbreviated month: DD Mon YYYY or Mon DD, YYYY
  match = value.match(/^(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{4})$/i);
  if (match) {
    const [, day, monthName, year] = match;
    const month = MONTH_NAMES[monthName.toLowerCase()];
    if (month && isValidDate(parseInt(day), month, parseInt(year))) {
      return `${day.padStart(2, '0')}/${month.toString().padStart(2, '0')}/${year}`;
    }
  }

  match = value.match(/^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2}),?\s+(\d{4})$/i);
  if (match) {
    const [, monthName, day, year] = match;
    const month = MONTH_NAMES[monthName.toLowerCase()];
    if (month && isValidDate(parseInt(day), month, parseInt(year))) {
      return `${day.padStart(2, '0')}/${month.toString().padStart(2, '0')}/${year}`;
    }
  }

  // Day, DD Month YYYY (e.g., "Fri, 20 April")
  match = value.match(/^(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s*(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)(?:\s+(\d{4}))?$/i);
  if (match) {
    const [, day, monthName, year] = match;
    const month = MONTH_NAMES[monthName.toLowerCase()];
    if (month && parseInt(day) >= 1 && parseInt(day) <= 31) {
      if (year) {
        return `${day.padStart(2, '0')}/${month.toString().padStart(2, '0')}/${year}`;
      }
      // No year - return partial date
      return `${day.padStart(2, '0')}/${month.toString().padStart(2, '0')}`;
    }
  }

  // ISO format: YYYY-MM-DD
  match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const [, year, month, day] = match;
    if (isValidDate(parseInt(day), parseInt(month), parseInt(year))) {
      return `${day}/${month}/${year}`;
    }
  }

  return null;
}

/**
 * Check if day/month/year values form a valid date
 */
function isValidDate(day: number, month: number, year: number): boolean {
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  if (year < 1900 || year > 2100) return false;

  // More specific validation
  const daysInMonth = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  // Leap year check
  if (month === 2 && ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0)) {
    return day <= 29;
  }

  return day <= daysInMonth[month];
}

/**
 * Extract year from a date string or raw text
 */
export function extractYear(value: string | undefined | null): number | null {
  if (!value || typeof value !== 'string') return null;

  // Look for 4-digit year
  const match = value.match(/\b(19[6-9]\d|20[0-2]\d)\b/);
  return match ? parseInt(match[1], 10) : null;
}

// ============================================================================
// Field Validation
// ============================================================================

/**
 * Validate and clean a text field, returning null if invalid
 */
export function cleanTextField(value: string | undefined | null): string | null {
  if (!value || typeof value !== 'string') return null;

  const { cleanedValue } = extractCommentary(value);
  if (!cleanedValue) return null;

  // Remove excessive whitespace
  const cleaned = cleanedValue.replace(/\s+/g, ' ').trim();

  // Reject very short values that are likely garbage
  if (cleaned.length < 2) return null;

  // Reject verbose explanations
  if (isVerboseExplanation(cleaned)) return null;

  // Reject excessively long values (likely explanations)
  if (cleaned.length > MAX_FIELD_LENGTHS.default) return null;

  return cleaned;
}

/**
 * Validate and clean an array of strings
 */
export function cleanStringArray(values: string[] | undefined | null): string[] {
  if (!values || !Array.isArray(values)) return [];

  return values
    .map(v => cleanTextField(v))
    .filter((v): v is string => v !== null);
}

// ============================================================================
// Entity Cleaner
// ============================================================================

export interface CleanedPosterData {
  entity: Partial<PosterEntity>;
  extractionNotes: string[];
  /** Confidence scores for key fields */
  fieldConfidences: Record<string, number>;
  /** Fields that were rejected with reasons */
  rejectedFields: Record<string, string>;
}

/**
 * Clean and normalize poster entity data from vision model output
 */
export function cleanPosterData(
  entity: Partial<PosterEntity>,
  _extractionResult?: VisionExtractionResult
): CleanedPosterData {
  const notes: string[] = [];
  const fieldConfidences: Record<string, number> = {};
  const rejectedFields: Record<string, string> = {};

  // Validate headliner with field-specific validation
  const headlinerValidation = validateArtistName(entity.headliner);
  if (!headlinerValidation.isValid && entity.headliner) {
    notes.push(`Headliner rejected: ${headlinerValidation.rejectionReason}`);
    rejectedFields['headliner'] = headlinerValidation.rejectionReason || 'Invalid';
  } else if (headlinerValidation.isValid) {
    fieldConfidences['headliner'] = headlinerValidation.confidence;
  }

  // Validate venue with field-specific validation
  const venueValidation = validateVenueName(entity.venue_name);
  if (!venueValidation.isValid && entity.venue_name) {
    notes.push(`Venue rejected: ${venueValidation.rejectionReason}`);
    rejectedFields['venue_name'] = venueValidation.rejectionReason || 'Invalid';
  } else if (venueValidation.isValid) {
    fieldConfidences['venue_name'] = venueValidation.confidence;
  }

  // Validate supporting acts
  const validatedSupportingActs: string[] = [];
  if (entity.supporting_acts && Array.isArray(entity.supporting_acts)) {
    for (const act of entity.supporting_acts) {
      const actValidation = validateArtistName(act);
      if (actValidation.isValid && actValidation.value) {
        validatedSupportingActs.push(actValidation.value);
      } else if (act) {
        notes.push(`Supporting act rejected: "${act.slice(0, 30)}..." - ${actValidation.rejectionReason}`);
      }
    }
  }

  // Clean title (less strict)
  const titleResult = extractCommentary(entity.title);
  if (titleResult.commentary) {
    notes.push(`Title had commentary: ${titleResult.commentary}`);
  }

  // Clean and normalize date
  const originalDate = entity.event_date;
  const normalizedDate = normalizeDate(originalDate);
  const dateCommentary = extractCommentary(originalDate);
  if (dateCommentary.commentary) {
    notes.push(`Date had commentary: ${dateCommentary.commentary}`);
  }
  if (originalDate && !normalizedDate && !dateCommentary.commentary) {
    notes.push(`Date could not be parsed: "${originalDate}"`);
  }

  // Extract year if not already set
  let year = entity.year;
  if (!year && normalizedDate) {
    year = extractYear(normalizedDate);
  }
  if (!year && originalDate) {
    year = extractYear(originalDate);
  }

  // Calculate decade
  const decade = year ? `${Math.floor(year / 10) * 10}s` : undefined;

  // Build cleaned entity - use validated values, null for rejected
  const cleanedEntity: Partial<PosterEntity> = {
    ...entity,
    title: cleanTextField(entity.title),
    headliner: headlinerValidation.value,  // null if rejected
    venue_name: venueValidation.value,      // null if rejected
    city: cleanTextField(entity.city),
    state: cleanTextField(entity.state),
    country: cleanTextField(entity.country),
    event_date: normalizedDate,
    event_dates: entity.event_dates?.map(d => normalizeDate(d)).filter((d): d is string => d != null),
    year,
    decade,
    supporting_acts: validatedSupportingActs.length > 0 ? validatedSupportingActs : undefined,
    ticket_price: cleanTextField(entity.ticket_price),
    door_time: cleanTextField(entity.door_time),
    show_time: cleanTextField(entity.show_time),
    age_restriction: cleanTextField(entity.age_restriction),
    tour_name: cleanTextField(entity.tour_name),
    record_label: cleanTextField(entity.record_label),
    promoter: cleanTextField(entity.promoter),
    extraction_notes: notes.length > 0 ? notes.join('; ') : undefined,
  };

  return {
    entity: cleanedEntity,
    extractionNotes: notes,
    fieldConfidences,
    rejectedFields,
  };
}
