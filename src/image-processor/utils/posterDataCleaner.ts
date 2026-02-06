/**
 * Poster Data Cleaner
 *
 * Utilities for cleaning and normalizing vision model output before storage.
 * Handles:
 * - Date normalization (various formats → DD/MM/YYYY)
 * - Commentary detection and extraction
 * - Field validation (reject invalid data)
 * - Default value handling
 */

import type { PosterEntity, VisionExtractionResult } from '../types.js';

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
}

/**
 * Clean and normalize poster entity data from vision model output
 */
export function cleanPosterData(
  entity: Partial<PosterEntity>,
  extractionResult?: VisionExtractionResult
): CleanedPosterData {
  const notes: string[] = [];

  // Clean title
  const titleResult = extractCommentary(entity.title);
  if (titleResult.commentary) {
    notes.push(`Title: ${titleResult.commentary}`);
  }

  // Clean headliner
  const headlinerResult = extractCommentary(entity.headliner);
  if (headlinerResult.commentary) {
    notes.push(`Headliner: ${headlinerResult.commentary}`);
  }

  // Clean venue
  const venueResult = extractCommentary(entity.venue_name);
  if (venueResult.commentary) {
    notes.push(`Venue: ${venueResult.commentary}`);
  }

  // Clean and normalize date
  const originalDate = entity.event_date;
  const normalizedDate = normalizeDate(originalDate);
  const dateCommentary = extractCommentary(originalDate);
  if (dateCommentary.commentary) {
    notes.push(`Date: ${dateCommentary.commentary}`);
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

  // Clean supporting acts
  const cleanedSupportingActs = cleanStringArray(entity.supporting_acts);

  // Build cleaned entity
  const cleanedEntity: Partial<PosterEntity> = {
    ...entity,
    title: cleanTextField(entity.title),
    headliner: cleanTextField(entity.headliner),
    venue_name: cleanTextField(entity.venue_name),
    city: cleanTextField(entity.city),
    state: cleanTextField(entity.state),
    country: cleanTextField(entity.country),
    event_date: normalizedDate,
    year,
    decade,
    supporting_acts: cleanedSupportingActs.length > 0 ? cleanedSupportingActs : undefined,
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
  };
}
