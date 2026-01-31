/**
 * Centralized date formatting utilities with locale support
 * Handles US/AU format conflicts and provides consistent date formatting
 */

export interface DateFormatConfig {
  locale: string;
  timezone: string;
  dateStyle: 'short' | 'medium' | 'long' | 'full';
  timeStyle: 'short' | 'medium' | 'long' | 'full';
  customFormat?: Intl.DateTimeFormatOptions;
}

export interface DateDisplayOptions {
  locale?: string;
  timezone?: string;
  format?: 'short' | 'medium' | 'long' | 'full' | 'iso' | 'timestamp';
  includeTime?: boolean;
  customOptions?: Intl.DateTimeFormatOptions;
}

/**
 * Default date format configurations for common locales
 */
export const DEFAULT_DATE_CONFIGS: Record<string, DateFormatConfig> = {
  'en-US': {
    locale: 'en-US',
    timezone: 'America/New_York',
    dateStyle: 'short', // MM/dd/yyyy
    timeStyle: 'short'
  },
  'en-AU': {
    locale: 'en-AU', 
    timezone: 'Australia/Sydney',
    dateStyle: 'short', // dd/MM/yyyy
    timeStyle: 'short'
  },
  'en-GB': {
    locale: 'en-GB',
    timezone: 'Europe/London', 
    dateStyle: 'short', // dd/MM/yyyy
    timeStyle: 'short'
  }
};

/**
 * Global date formatter configuration
 */
let globalDateConfig: DateFormatConfig = DEFAULT_DATE_CONFIGS['en-AU']; // Default to AU

/**
 * Set the global date format configuration
 * @param config Date format configuration
 */
export function setGlobalDateConfig(config: Partial<DateFormatConfig>): void {
  globalDateConfig = {
    ...globalDateConfig,
    ...config
  };
}

/**
 * Get the current global date configuration
 * @returns Current date format configuration
 */
export function getGlobalDateConfig(): DateFormatConfig {
  return { ...globalDateConfig };
}

/**
 * Initialize date formatter from environment variables
 */
export function initializeDateFormatterFromEnv(): void {
  const locale = process.env.DATE_LOCALE || 'en-AU';
  const timezone = process.env.DATE_TIMEZONE || 'Australia/Melbourne';
  const dateStyle = (process.env.DATE_STYLE as 'short' | 'medium' | 'long' | 'full') || 'short';
  const timeStyle = (process.env.TIME_STYLE as 'short' | 'medium' | 'long' | 'full') || 'short';
  
  const config = DEFAULT_DATE_CONFIGS[locale] || DEFAULT_DATE_CONFIGS['en-AU'];
  
  setGlobalDateConfig({
    ...config,
    locale,
    timezone,
    dateStyle,
    timeStyle
  });
}

/**
 * Format a timestamp or Date object using the global configuration
 * @param dateInput Timestamp (number) or Date object
 * @param options Optional formatting options to override global config
 * @returns Formatted date string
 */
export function formatDate(
  dateInput: number | Date | string,
  options: DateDisplayOptions = {}
): string {
  try {
    // Handle different input types
    let date: Date;
    if (typeof dateInput === 'number') {
      date = new Date(dateInput);
    } else if (typeof dateInput === 'string') {
      date = new Date(dateInput);
    } else {
      date = dateInput;
    }

    // Validate date
    if (isNaN(date.getTime())) {
      return 'Invalid Date';
    }

    const config = getGlobalDateConfig();
    const locale = options.locale || config.locale;
    const timezone = options.timezone || config.timezone;

    // Handle special format types
    if (options.format === 'iso') {
      return date.toISOString();
    }
    
    if (options.format === 'timestamp') {
      return date.getTime().toString();
    }

    // Determine formatting options
    let formatOptions: Intl.DateTimeFormatOptions = {
      timeZone: timezone
    };

    if (options.customOptions) {
      formatOptions = { ...formatOptions, ...options.customOptions };
    } else if (options.format) {
      // Use predefined format styles
      switch (options.format) {
        case 'short':
          formatOptions.dateStyle = 'short';
          if (options.includeTime) {
            formatOptions.timeStyle = 'short';
          }
          break;
        case 'medium':
          formatOptions.dateStyle = 'medium';
          if (options.includeTime) {
            formatOptions.timeStyle = 'medium';
          }
          break;
        case 'long':
          formatOptions.dateStyle = 'long';
          if (options.includeTime) {
            formatOptions.timeStyle = 'long';
          }
          break;
        case 'full':
          formatOptions.dateStyle = 'full';
          if (options.includeTime) {
            formatOptions.timeStyle = 'full';
          }
          break;
      }
    } else {
      // Use global configuration
      formatOptions.dateStyle = config.dateStyle;
      if (options.includeTime) {
        formatOptions.timeStyle = config.timeStyle;
      }
      if (config.customFormat) {
        formatOptions = { ...formatOptions, ...config.customFormat };
      }
    }

    // Format the date
    return new Intl.DateTimeFormat(locale, formatOptions).format(date);
  } catch (error) {
    console.error('Error formatting date:', error);
    return 'Date Format Error';
  }
}

/**
 * Format date for display in search results and API responses
 * @param dateInput Timestamp or Date object
 * @param includeTime Whether to include time information
 * @returns Formatted date string using global configuration
 */
export function formatDateForDisplay(dateInput: number | Date, includeTime = false): string {
  return formatDate(dateInput, { includeTime });
}

/**
 * Format date for storage (always returns timestamp)
 * @param dateInput Date input in various formats
 * @returns Timestamp number for consistent storage
 */
export function formatDateForStorage(dateInput: number | Date | string): number {
  try {
    let date: Date;
    if (typeof dateInput === 'number') {
      return dateInput; // Already a timestamp
    } else if (typeof dateInput === 'string') {
      date = new Date(dateInput);
    } else {
      date = dateInput;
    }

    if (isNaN(date.getTime())) {
      return Date.now(); // Fallback to current time
    }

    return date.getTime();
  } catch (error) {
    console.error('Error formatting date for storage:', error);
    return Date.now();
  }
}

/**
 * Parse date input in various formats with locale awareness
 * @param dateInput Date string that might be in different locale formats
 * @param sourceLocale Optional source locale hint
 * @returns Date object or null if parsing fails
 */
export function parseDateWithLocale(dateInput: string, sourceLocale?: string): Date | null {
  try {
    // First try standard parsing
    let date = new Date(dateInput);
    if (!isNaN(date.getTime())) {
      return date;
    }

    // Try parsing with common locale-specific formats
    const config = getGlobalDateConfig();
    const locale = sourceLocale || config.locale;

    // Handle common date formats for different locales
    if (locale.includes('AU') || locale.includes('GB')) {
      // Try DD/MM/YYYY or DD-MM-YYYY formats
      const ddmmFormats = [
        /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/,
        /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})$/
      ];

      for (const format of ddmmFormats) {
        const match = dateInput.match(format);
        if (match) {
          const [, day, month, year] = match;
          const fullYear = year.length === 2 ? `20${year}` : year;
          date = new Date(`${month}/${day}/${fullYear}`);
          if (!isNaN(date.getTime())) {
            return date;
          }
        }
      }
    } else {
      // US format - MM/DD/YYYY should parse normally
      date = new Date(dateInput);
      if (!isNaN(date.getTime())) {
        return date;
      }
    }

    return null;
  } catch (error) {
    console.error('Error parsing date with locale:', error);
    return null;
  }
}

/**
 * Get current timestamp formatted according to global configuration
 * @returns Current timestamp as formatted string
 */
export function getCurrentFormattedTimestamp(): string {
  return formatDate(Date.now(), { includeTime: true });
}

/**
 * Format a timestamp for API responses with consistent formatting
 * @param timestamp Timestamp to format
 * @returns Formatted timestamp for API responses
 */
export function formatTimestampForAPI(timestamp: number): {
  timestamp: number;
  formatted: string;
  iso: string;
} {
  const date = new Date(timestamp);
  return {
    timestamp,
    formatted: formatDate(timestamp, { includeTime: true }),
    iso: date.toISOString()
  };
}

/**
 * Validate if a date string matches the expected locale format
 * @param dateString Date string to validate
 * @param expectedLocale Expected locale format
 * @returns True if format matches expectations
 */
export function validateDateFormat(dateString: string, expectedLocale?: string): boolean {
  try {
    const config = getGlobalDateConfig();
    const locale = expectedLocale || config.locale;
    
    const parsed = parseDateWithLocale(dateString, locale);
    if (!parsed) {
      return false;
    }

    // Format the parsed date back and see if it's reasonable
    const reformatted = formatDate(parsed, { format: 'short' });
    return reformatted !== 'Invalid Date' && reformatted !== 'Date Format Error';
  } catch {
    return false;
  }
}
