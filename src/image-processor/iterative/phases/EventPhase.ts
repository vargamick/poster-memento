/**
 * Event Phase - Event/Date extraction and validation
 *
 * Fourth phase of iterative processing that extracts temporal information
 * and validates plausibility against artist activity and venue existence.
 */

import { BasePhase, PhaseInput } from './BasePhase.js';
import {
  EventPhaseResult,
  DateInfo,
  ShowInfo,
  PosterType,
  ArtistPhaseResult,
  VenuePhaseResult,
} from '../types.js';
import { EVENT_PROMPTS } from '../prompts.js';
import { VisionModelProvider } from '../../types.js';
import { PhaseManager } from '../PhaseManager.js';
import { SearchService } from '../../../core/services/SearchService.js';

/**
 * Date parsing patterns
 */
const DATE_PATTERNS = [
  // Full date formats
  { regex: /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/, order: ['month', 'day', 'year'] },
  { regex: /(\d{1,2})-(\d{1,2})-(\d{2,4})/, order: ['month', 'day', 'year'] },
  { regex: /(\d{1,2})\.(\d{1,2})\.(\d{2,4})/, order: ['day', 'month', 'year'] },
  // Month name formats (full month names)
  { regex: /(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?/i, order: ['month_name', 'day', 'year'] },
  // Abbreviated month names
  { regex: /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?/i, order: ['month_name', 'day', 'year'] },
  // Day first formats (e.g., "17th September 2005", "27 April")
  { regex: /(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december),?\s*(\d{4})?/i, order: ['day', 'month_name', 'year'] },
  { regex: /(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\.?,?\s*(\d{4})?/i, order: ['day', 'month_name', 'year'] },
  // Year only
  { regex: /\b(19[6-9]\d|20[0-2]\d)\b/, order: ['year'] },
];

/**
 * Full month name pattern for shared month detection
 */
const MONTH_PATTERN = /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b/i;

/**
 * Day-of-week pattern to strip from date strings before parsing
 */
const DAY_OF_WEEK_PREFIX = /^(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)[,.\s]*/i;

/**
 * Extract day-of-week from a date string segment
 */
function extractDayOfWeek(segment: string): string | undefined {
  const match = segment.match(/^(mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)/i);
  if (!match) return undefined;
  const abbrev = match[1].substring(0, 3).toLowerCase();
  const dayMap: Record<string, string> = {
    mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday',
    thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
  };
  return dayMap[abbrev];
}

/**
 * Split a multi-date string into individual date segments.
 *
 * Separator semantics:
 * - "&", "and", "," → individual discrete dates
 * - "/" when between day-of-week+date patterns → individual dates (e.g., "Fri 27 April / Sat 28 April")
 * - "-", "to" → date range (expand each day between start and end)
 *
 * Returns an array of { dateStr, dayOfWeek } for each individual date.
 * If the string contains a shared month/year trailing component, it is
 * distributed to each segment (e.g., "17th & 18th September, 2005"
 * becomes ["17th September, 2005", "18th September, 2005"]).
 */
function splitMultiDateString(raw: string): { dateStr: string; dayOfWeek?: string }[] {
  const trimmed = raw.trim();

  // Quick check: if no separator present, return as-is
  if (!/[&,\/]|\band\b|\bto\b/i.test(trimmed)) {
    const dow = extractDayOfWeek(trimmed);
    return [{ dateStr: trimmed, dayOfWeek: dow }];
  }

  // Extract a trailing shared year (e.g., ", 2005" at the end)
  let sharedYear = '';
  let body = trimmed;
  const trailingYearMatch = body.match(/,?\s*((?:19|20)\d{2})\s*$/);
  if (trailingYearMatch) {
    sharedYear = trailingYearMatch[1];
    body = body.substring(0, body.length - trailingYearMatch[0].length).trim();
  }

  // Extract a trailing shared month (e.g., "September" at the end after removing year)
  let sharedMonth = '';
  const trailingMonthMatch = body.match(/,?\s*(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s*$/i);
  if (trailingMonthMatch) {
    sharedMonth = trailingMonthMatch[1];
    body = body.substring(0, body.length - trailingMonthMatch[0].length).trim();
  }

  // Detect range separators: "17th - 18th", "17 to 19"
  // Only treat "-" as range when it separates day numbers (not "DD-MM-YYYY" style)
  const rangeMatch = body.match(/^(.+?)\s*(?:-|–|to)\s*(.+)$/i);
  if (rangeMatch && sharedMonth) {
    const startPart = rangeMatch[1].trim();
    const endPart = rangeMatch[2].trim();

    // Check if both parts are simple day numbers (possibly with ordinals and day-of-week)
    const startDayMatch = startPart.replace(DAY_OF_WEEK_PREFIX, '').match(/^(\d{1,2})(?:st|nd|rd|th)?$/i);
    const endDayMatch = endPart.replace(DAY_OF_WEEK_PREFIX, '').match(/^(\d{1,2})(?:st|nd|rd|th)?$/i);

    if (startDayMatch && endDayMatch) {
      const startDay = parseInt(startDayMatch[1], 10);
      const endDay = parseInt(endDayMatch[1], 10);

      if (endDay >= startDay && (endDay - startDay) < 14) {
        const results: { dateStr: string; dayOfWeek?: string }[] = [];
        for (let d = startDay; d <= endDay; d++) {
          const fullDate = sharedYear
            ? `${d} ${sharedMonth} ${sharedYear}`
            : `${d} ${sharedMonth}`;
          results.push({ dateStr: fullDate });
        }
        return results;
      }
    }
  }

  // Split on individual-date separators: &, "and", ","
  // Also split on "/" when it separates date-like segments (not DD/MM/YYYY)
  let segments: string[];

  // Check if "/" is a date separator (e.g., "Fri 27 April / Sat 28 April")
  // vs. a date format separator (e.g., "27/04/2005")
  const slashIsDateSep = /[a-z]\s*\/\s*[a-z]/i.test(body) ||
    /\d\s+\w+\s*\/\s*\w+\s+\d/.test(body);

  const splitPattern = slashIsDateSep
    ? /\s*(?:&|,|\band\b|\/)\s*/i
    : /\s*(?:&|,|\band\b)\s*/i;

  segments = body.split(splitPattern).map(s => s.trim()).filter(s => s.length > 0);

  if (segments.length <= 1) {
    // No effective split — return original
    const dow = extractDayOfWeek(trimmed);
    return [{ dateStr: trimmed, dayOfWeek: dow }];
  }

  // Distribute shared month/year to segments that lack them
  return segments.map(seg => {
    const dow = extractDayOfWeek(seg);
    let datePart = seg.replace(DAY_OF_WEEK_PREFIX, '').trim();

    // If segment doesn't contain a month, append shared month
    if (sharedMonth && !MONTH_PATTERN.test(datePart)) {
      datePart = `${datePart} ${sharedMonth}`;
    }
    // If segment doesn't contain a year, append shared year
    if (sharedYear && !/(?:19|20)\d{2}/.test(datePart)) {
      datePart = `${datePart} ${sharedYear}`;
    }

    return { dateStr: datePart.trim(), dayOfWeek: dow };
  });
}

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
 * Event Phase - Extracts and validates event/date information
 */
export class EventPhase extends BasePhase<EventPhaseResult> {
  readonly phaseName = 'event' as const;
  private searchService?: SearchService;

  constructor(
    visionProvider: VisionModelProvider,
    phaseManager: PhaseManager,
    searchService?: SearchService
  ) {
    super(visionProvider, phaseManager);
    this.searchService = searchService;
  }

  /**
   * Execute event extraction phase
   */
  async execute(input: PhaseInput): Promise<EventPhaseResult> {
    const startTime = Date.now();

    try {
      // Get context from previous phases
      const posterType = this.getPosterType(input.context);
      const artistResult = input.context.phaseResults.get('artist') as ArtistPhaseResult | undefined;
      const venueResult = input.context.phaseResults.get('venue') as VenuePhaseResult | undefined;

      this.log('info', `Starting event extraction for ${input.posterId} (type: ${posterType})`);

      // Step 1: Get type-specific prompt
      const prompt = EVENT_PROMPTS[posterType] || EVENT_PROMPTS['unknown'];

      // Step 2: Extract event information
      const extraction = await this.visionProvider.extractFromImage(
        input.imagePath,
        prompt
      );

      // Step 3: Parse the response
      const parsed = this.parseJsonResponse(extraction.extracted_text);

      // Step 4: Extract shows (multi-date aware) with fallback to single date
      const sharedYear = this.extractYear(parsed.year);
      const shows = this.extractShows(parsed, posterType, sharedYear);

      // Primary date is the first show's date (backward compatible)
      const dateInfo = shows.length > 0 ? shows[0].date : this.extractDateInfo(parsed, posterType);

      // Step 5: Extract shared time and additional details
      const timeDetails = this.extractTimeDetails(parsed);
      const ticketPrice = this.normalizeString(parsed.ticket_price);
      const ageRestriction = this.normalizeString(parsed.age_restriction);
      const promoter = this.normalizeString(parsed.promoter);

      // Step 6: Validate temporal plausibility
      const primaryYear = dateInfo?.year ?? sharedYear;
      let artistActiveValidation: { valid: boolean; message?: string } | undefined;
      let venueExistsValidation: { valid: boolean; message?: string } | undefined;

      if (input.options.validateEvents && primaryYear) {
        // Validate artist was active during this period
        if (artistResult?.headliner) {
          artistActiveValidation = await this.validateArtistActive(
            artistResult.headliner.validatedName ?? artistResult.headliner.extractedName,
            primaryYear
          );
        }

        // Validate venue existed at this time
        if (venueResult?.venue) {
          venueExistsValidation = await this.validateVenueExists(
            venueResult.venue.validatedName ?? venueResult.venue.extractedName,
            primaryYear
          );
        }
      }

      // Step 7: Calculate decade
      const decade = primaryYear
        ? `${Math.floor(primaryYear / 10) * 10}s`
        : undefined;

      // Step 8: Calculate confidence
      const confidence = this.calculateEventConfidence(
        dateInfo,
        timeDetails,
        posterType,
        artistActiveValidation,
        venueExistsValidation
      );

      // Step 9: Determine readiness
      const readyForAssembly = confidence >= (input.options.confidenceThreshold ?? 0.5) ||
        this.isDateOptionalForType(posterType);

      const result: EventPhaseResult = {
        posterId: input.posterId,
        imagePath: input.imagePath,
        phase: 'event',
        status: readyForAssembly ? 'completed' : 'needs_review',
        confidence,
        processingTimeMs: Date.now() - startTime,
        posterType,
        eventDate: dateInfo,
        shows: shows.length > 0 ? shows : undefined,
        year: primaryYear,
        decade,
        timeDetails: timeDetails.doorTime || timeDetails.showTime ? timeDetails : undefined,
        ticketPrice,
        ageRestriction,
        promoter,
        artistActiveValidation,
        venueExistsValidation,
        readyForAssembly,
        warnings: this.generateWarnings(dateInfo, artistActiveValidation, venueExistsValidation),
      };

      // Store result
      this.phaseManager.storePhaseResult(input.context.sessionId, result);

      const showCount = shows.length;
      this.log('info', `Event extraction complete: ${showCount} show(s), ${dateInfo?.rawValue ?? 'no date'} (${Math.round(confidence * 100)}%)`);

      return result;
    } catch (error) {
      return this.handleError(input, error, startTime);
    }
  }

  /**
   * Get the raw date string from the parsed vision model response based on poster type.
   * Does NOT parse it — just returns the string for further processing.
   */
  private getRawDateString(
    parsed: Record<string, unknown>,
    posterType: PosterType
  ): string | undefined {
    switch (posterType) {
      case 'album':
      case 'film':
        return this.normalizeString(parsed.release_date);
      case 'theater':
      case 'exhibition':
        return this.normalizeString(parsed.opening_date);
      case 'festival':
        return this.normalizeString(parsed.start_date);
      default:
        return this.normalizeString(parsed.event_date);
    }
  }

  /**
   * Extract and parse date information
   */
  private extractDateInfo(
    parsed: Record<string, unknown>,
    posterType: PosterType
  ): DateInfo | undefined {
    // Try to get raw date value based on poster type
    const rawDate = this.getRawDateString(parsed, posterType);

    // Also check for year directly
    let year = this.extractYear(parsed.year);

    if (!rawDate && !year) {
      return undefined;
    }

    // Parse the date
    const parsedDate = rawDate ? this.parseDate(rawDate) : undefined;

    // Use extracted year if parsed date doesn't have one
    if (!parsedDate?.year && year) {
      if (parsedDate) {
        parsedDate.year = year;
      }
    }

    if (parsedDate) {
      return parsedDate;
    }

    // If we only have a year
    if (year) {
      return {
        rawValue: String(year),
        year,
        confidence: 0.6,
        format: 'year_only',
      };
    }

    return undefined;
  }

  /**
   * Extract multiple shows from the vision model response.
   * Falls back to single-date extraction if no "shows" array is present.
   * When a single concatenated date string is found (e.g., "Fri 27 & Sat 28 April"),
   * splits it into individual shows using separator semantics.
   * Creates a show even for year-only data.
   */
  private extractShows(
    parsed: Record<string, unknown>,
    posterType: PosterType,
    sharedYear?: number
  ): ShowInfo[] {
    const shows: ShowInfo[] = [];

    // Try new array format first (from updated prompts)
    if (Array.isArray(parsed.shows)) {
      for (let i = 0; i < (parsed.shows as unknown[]).length; i++) {
        const showData = (parsed.shows as Record<string, unknown>[])[i];
        if (!showData) continue;

        const rawDate = this.normalizeString(showData.event_date);
        if (rawDate) {
          // Try splitting in case the model put a multi-date string in a single show entry
          const splitDates = splitMultiDateString(rawDate);
          for (const { dateStr, dayOfWeek } of splitDates) {
            const dateInfo = this.parseDate(dateStr);
            if (dateInfo) {
              if (!dateInfo.year && sharedYear) {
                dateInfo.year = sharedYear;
              }
              shows.push({
                date: dateInfo,
                dayOfWeek: dayOfWeek ?? this.normalizeString(showData.day_of_week),
                doorTime: this.normalizeString(showData.door_time),
                showTime: this.normalizeString(showData.show_time),
                ticketPrice: this.normalizeString(showData.ticket_price),
                ageRestriction: this.normalizeString(showData.age_restriction),
                showNumber: shows.length + 1,
              });
            }
          }
        }
      }
    }

    // If shows array produced results, return them
    if (shows.length > 0) {
      return shows;
    }

    // Fallback: get raw date string and try multi-date splitting
    const rawDateStr = this.getRawDateString(parsed, posterType);
    const sharedTimeDetails = {
      doorTime: this.normalizeString(parsed.door_time || parsed.doors),
      showTime: this.normalizeString(parsed.show_time || parsed.showtimes),
      ticketPrice: this.normalizeString(parsed.ticket_price),
      ageRestriction: this.normalizeString(parsed.age_restriction),
    };

    if (rawDateStr) {
      const splitDates = splitMultiDateString(rawDateStr);

      for (const { dateStr, dayOfWeek } of splitDates) {
        const dateInfo = this.parseDate(dateStr);
        if (dateInfo) {
          if (!dateInfo.year && sharedYear) {
            dateInfo.year = sharedYear;
          }
          shows.push({
            date: dateInfo,
            dayOfWeek: dayOfWeek,
            ...sharedTimeDetails,
            showNumber: shows.length + 1,
          });
        }
      }

      if (shows.length > 0) {
        return shows;
      }
    }

    // If splitting didn't help, try the original single-date extraction
    const dateInfo = this.extractDateInfo(parsed, posterType);
    if (dateInfo) {
      if (!dateInfo.year && sharedYear) {
        dateInfo.year = sharedYear;
      }
      shows.push({
        date: dateInfo,
        ...sharedTimeDetails,
        showNumber: 1,
      });
      return shows;
    }

    // Last resort: year-only show - still create a Show entity
    if (sharedYear) {
      shows.push({
        date: {
          rawValue: String(sharedYear),
          year: sharedYear,
          confidence: 0.6,
          format: 'year_only',
        },
        showNumber: 1,
      });
    }

    return shows;
  }

  /**
   * Extract year from value
   */
  private extractYear(value: unknown): number | undefined {
    if (typeof value === 'number') {
      if (value >= 1960 && value <= 2030) {
        return value;
      }
    }

    if (typeof value === 'string') {
      const match = value.match(/\b(19[6-9]\d|20[0-2]\d)\b/);
      if (match) {
        return parseInt(match[1], 10);
      }
    }

    return undefined;
  }

  /**
   * Parse a date string into DateInfo
   */
  private parseDate(dateStr: string): DateInfo | undefined {
    const lowerDate = dateStr.toLowerCase().trim();

    for (const pattern of DATE_PATTERNS) {
      const match = lowerDate.match(pattern.regex);
      if (match) {
        const result: DateInfo = {
          rawValue: dateStr,
          confidence: 0.7,
          format: 'parsed',
        };

        for (let i = 0; i < pattern.order.length; i++) {
          const field = pattern.order[i];
          const value = match[i + 1];

          if (!value) continue;

          switch (field) {
            case 'year': {
              let year = parseInt(value, 10);
              if (year < 100) {
                year += year > 30 ? 1900 : 2000;
              }
              result.year = year;
              break;
            }
            case 'month':
              result.month = parseInt(value, 10);
              break;
            case 'day':
              result.day = parseInt(value, 10);
              break;
            case 'month_name':
              result.month = MONTH_NAMES[value.toLowerCase()];
              break;
          }
        }

        // Try to construct a Date object
        if (result.year && result.month && result.day) {
          const date = new Date(result.year, result.month - 1, result.day);
          if (!isNaN(date.getTime())) {
            result.parsed = date;
            result.confidence = 0.9;
          }
        }

        return result;
      }
    }

    return undefined;
  }

  /**
   * Extract time details
   */
  private extractTimeDetails(parsed: Record<string, unknown>): {
    doorTime?: string;
    showTime?: string;
  } {
    const doorTime = this.normalizeTime(parsed.door_time || parsed.doors);
    const showTime = this.normalizeTime(parsed.show_time || parsed.showtimes);

    return { doorTime, showTime };
  }

  /**
   * Normalize time string
   */
  private normalizeTime(value: unknown): string | undefined {
    if (!value) return undefined;

    const str = String(value).trim();
    if (!str) return undefined;

    // Handle array of times (multiple showtimes)
    if (Array.isArray(value)) {
      return value.map(t => String(t).trim()).join(', ');
    }

    // Basic time validation
    if (str.match(/\d{1,2}(:\d{2})?\s*(am|pm)?/i)) {
      return str;
    }

    return str;
  }

  /**
   * Validate that artist was active during the time period
   */
  private async validateArtistActive(
    artistName: string,
    year: number
  ): Promise<{ valid: boolean; message?: string }> {
    if (!this.searchService) {
      return { valid: true, message: 'Validation skipped - no search service' };
    }

    try {
      // Search for other posters with this artist - returns ScoredEntity[] directly
      const results = await this.searchService.search(artistName, {
        entityTypes: ['Poster'],
        limit: 20,
      });

      if (!results || results.length === 0) {
        return { valid: true, message: 'No historical data to validate' };
      }

      // Check year range of artist activity
      const years: number[] = [];
      for (const scoredEntity of results) {
        // ScoredEntity extends Entity, so observations are directly on scoredEntity
        if ('observations' in scoredEntity && Array.isArray(scoredEntity.observations)) {
          for (const obs of scoredEntity.observations) {
            const yearMatch = obs.match(/year:\s*(\d{4})/i);
            if (yearMatch) {
              years.push(parseInt(yearMatch[1], 10));
            }
          }
        }
      }

      if (years.length === 0) {
        return { valid: true, message: 'No year data to validate' };
      }

      const minYear = Math.min(...years);
      const maxYear = Math.max(...years);

      // Allow some buffer for activity
      if (year >= minYear - 5 && year <= maxYear + 10) {
        return {
          valid: true,
          message: `Artist active from ${minYear} to ${maxYear}`,
        };
      }

      return {
        valid: false,
        message: `Year ${year} outside known activity range (${minYear}-${maxYear})`,
      };
    } catch {
      return { valid: true, message: 'Validation error, assuming valid' };
    }
  }

  /**
   * Validate that venue existed during the time period
   */
  private async validateVenueExists(
    venueName: string,
    year: number
  ): Promise<{ valid: boolean; message?: string }> {
    if (!this.searchService) {
      return { valid: true, message: 'Validation skipped - no search service' };
    }

    try {
      // Search for other posters at this venue - returns ScoredEntity[] directly
      const results = await this.searchService.search(venueName, {
        entityTypes: ['Poster', 'Venue'],
        limit: 20,
      });

      if (!results || results.length === 0) {
        return { valid: true, message: 'No historical data to validate' };
      }

      // Check year range of venue activity
      const years: number[] = [];
      for (const scoredEntity of results) {
        // ScoredEntity extends Entity, so observations are directly on scoredEntity
        if ('observations' in scoredEntity && Array.isArray(scoredEntity.observations)) {
          for (const obs of scoredEntity.observations) {
            const yearMatch = obs.match(/year:\s*(\d{4})/i);
            if (yearMatch) {
              years.push(parseInt(yearMatch[1], 10));
            }
          }
        }
      }

      if (years.length === 0) {
        return { valid: true, message: 'No year data to validate' };
      }

      const minYear = Math.min(...years);
      const maxYear = Math.max(...years);

      if (year >= minYear && year <= maxYear + 20) {
        return {
          valid: true,
          message: `Venue active from ${minYear} to ${maxYear}`,
        };
      }

      return {
        valid: false,
        message: `Year ${year} may be outside venue activity (${minYear}-${maxYear})`,
      };
    } catch {
      return { valid: true, message: 'Validation error, assuming valid' };
    }
  }

  /**
   * Check if date is optional for poster type
   */
  private isDateOptionalForType(posterType: PosterType): boolean {
    return ['promo', 'unknown'].includes(posterType);
  }

  /**
   * Calculate confidence for event extraction
   */
  private calculateEventConfidence(
    dateInfo?: DateInfo,
    timeDetails?: { doorTime?: string; showTime?: string },
    posterType?: PosterType,
    artistValidation?: { valid: boolean },
    venueValidation?: { valid: boolean }
  ): number {
    // Base score from date extraction
    let score = dateInfo?.confidence ?? 0;

    if (!dateInfo && posterType && this.isDateOptionalForType(posterType)) {
      score = 0.5;
    }

    // Bonus for time details
    if (timeDetails?.doorTime || timeDetails?.showTime) {
      score += 0.1;
    }

    // Penalty for validation failures
    if (artistValidation && !artistValidation.valid) {
      score -= 0.15;
    }
    if (venueValidation && !venueValidation.valid) {
      score -= 0.1;
    }

    // Bonus for full date (year, month, day)
    if (dateInfo?.parsed) {
      score += 0.1;
    }

    return Math.max(0, Math.min(score, 1.0));
  }

  /**
   * Generate warnings for event extraction
   */
  private generateWarnings(
    dateInfo?: DateInfo,
    artistValidation?: { valid: boolean; message?: string },
    venueValidation?: { valid: boolean; message?: string }
  ): string[] | undefined {
    const warnings: string[] = [];

    if (!dateInfo) {
      warnings.push('No date information extracted');
    } else if (!dateInfo.year) {
      warnings.push('Year not identified');
    }

    if (artistValidation && !artistValidation.valid) {
      warnings.push(`Artist activity validation: ${artistValidation.message}`);
    }

    if (venueValidation && !venueValidation.valid) {
      warnings.push(`Venue existence validation: ${venueValidation.message}`);
    }

    return warnings.length > 0 ? warnings : undefined;
  }
}
