/**
 * Ollama Vision Provider - Supports MiniCPM-V, Llama-3.2-Vision, LLaVA
 */

import { VisionModelProvider, VisionExtractionResult, VisionModelConfig } from '../types.js';
import * as fs from 'fs';

export class OllamaVisionProvider implements VisionModelProvider {
  name: string;
  private baseUrl: string;
  private model: string;
  private config: VisionModelConfig;

  constructor(config: VisionModelConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl;
    this.model = config.model;
    this.name = `${config.model}-ollama`;
  }

  async extractFromImage(imagePath: string, prompt?: string): Promise<VisionExtractionResult> {
    const startTime = Date.now();

    // Read image and convert to base64
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString('base64');

    const defaultPrompt = `Analyze this music/event poster image carefully.

STEP 1: Determine the POSTER TYPE - what is the primary purpose of this poster?
- concert: Advertises a concert, gig, or live music performance at a specific venue with a date
- festival: Advertises a music festival with multiple acts (3+ artists typically)
- comedy: Advertises a comedy show or standup performance
- theater: Advertises a theatrical production or play
- film: Advertises a movie or film screening
- release: Promotes an album, single, EP, or music release.
  IMPORTANT: If you see an artist/band name AND an album/title name together
  WITHOUT a venue or specific event date, this is likely a RELEASE poster.
  Look for text like "OUT NOW", "NEW ALBUM", "AVAILABLE", or just artist + title format.
- promo: General promotional/advertising poster (endorsements, competitions)
- exhibition: Art exhibition, gallery show, or museum display
- hybrid: Combines event AND release promotion (e.g., album release party with venue/date)
- unknown: Cannot determine the type - use this ONLY if truly ambiguous

TYPE DETECTION EXAMPLES:
- "1200 TECHNIQUES - CONSISTENCY THEORY" (no venue/date) = release (artist + album title)
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
- Venue name (IMPORTANT: Extract venue name separately from date - e.g. "Metro", "Forum", "Sydney Opera House")
- City (extract city name separately)
- State/Country
- Date (IMPORTANT: Only the date portion - e.g. "Friday, April 8th" or "March 15, 2024" - do NOT include venue in date)
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

POSTER TYPE: [concert|festival|comedy|theater|film|release|promo|exhibition|hybrid|unknown]

EXTRACTED TEXT:
[All text from the poster]

STRUCTURED DATA:
Title: [event/release title]
Headliner: [main artist]
Supporting Acts: [comma separated list]
Venue: [venue name]
City: [city]
State: [state/country]
Date: [formatted date]
Year: [year as number]
Ticket Price: [price]
Door Time: [time]
Show Time: [time]
Age Restriction: [if shown]
Tour Name: [if shown]
Record Label: [if shown]
Promoter: [if shown]

VISUAL ELEMENTS:
Has Artist Photo: [yes/no]
Has Album Artwork: [yes/no]
Has Logo: [yes/no]
Dominant Colors: [comma separated]
Style: [photographic|illustrated|typographic|mixed|other]

Be accurate and only include information you can clearly see in the image.`;

    try {
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt: prompt || defaultPrompt,
          images: [base64Image],
          stream: false,
          options: {
            temperature: this.config.options?.temperature ?? 0.1,
            num_predict: this.config.options?.maxTokens ?? 2048
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
      }

      const result = await response.json() as { response: string };
      const processingTime = Date.now() - startTime;

      // Parse the structured response
      const structured = this.parseStructuredResponse(result.response);

      return {
        extracted_text: result.response,
        structured_data: structured,
        model: this.model,
        provider: 'ollama',
        processing_time_ms: processingTime
      };
    } catch (error) {
      throw new Error(`Ollama extraction failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private parseStructuredResponse(text: string): VisionExtractionResult['structured_data'] {
    const result: VisionExtractionResult['structured_data'] = {};

    // Parse poster type first
    const posterTypeMatch = text.match(/POSTER TYPE:\s*(concert|festival|comedy|theater|film|release|promo|exhibition|hybrid|unknown)/i);
    if (posterTypeMatch) {
      result.poster_type = posterTypeMatch[1].toLowerCase() as 'concert' | 'festival' | 'comedy' | 'theater' | 'film' | 'release' | 'promo' | 'exhibition' | 'hybrid' | 'unknown';
    }

    // Parse structured data section
    const patterns: Record<string, RegExp> = {
      title: /Title:\s*(.+?)(?:\n|$)/i,
      headliner: /Headliner:\s*(.+?)(?:\n|$)/i,
      supporting_acts: /Supporting Acts?:\s*(.+?)(?:\n|$)/i,
      venue: /Venue:\s*(.+?)(?:\n|$)/i,
      city: /City:\s*(.+?)(?:\n|$)/i,
      state: /State:\s*(.+?)(?:\n|$)/i,
      date: /Date:\s*(.+?)(?:\n|$)/i,
      year: /Year:\s*(\d{4})(?:\n|$)/i,
      ticket_price: /Ticket Price:\s*(.+?)(?:\n|$)/i,
      door_time: /Door Time:\s*(.+?)(?:\n|$)/i,
      show_time: /Show Time:\s*(.+?)(?:\n|$)/i,
      age_restriction: /Age Restriction:\s*(.+?)(?:\n|$)/i,
      tour_name: /Tour Name:\s*(.+?)(?:\n|$)/i,
      record_label: /Record Label:\s*(.+?)(?:\n|$)/i,
      promoter: /Promoter:\s*(.+?)(?:\n|$)/i
    };

    for (const [key, pattern] of Object.entries(patterns)) {
      const match = text.match(pattern);
      if (match && match[1] && match[1].trim().toLowerCase() !== 'n/a' && match[1].trim().toLowerCase() !== 'not shown') {
        const value = match[1].trim();
        if (key === 'year') {
          result.year = parseInt(value, 10);
        } else if (key === 'supporting_acts') {
          result.supporting_acts = value.split(/,\s*/).filter(a => a.length > 0);
        } else if (key === 'headliner') {
          result.headliner = value;
        } else {
          (result as any)[key] = value;
        }
      }
    }

    // Parse visual elements
    const visualElements: Record<string, any> = {};
    const visualPatterns: Record<string, RegExp> = {
      has_artist_photo: /Has Artist Photo:\s*(yes|no)/i,
      has_album_artwork: /Has Album Artwork:\s*(yes|no)/i,
      has_logo: /Has Logo:\s*(yes|no)/i,
      dominant_colors: /Dominant Colors:\s*(.+?)(?:\n|$)/i,
      style: /Style:\s*(photographic|illustrated|typographic|mixed|other)/i
    };

    for (const [key, pattern] of Object.entries(visualPatterns)) {
      const match = text.match(pattern);
      if (match && match[1]) {
        const value = match[1].trim();
        if (key.startsWith('has_')) {
          visualElements[key] = value.toLowerCase() === 'yes';
        } else if (key === 'dominant_colors') {
          visualElements[key] = value.split(/,\s*/).filter(c => c.length > 0);
        } else {
          visualElements[key] = value.toLowerCase();
        }
      }
    }

    if (Object.keys(visualElements).length > 0) {
      result.visual_elements = visualElements;
    }

    // Also try to extract artists array combining headliner and supporting acts
    if (result.headliner) {
      result.artists = [result.headliner, ...(result.supporting_acts || [])];
    }

    return Object.keys(result).length > 0 ? result : undefined;
  }

  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) {
        throw new Error(`Failed to list models: ${response.status}`);
      }
      const data = await response.json() as { models?: Array<{ name: string }> };
      return data.models?.map((m) => m.name) || [];
    } catch (error) {
      console.error('Failed to list Ollama models:', error);
      return [];
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }

  getModelInfo(): { name: string; provider: string; parameters?: string } {
    return {
      name: this.model,
      provider: 'ollama',
      parameters: this.config.parameters
    };
  }
}
