/**
 * Venue Validator
 *
 * Validates venue names and location data for consistency.
 * Uses internal validation since there's no comprehensive public venue API.
 */

import { PosterEntity } from '../../image-processor/types.js';
import { ValidatorResult, ValidationContext } from '../types.js';
import { BaseValidator } from './BaseValidator.js';
import { combinedSimilarity, normalizeString } from '../utils/stringMatching.js';

/**
 * Common venue name patterns that indicate validity
 */
const VENUE_PATTERNS = [
  /\b(theater|theatre|hall|arena|stadium|club|bar|pub|lounge|room|house|center|centre|pavilion|amphitheater|amphitheatre|ballroom|auditorium|coliseum|colosseum|garden|gardens|field|park|bowl|dome|complex|venue|showroom|cabaret|café|cafe|tavern|saloon|brewery|winery|civic|memorial|convention|forum|palace|royal|grand|metro|underground|basement|loft|warehouse|factory|mill|church|cathedral|temple|chapel)\b/i,
];

/**
 * US State abbreviations for validation
 */
const US_STATES: Record<string, string> = {
  'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas',
  'CA': 'California', 'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware',
  'FL': 'Florida', 'GA': 'Georgia', 'HI': 'Hawaii', 'ID': 'Idaho',
  'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa', 'KS': 'Kansas',
  'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine', 'MD': 'Maryland',
  'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota', 'MS': 'Mississippi',
  'MO': 'Missouri', 'MT': 'Montana', 'NE': 'Nebraska', 'NV': 'Nevada',
  'NH': 'New Hampshire', 'NJ': 'New Jersey', 'NM': 'New Mexico', 'NY': 'New York',
  'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio', 'OK': 'Oklahoma',
  'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island', 'SC': 'South Carolina',
  'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas', 'UT': 'Utah',
  'VT': 'Vermont', 'VA': 'Virginia', 'WA': 'Washington', 'WV': 'West Virginia',
  'WI': 'Wisconsin', 'WY': 'Wyoming', 'DC': 'District of Columbia',
};

/**
 * Canadian provinces
 */
const CA_PROVINCES: Record<string, string> = {
  'AB': 'Alberta', 'BC': 'British Columbia', 'MB': 'Manitoba',
  'NB': 'New Brunswick', 'NL': 'Newfoundland and Labrador',
  'NS': 'Nova Scotia', 'NT': 'Northwest Territories', 'NU': 'Nunavut',
  'ON': 'Ontario', 'PE': 'Prince Edward Island', 'QC': 'Quebec',
  'SK': 'Saskatchewan', 'YT': 'Yukon',
};

/**
 * Common cities for rough location validation
 */
const MAJOR_CITIES = new Set([
  'new york', 'los angeles', 'chicago', 'houston', 'phoenix', 'philadelphia',
  'san antonio', 'san diego', 'dallas', 'san jose', 'austin', 'jacksonville',
  'san francisco', 'columbus', 'fort worth', 'indianapolis', 'charlotte',
  'seattle', 'denver', 'washington', 'boston', 'el paso', 'detroit', 'nashville',
  'portland', 'memphis', 'oklahoma city', 'las vegas', 'louisville', 'baltimore',
  'milwaukee', 'albuquerque', 'tucson', 'fresno', 'sacramento', 'atlanta',
  'kansas city', 'miami', 'oakland', 'minneapolis', 'cleveland', 'orlando',
  // International
  'london', 'paris', 'berlin', 'tokyo', 'sydney', 'melbourne', 'toronto',
  'vancouver', 'montreal', 'amsterdam', 'barcelona', 'madrid', 'rome',
  'dublin', 'manchester', 'birmingham', 'glasgow', 'edinburgh', 'liverpool',
]);

/**
 * Validates venue names and location consistency
 */
export class VenueValidator extends BaseValidator {
  readonly name = 'venue' as const;
  readonly supportedEntityTypes = ['Poster', 'Venue'];
  readonly supportedFields = ['venue_name', 'city', 'state', 'country'];

  /**
   * Validate venue-related fields
   */
  async validate(
    entity: PosterEntity,
    _context: ValidationContext
  ): Promise<ValidatorResult[]> {
    const results: ValidatorResult[] = [];

    // Validate venue name
    if (!this.isEmpty(entity.venue_name)) {
      results.push(this.validateVenueName(entity.venue_name!));
    }

    // Validate city
    if (!this.isEmpty(entity.city)) {
      results.push(this.validateCity(entity.city!));
    }

    // Validate state
    if (!this.isEmpty(entity.state)) {
      results.push(this.validateState(entity.state!, entity.country));
    }

    // Validate location consistency
    if (entity.city && entity.state) {
      const consistencyResult = this.validateLocationConsistency(
        entity.city,
        entity.state,
        entity.country
      );
      if (consistencyResult) {
        results.push(consistencyResult);
      }
    }

    return results;
  }

  /**
   * Validate a venue name
   */
  private validateVenueName(venueName: string): ValidatorResult {
    const normalized = normalizeString(venueName);

    // Check if it matches common venue patterns
    const hasVenueKeyword = VENUE_PATTERNS.some(pattern => pattern.test(venueName));

    // Check for suspicious patterns (might be date or artist confused as venue)
    const suspiciousPatterns = [
      /^\d{4}$/,                        // Just a year
      /^(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d/i,
      /^\d{1,2}[\/\-]\d{1,2}/,         // Looks like a date
    ];

    const isSuspicious = suspiciousPatterns.some(p => p.test(venueName));

    if (isSuspicious) {
      return this.createResult('venue_name', venueName, {
        confidence: 0.3,
        status: 'mismatch',
        source: 'internal',
        message: `"${venueName}" appears to be a date or other non-venue text`,
      });
    }

    // Calculate confidence based on venue-like characteristics
    let confidence = 0.5; // Base confidence

    if (hasVenueKeyword) {
      confidence += 0.4;
    }

    // Penalize very short names
    if (normalized.length < 3) {
      confidence -= 0.2;
    }

    // Penalize names that are all caps (might be OCR error)
    if (venueName === venueName.toUpperCase() && venueName.length > 3) {
      confidence -= 0.1;
    }

    // Boost for "The" prefix (common in venue names)
    if (/^the\s/i.test(venueName)) {
      confidence += 0.1;
    }

    confidence = Math.max(0, Math.min(1, confidence));

    const status = confidence >= 0.7 ? 'match' : confidence >= 0.5 ? 'partial' : 'unverified';

    return this.createResult('venue_name', venueName, {
      validatedValue: venueName,
      confidence,
      status,
      source: 'internal',
      message: hasVenueKeyword
        ? `Venue name contains recognized venue type keyword`
        : `Venue name format appears valid`,
    });
  }

  /**
   * Validate a city name
   */
  private validateCity(city: string): ValidatorResult {
    const normalized = normalizeString(city).toLowerCase();

    // Check if it's a known major city
    const isKnownCity = MAJOR_CITIES.has(normalized);

    // Basic format validation
    const isValidFormat = /^[a-zA-Z\s\-'\.]+$/.test(city) && city.length >= 2;

    let confidence = 0.5;

    if (isKnownCity) {
      confidence = 0.95;
    } else if (isValidFormat) {
      confidence = 0.7;
    } else {
      confidence = 0.4;
    }

    const status = confidence >= 0.8 ? 'match' : confidence >= 0.5 ? 'partial' : 'unverified';

    return this.createResult('city', city, {
      validatedValue: city,
      confidence,
      status,
      source: 'internal',
      message: isKnownCity
        ? `Recognized city: "${city}"`
        : `City name format appears valid`,
    });
  }

  /**
   * Validate a state/province
   */
  private validateState(state: string, country?: string): ValidatorResult {
    const normalized = state.toUpperCase().trim();

    // Check US states
    if (US_STATES[normalized]) {
      return this.createResult('state', state, {
        validatedValue: US_STATES[normalized],
        confidence: 0.95,
        status: 'match',
        source: 'internal',
        message: `Valid US state: ${US_STATES[normalized]}`,
      });
    }

    // Check Canadian provinces
    if (CA_PROVINCES[normalized]) {
      return this.createResult('state', state, {
        validatedValue: CA_PROVINCES[normalized],
        confidence: 0.95,
        status: 'match',
        source: 'internal',
        message: `Valid Canadian province: ${CA_PROVINCES[normalized]}`,
      });
    }

    // Check if full state name
    const fullNameMatch = Object.entries(US_STATES).find(
      ([, name]) => normalizeString(name) === normalizeString(state)
    );

    if (fullNameMatch) {
      return this.createResult('state', state, {
        validatedValue: fullNameMatch[1],
        confidence: 0.95,
        status: 'match',
        source: 'internal',
        message: `Valid US state: ${fullNameMatch[1]}`,
      });
    }

    // For non-US/CA, just validate format
    const isValidFormat = /^[a-zA-Z\s\-]+$/.test(state) && state.length >= 2;

    return this.createResult('state', state, {
      validatedValue: state,
      confidence: isValidFormat ? 0.6 : 0.3,
      status: isValidFormat ? 'partial' : 'unverified',
      source: 'internal',
      message: isValidFormat
        ? `State/province format appears valid`
        : `Could not validate state/province`,
    });
  }

  /**
   * Check if city and state are consistent
   */
  private validateLocationConsistency(
    city: string,
    state: string,
    country?: string
  ): ValidatorResult | null {
    // This is a simplified check - a real implementation would use a location database

    // Check for obvious mismatches (city name in wrong field)
    const cityNormalized = normalizeString(city).toLowerCase();
    const stateNormalized = state.toUpperCase().trim();

    // If city looks like a state abbreviation
    if (US_STATES[cityNormalized.toUpperCase()] || CA_PROVINCES[cityNormalized.toUpperCase()]) {
      return this.createResult('city', city, {
        confidence: 0.3,
        status: 'mismatch',
        source: 'internal',
        message: `"${city}" appears to be a state/province, not a city`,
        validatedValue: state, // Suggest swap
      });
    }

    // If state looks like it should be a city
    if (MAJOR_CITIES.has(stateNormalized.toLowerCase())) {
      return this.createResult('state', state, {
        confidence: 0.3,
        status: 'mismatch',
        source: 'internal',
        message: `"${state}" appears to be a city, not a state`,
        validatedValue: city, // Suggest swap
      });
    }

    return null;
  }

  /**
   * Health check - always passes since this is internal validation
   */
  async healthCheck(): Promise<boolean> {
    return true;
  }
}
