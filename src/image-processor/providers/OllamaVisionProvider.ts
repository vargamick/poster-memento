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

    const defaultPrompt = `Analyze this concert/music poster image carefully.

STEP 1: Extract ALL visible text from the image exactly as shown.

STEP 2: Identify and structure the following information:
- Event title or concert name
- HEADLINER: The main/primary artist or band (usually largest text)
- SUPPORTING ACTS: Other artists listed (usually smaller text, often says "with" or "and")
- Venue name (the location/building where the event takes place)
- City and state/country
- Date (day, month, year if visible)
- Ticket price if shown
- Any other relevant details

STEP 3: Return your findings in this format:

EXTRACTED TEXT:
[All text from the poster]

STRUCTURED DATA:
Title: [event title]
Headliner: [main artist]
Supporting Acts: [list other artists, comma separated]
Venue: [venue name]
City: [city name]
State: [state or country]
Date: [formatted date]
Year: [year as number]
Ticket Price: [price if shown]

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
      ticket_price: /Ticket Price:\s*(.+?)(?:\n|$)/i
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
