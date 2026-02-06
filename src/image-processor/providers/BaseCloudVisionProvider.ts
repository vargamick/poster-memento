/**
 * Base Cloud Vision Provider
 *
 * Shared functionality for cloud vision API providers including:
 * - Rate limiting (sliding window)
 * - Exponential backoff retry logic
 * - Image base64 encoding with MIME detection
 * - Response parsing utilities
 */

import { VisionModelProvider, VisionExtractionResult, VisionModelConfig } from '../types.js';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Simple rate limiter using sliding window
 */
class RateLimiter {
  private timestamps: number[] = [];
  private maxRequests: number;
  private windowMs: number;

  constructor(maxRequests: number = 60, windowMs: number = 60000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  async waitForSlot(): Promise<void> {
    const now = Date.now();
    this.timestamps = this.timestamps.filter(t => now - t < this.windowMs);

    if (this.timestamps.length >= this.maxRequests) {
      const oldestTimestamp = this.timestamps[0];
      const waitTime = this.windowMs - (now - oldestTimestamp) + 10;
      if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
      const afterWait = Date.now();
      this.timestamps = this.timestamps.filter(t => afterWait - t < this.windowMs);
    }

    this.timestamps.push(Date.now());
  }
}

/**
 * Cloud vision provider error with retry information
 */
export class CloudVisionError extends Error {
  constructor(
    message: string,
    public provider: string,
    public statusCode: number,
    public retryable: boolean = false
  ) {
    super(message);
    this.name = 'CloudVisionError';
  }
}

/**
 * Base class for cloud vision providers (OpenAI, Anthropic, Google)
 */
export abstract class BaseCloudVisionProvider implements VisionModelProvider {
  abstract name: string;
  protected config: VisionModelConfig;
  protected apiKey: string;
  protected rateLimiter: RateLimiter;
  protected timeout: number;
  protected maxRetries: number;

  constructor(config: VisionModelConfig) {
    this.config = config;
    this.apiKey = config.apiKey || '';
    this.timeout = config.options?.timeout || 60000;
    this.maxRetries = config.options?.maxRetries || 3;
    this.rateLimiter = new RateLimiter(60, 60000); // 60 requests per minute default
  }

  /**
   * Main extraction method - to be implemented by subclasses
   */
  abstract extractFromImage(imagePath: string, prompt?: string): Promise<VisionExtractionResult>;

  /**
   * List available models - to be implemented by subclasses
   */
  abstract listModels(): Promise<string[]>;

  /**
   * Health check - to be implemented by subclasses
   */
  abstract healthCheck(): Promise<boolean>;

  /**
   * Get model info
   */
  abstract getModelInfo(): { name: string; provider: string; parameters?: string };

  /**
   * Read image file and convert to base64 with MIME type detection
   */
  protected buildImageContent(imagePath: string): { base64: string; mimeType: string } {
    const imageBuffer = fs.readFileSync(imagePath);
    const base64 = imageBuffer.toString('base64');
    const ext = path.extname(imagePath).toLowerCase();

    const mimeTypes: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp'
    };

    const mimeType = mimeTypes[ext] || 'image/jpeg';
    return { base64, mimeType };
  }

  /**
   * Make HTTP request with rate limiting and retry logic
   */
  protected async requestWithRetry<T>(
    url: string,
    options: RequestInit,
    retryCount: number = 0
  ): Promise<T> {
    await this.rateLimiter.waitForSlot();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        const retryable = response.status === 429 || response.status >= 500;

        if (retryable && retryCount < this.maxRetries) {
          const delay = Math.pow(2, retryCount) * 1000; // Exponential backoff
          console.warn(`${this.name}: Request failed with ${response.status}, retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          return this.requestWithRetry<T>(url, options, retryCount + 1);
        }

        throw new CloudVisionError(
          `API error: ${response.status} - ${errorText}`,
          this.name,
          response.status,
          retryable
        );
      }

      return await response.json() as T;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof CloudVisionError) {
        throw error;
      }

      if (error instanceof Error && error.name === 'AbortError') {
        if (retryCount < this.maxRetries) {
          console.warn(`${this.name}: Request timeout, retrying...`);
          await new Promise(resolve => setTimeout(resolve, 1000));
          return this.requestWithRetry<T>(url, options, retryCount + 1);
        }
        throw new CloudVisionError(
          `Request timeout after ${this.timeout}ms`,
          this.name,
          0,
          true
        );
      }

      throw new CloudVisionError(
        `Request failed: ${error instanceof Error ? error.message : String(error)}`,
        this.name,
        0,
        true
      );
    }
  }

  /**
   * Get the default prompt for poster extraction
   */
  protected getDefaultPrompt(): string {
    return `Analyze this music/event poster image carefully.

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

Return ONLY the JSON object, no other text.`;
  }

  /**
   * Parse JSON from model response (handles markdown code blocks)
   */
  protected parseJsonResponse(text: string): Record<string, unknown> | undefined {
    // Try to extract JSON from markdown code blocks
    const jsonBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    const jsonText = jsonBlockMatch ? jsonBlockMatch[1] : text;

    try {
      // Find JSON object in text
      const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch {
      // JSON parsing failed
    }

    return undefined;
  }

  /**
   * Convert parsed JSON to structured_data format
   */
  protected mapToStructuredData(json: Record<string, unknown>): VisionExtractionResult['structured_data'] {
    const result: VisionExtractionResult['structured_data'] = {};

    if (json.poster_type && typeof json.poster_type === 'string') {
      const validTypes = ['concert', 'festival', 'comedy', 'theater', 'film', 'album', 'promo', 'exhibition', 'hybrid', 'unknown'];
      if (validTypes.includes(json.poster_type.toLowerCase())) {
        result.poster_type = json.poster_type.toLowerCase() as any;
      }
    }

    const stringFields = ['title', 'headliner', 'venue', 'city', 'state', 'date', 'ticket_price', 'door_time', 'show_time', 'age_restriction', 'tour_name', 'record_label', 'promoter'];
    for (const field of stringFields) {
      if (json[field] && typeof json[field] === 'string' && json[field] !== 'null') {
        (result as any)[field] = json[field];
      }
    }

    if (json.year && typeof json.year === 'number') {
      result.year = json.year;
    }

    if (Array.isArray(json.supporting_acts)) {
      result.supporting_acts = json.supporting_acts.filter((a): a is string => typeof a === 'string');
    }

    // Build artists array
    if (result.headliner) {
      result.artists = [result.headliner, ...(result.supporting_acts || [])];
    }

    // Parse visual elements
    if (json.visual_elements && typeof json.visual_elements === 'object') {
      const ve = json.visual_elements as Record<string, unknown>;
      result.visual_elements = {
        has_artist_photo: typeof ve.has_artist_photo === 'boolean' ? ve.has_artist_photo : undefined,
        has_album_artwork: typeof ve.has_album_artwork === 'boolean' ? ve.has_album_artwork : undefined,
        has_logo: typeof ve.has_logo === 'boolean' ? ve.has_logo : undefined,
        dominant_colors: Array.isArray(ve.dominant_colors) ? ve.dominant_colors.filter((c): c is string => typeof c === 'string') : undefined,
        style: typeof ve.style === 'string' ? ve.style as any : undefined
      };
    }

    return Object.keys(result).length > 0 ? result : undefined;
  }
}
