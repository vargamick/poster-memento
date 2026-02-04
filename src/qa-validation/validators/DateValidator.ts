/**
 * Date Validator
 *
 * Validates date-related fields for format consistency and logical validity.
 */

import { PosterEntity } from '../../image-processor/types.js';
import { ValidatorResult, ValidationContext } from '../types.js';
import { BaseValidator } from './BaseValidator.js';

/**
 * Month names for parsing
 */
const MONTHS: Record<string, number> = {
  'january': 1, 'jan': 1,
  'february': 2, 'feb': 2,
  'march': 3, 'mar': 3,
  'april': 4, 'apr': 4,
  'may': 5,
  'june': 6, 'jun': 6,
  'july': 7, 'jul': 7,
  'august': 8, 'aug': 8,
  'september': 9, 'sep': 9, 'sept': 9,
  'october': 10, 'oct': 10,
  'november': 11, 'nov': 11,
  'december': 12, 'dec': 12,
};

/**
 * Day names for validation
 */
const DAYS_OF_WEEK = [
  'sunday', 'monday', 'tuesday', 'wednesday',
  'thursday', 'friday', 'saturday',
  'sun', 'mon', 'tue', 'tues', 'wed', 'thu', 'thur', 'thurs', 'fri', 'sat',
];

/**
 * Parsed date result
 */
interface ParsedDate {
  year?: number;
  month?: number;
  day?: number;
  dayOfWeek?: string;
  raw: string;
}

/**
 * Validates date-related fields for consistency
 */
export class DateValidator extends BaseValidator {
  readonly name = 'date' as const;
  readonly supportedEntityTypes = ['Poster', 'Event'];
  readonly supportedFields = ['event_date', 'year', 'decade', 'door_time', 'show_time'];

  /**
   * Validate date-related fields
   */
  async validate(
    entity: PosterEntity,
    _context: ValidationContext
  ): Promise<ValidatorResult[]> {
    const results: ValidatorResult[] = [];

    // Parse the event date
    let parsedDate: ParsedDate | null = null;
    if (!this.isEmpty(entity.event_date)) {
      parsedDate = this.parseDate(entity.event_date!);
      results.push(this.validateEventDate(entity.event_date!, parsedDate));
    }

    // Validate year
    if (entity.year !== undefined) {
      results.push(this.validateYear(entity.year, parsedDate));
    }

    // Validate decade consistency
    if (entity.decade && entity.year) {
      results.push(this.validateDecade(entity.decade, entity.year));
    }

    // Validate time formats
    if (!this.isEmpty(entity.door_time)) {
      results.push(this.validateTime(entity.door_time!, 'door_time'));
    }

    if (!this.isEmpty(entity.show_time)) {
      results.push(this.validateTime(entity.show_time!, 'show_time'));
    }

    // Validate door_time vs show_time order
    if (entity.door_time && entity.show_time) {
      const orderResult = this.validateTimeOrder(entity.door_time, entity.show_time);
      if (orderResult) {
        results.push(orderResult);
      }
    }

    return results;
  }

  /**
   * Parse a date string into components
   */
  private parseDate(dateStr: string): ParsedDate | null {
    const result: ParsedDate = { raw: dateStr };
    const lower = dateStr.toLowerCase();

    // Try to extract year (4-digit number)
    const yearMatch = dateStr.match(/\b(19|20)\d{2}\b/);
    if (yearMatch) {
      result.year = parseInt(yearMatch[0], 10);
    }

    // Try to extract month
    for (const [name, num] of Object.entries(MONTHS)) {
      if (lower.includes(name)) {
        result.month = num;
        break;
      }
    }

    // Try to extract day of month
    const dayMatch = dateStr.match(/\b([1-9]|[12]\d|3[01])(st|nd|rd|th)?\b/);
    if (dayMatch) {
      const day = parseInt(dayMatch[1], 10);
      if (day >= 1 && day <= 31) {
        result.day = day;
      }
    }

    // Try to extract day of week
    for (const day of DAYS_OF_WEEK) {
      if (lower.includes(day)) {
        result.dayOfWeek = day;
        break;
      }
    }

    return result;
  }

  /**
   * Validate the event date field
   */
  private validateEventDate(dateStr: string, parsed: ParsedDate | null): ValidatorResult {
    if (!parsed) {
      return this.createUnverifiedResult(
        'event_date',
        dateStr,
        'internal',
        `Could not parse date: "${dateStr}"`
      );
    }

    // Calculate confidence based on what we could extract
    let confidence = 0.3; // Base confidence
    const extractedParts: string[] = [];

    if (parsed.year) {
      confidence += 0.25;
      extractedParts.push(`year: ${parsed.year}`);
    }

    if (parsed.month) {
      confidence += 0.25;
      extractedParts.push(`month: ${parsed.month}`);
    }

    if (parsed.day) {
      confidence += 0.15;
      extractedParts.push(`day: ${parsed.day}`);
    }

    if (parsed.dayOfWeek) {
      confidence += 0.05;
      extractedParts.push(`day of week: ${parsed.dayOfWeek}`);
    }

    // Validate the date is logical
    if (parsed.month && parsed.day) {
      const daysInMonth = [0, 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      if (parsed.day > daysInMonth[parsed.month]) {
        return this.createResult('event_date', dateStr, {
          confidence: 0.3,
          status: 'mismatch',
          source: 'internal',
          message: `Invalid date: day ${parsed.day} is not valid for month ${parsed.month}`,
        });
      }
    }

    // Validate year is reasonable (not too far in past or future)
    if (parsed.year) {
      const currentYear = new Date().getFullYear();
      if (parsed.year < 1950 || parsed.year > currentYear + 2) {
        confidence -= 0.2;
      }
    }

    confidence = Math.max(0, Math.min(1, confidence));
    const status = confidence >= 0.7 ? 'match' : confidence >= 0.5 ? 'partial' : 'unverified';

    return this.createResult('event_date', dateStr, {
      validatedValue: dateStr,
      confidence,
      status,
      source: 'internal',
      message: extractedParts.length > 0
        ? `Extracted: ${extractedParts.join(', ')}`
        : `Date format not fully recognized`,
    });
  }

  /**
   * Validate the year field
   */
  private validateYear(year: number, parsedDate: ParsedDate | null): ValidatorResult {
    const currentYear = new Date().getFullYear();

    // Check if year is in reasonable range
    if (year < 1950) {
      return this.createResult('year', String(year), {
        confidence: 0.3,
        status: 'mismatch',
        source: 'internal',
        message: `Year ${year} seems too old for a poster`,
      });
    }

    if (year > currentYear + 2) {
      return this.createResult('year', String(year), {
        confidence: 0.3,
        status: 'mismatch',
        source: 'internal',
        message: `Year ${year} is too far in the future`,
      });
    }

    // Check consistency with parsed date
    if (parsedDate?.year && parsedDate.year !== year) {
      return this.createResult('year', String(year), {
        confidence: 0.4,
        status: 'mismatch',
        source: 'internal',
        validatedValue: String(parsedDate.year),
        message: `Year ${year} doesn't match year in event_date (${parsedDate.year})`,
      });
    }

    return this.createResult('year', String(year), {
      validatedValue: String(year),
      confidence: 0.9,
      status: 'match',
      source: 'internal',
      message: `Year ${year} is valid`,
    });
  }

  /**
   * Validate decade consistency with year
   */
  private validateDecade(decade: string, year: number): ValidatorResult {
    // Calculate expected decade
    const expectedDecade = `${Math.floor(year / 10) * 10}s`;

    // Normalize the provided decade
    const normalizedDecade = decade.replace(/[^0-9s]/gi, '').toLowerCase();

    if (normalizedDecade === expectedDecade.toLowerCase()) {
      return this.createResult('decade', decade, {
        validatedValue: expectedDecade,
        confidence: 0.95,
        status: 'match',
        source: 'internal',
        message: `Decade "${decade}" matches year ${year}`,
      });
    }

    return this.createResult('decade', decade, {
      validatedValue: expectedDecade,
      confidence: 0.3,
      status: 'mismatch',
      source: 'internal',
      message: `Decade "${decade}" doesn't match year ${year} (expected "${expectedDecade}")`,
    });
  }

  /**
   * Validate a time field
   */
  private validateTime(timeStr: string, field: string): ValidatorResult {
    // Common time formats
    const timePatterns = [
      /^(\d{1,2}):(\d{2})\s*(am|pm)?$/i,           // 7:00, 7:00 PM
      /^(\d{1,2})\s*(am|pm)$/i,                     // 7pm, 7 PM
      /^(\d{1,2}):(\d{2})$/,                        // 19:00 (24-hour)
      /^(\d{1,2})$/,                                // Just hour
    ];

    const lower = timeStr.toLowerCase().trim();

    for (const pattern of timePatterns) {
      const match = lower.match(pattern);
      if (match) {
        // Extract hour
        const hour = parseInt(match[1], 10);
        const isPM = match[3]?.toLowerCase() === 'pm' || (match[3] === undefined && hour >= 12);

        // Validate hour range
        let valid = true;
        if (hour < 0 || hour > 23) valid = false;
        if (match[2] && (parseInt(match[2], 10) < 0 || parseInt(match[2], 10) > 59)) valid = false;

        if (valid) {
          return this.createResult(field, timeStr, {
            validatedValue: timeStr,
            confidence: 0.9,
            status: 'match',
            source: 'internal',
            message: `Valid time format`,
          });
        }
      }
    }

    // Check for common variations
    if (/doors/i.test(timeStr) || /show/i.test(timeStr)) {
      return this.createResult(field, timeStr, {
        validatedValue: timeStr,
        confidence: 0.7,
        status: 'partial',
        source: 'internal',
        message: `Time field contains descriptive text`,
      });
    }

    return this.createResult(field, timeStr, {
      confidence: 0.4,
      status: 'unverified',
      source: 'internal',
      message: `Could not parse time format: "${timeStr}"`,
    });
  }

  /**
   * Validate that door time is before show time
   */
  private validateTimeOrder(doorTime: string, showTime: string): ValidatorResult | null {
    const parseTime = (str: string): number | null => {
      const match = str.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
      if (!match) return null;

      let hour = parseInt(match[1], 10);
      const minutes = match[2] ? parseInt(match[2], 10) : 0;
      const ampm = match[3]?.toLowerCase();

      // Convert to 24-hour
      if (ampm === 'pm' && hour !== 12) hour += 12;
      if (ampm === 'am' && hour === 12) hour = 0;

      return hour * 60 + minutes;
    };

    const doorMinutes = parseTime(doorTime);
    const showMinutes = parseTime(showTime);

    if (doorMinutes === null || showMinutes === null) {
      return null; // Can't compare
    }

    if (doorMinutes > showMinutes) {
      return this.createResult('door_time', doorTime, {
        confidence: 0.4,
        status: 'mismatch',
        source: 'internal',
        message: `Door time (${doorTime}) appears to be after show time (${showTime})`,
      });
    }

    return null; // Order is correct
  }

  /**
   * Health check - always passes since this is internal validation
   */
  async healthCheck(): Promise<boolean> {
    return true;
  }
}
