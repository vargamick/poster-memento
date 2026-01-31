/**
 * vLLM Vision Provider - Supports Qwen2.5-VL, Pixtral, and other models via vLLM
 */

import { VisionModelProvider, VisionExtractionResult, VisionModelConfig } from '../types.js';
import * as fs from 'fs';

export class VLLMVisionProvider implements VisionModelProvider {
  name: string;
  private baseUrl: string;
  private model: string;
  private config: VisionModelConfig;

  constructor(config: VisionModelConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl;
    this.model = config.model;
    this.name = `${config.model.split('/').pop()}-vllm`;
  }

  async extractFromImage(imagePath: string, prompt?: string): Promise<VisionExtractionResult> {
    const startTime = Date.now();

    // Read image and convert to base64
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString('base64');
    const mimeType = this.getMimeType(imagePath);

    const defaultPrompt = `Analyze this concert/music poster image. Extract ALL visible text.
Then identify: Event title, Headliner artist, Supporting acts, Venue, City/State, Date, Year, Ticket price.
Format as JSON: {"title": "", "headliner": "", "supporting_acts": [], "venue": "", "city": "", "state": "", "date": "", "year": 0, "ticket_price": ""}`;

    try {
      // vLLM uses OpenAI-compatible API
      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:${mimeType};base64,${base64Image}`
                  }
                },
                {
                  type: 'text',
                  text: prompt || defaultPrompt
                }
              ]
            }
          ],
          max_tokens: this.config.options?.maxTokens ?? 2048,
          temperature: this.config.options?.temperature ?? 0.1
        })
      });

      if (!response.ok) {
        throw new Error(`vLLM API error: ${response.status} ${response.statusText}`);
      }

      const result = await response.json() as {
        choices: Array<{ message: { content: string } }>;
      };
      const processingTime = Date.now() - startTime;
      const content = result.choices[0]?.message?.content || '';

      // Try to parse JSON from response
      const structured = this.parseJsonResponse(content);

      return {
        extracted_text: content,
        structured_data: structured,
        model: this.model,
        provider: 'vllm',
        processing_time_ms: processingTime
      };
    } catch (error) {
      throw new Error(`vLLM extraction failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private getMimeType(filePath: string): string {
    const ext = filePath.toLowerCase().split('.').pop();
    const mimeTypes: Record<string, string> = {
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'webp': 'image/webp'
    };
    return mimeTypes[ext || ''] || 'image/jpeg';
  }

  private parseJsonResponse(text: string): VisionExtractionResult['structured_data'] {
    try {
      // Try to find JSON in the response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          title: parsed.title,
          headliner: parsed.headliner,
          artists: parsed.headliner ? [parsed.headliner, ...(parsed.supporting_acts || [])] : undefined,
          supporting_acts: parsed.supporting_acts,
          venue: parsed.venue,
          city: parsed.city,
          state: parsed.state,
          date: parsed.date,
          year: parsed.year ? parseInt(String(parsed.year), 10) : undefined,
          ticket_price: parsed.ticket_price
        };
      }
    } catch (e) {
      // JSON parsing failed, return undefined
    }
    return undefined;
  }

  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/models`);
      if (!response.ok) {
        throw new Error(`Failed to list models: ${response.status}`);
      }
      const data = await response.json() as { data?: Array<{ id: string }> };
      return data.data?.map((m) => m.id) || [];
    } catch (error) {
      console.error('Failed to list vLLM models:', error);
      return [];
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      return response.ok;
    } catch {
      return false;
    }
  }

  getModelInfo(): { name: string; provider: string; parameters?: string } {
    return {
      name: this.model,
      provider: 'vllm',
      parameters: this.config.parameters
    };
  }
}
