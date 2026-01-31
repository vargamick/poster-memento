/**
 * Transformers Vision Provider - For models served via custom FastAPI/Gradio endpoints
 * Supports SmolDocling and other Hugging Face models
 */

import { VisionModelProvider, VisionExtractionResult, VisionModelConfig } from '../types.js';
import * as fs from 'fs';

export class TransformersVisionProvider implements VisionModelProvider {
  name: string;
  private baseUrl: string;
  private model: string;
  private config: VisionModelConfig;

  constructor(config: VisionModelConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl;
    this.model = config.model;
    this.name = `${config.model.split('/').pop()}-transformers`;
  }

  async extractFromImage(imagePath: string, prompt?: string): Promise<VisionExtractionResult> {
    const startTime = Date.now();

    // Read image and convert to base64
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString('base64');

    const defaultPrompt = `Extract all text from this music poster image and identify: title, artists, venue, location, date, and ticket price.`;

    try {
      const response = await fetch(`${this.baseUrl}/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: base64Image,
          prompt: prompt || defaultPrompt,
          model: this.model
        })
      });

      if (!response.ok) {
        throw new Error(`Transformers API error: ${response.status} ${response.statusText}`);
      }

      const result = await response.json() as {
        text?: string;
        extracted_text?: string;
        structured_data?: any;
      };
      const processingTime = Date.now() - startTime;

      return {
        extracted_text: result.text || result.extracted_text || '',
        structured_data: result.structured_data,
        model: this.model,
        provider: 'transformers',
        processing_time_ms: processingTime
      };
    } catch (error) {
      throw new Error(`Transformers extraction failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/models`);
      if (!response.ok) {
        return [this.model]; // Return configured model if endpoint doesn't exist
      }
      const data = await response.json() as { models?: string[] };
      return data.models || [this.model];
    } catch {
      return [this.model];
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
      provider: 'transformers',
      parameters: this.config.parameters
    };
  }
}
