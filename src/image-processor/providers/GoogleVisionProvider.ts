/**
 * Google Vision Provider - Supports Gemini 1.5 Pro, Gemini 1.5 Flash, Gemini 2.0 Flash
 */

import { VisionExtractionResult, VisionModelConfig } from '../types.js';
import { BaseCloudVisionProvider, CloudVisionError } from './BaseCloudVisionProvider.js';

interface GeminiGenerateContentResponse {
  candidates: Array<{
    content: {
      parts: Array<{
        text?: string;
      }>;
      role: string;
    };
    finishReason: string;
    index: number;
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

export class GoogleVisionProvider extends BaseCloudVisionProvider {
  name: string;
  private baseUrl: string;
  private model: string;

  constructor(config: VisionModelConfig) {
    super(config);
    this.model = config.model;
    this.name = `${config.model}-google`;
    this.baseUrl = config.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';

    if (!this.apiKey) {
      throw new CloudVisionError(
        'Google API key is required. Set GOOGLE_API_KEY or GEMINI_API_KEY environment variable or provide apiKey in config.',
        'google',
        401,
        false
      );
    }
  }

  async extractFromImage(imagePath: string, prompt?: string): Promise<VisionExtractionResult> {
    const startTime = Date.now();
    const { base64, mimeType } = this.buildImageContent(imagePath);
    const effectivePrompt = prompt || this.getDefaultPrompt();

    const requestBody = {
      contents: [
        {
          parts: [
            {
              inline_data: {
                mime_type: mimeType,
                data: base64
              }
            },
            {
              text: effectivePrompt
            }
          ]
        }
      ],
      generationConfig: {
        temperature: this.config.options?.temperature ?? 0.1,
        maxOutputTokens: this.config.options?.maxTokens || 2048
      }
    };

    try {
      // Google uses query param for API key
      const url = `${this.baseUrl}/models/${this.model}:generateContent?key=${this.apiKey}`;

      const response = await this.requestWithRetry<GeminiGenerateContentResponse>(
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(requestBody)
        }
      );

      const processingTime = Date.now() - startTime;

      // Extract text content from response
      const content = response.candidates?.[0]?.content?.parts
        ?.filter(p => p.text)
        ?.map(p => p.text)
        ?.join('') || '';

      // Parse JSON response
      const jsonData = this.parseJsonResponse(content);
      const structuredData = jsonData ? this.mapToStructuredData(jsonData) : undefined;

      return {
        extracted_text: content,
        structured_data: structuredData,
        model: this.model,
        provider: 'google',
        processing_time_ms: processingTime,
        usage: response.usageMetadata ? {
          input_tokens: response.usageMetadata.promptTokenCount,
          output_tokens: response.usageMetadata.candidatesTokenCount,
          total_tokens: response.usageMetadata.totalTokenCount
        } : undefined
      };
    } catch (error) {
      if (error instanceof CloudVisionError) {
        throw error;
      }
      throw new CloudVisionError(
        `Google extraction failed: ${error instanceof Error ? error.message : String(error)}`,
        'google',
        0,
        true
      );
    }
  }

  async listModels(): Promise<string[]> {
    // Return commonly used vision-capable Gemini models
    return [
      'gemini-1.5-pro-latest',
      'gemini-1.5-flash-latest',
      'gemini-2.0-flash-exp',
      'gemini-1.5-pro',
      'gemini-1.5-flash'
    ];
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(
        `${this.baseUrl}/models?key=${this.apiKey}`
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  getModelInfo(): { name: string; provider: string; parameters?: string } {
    return {
      name: this.model,
      provider: 'google',
      parameters: this.config.parameters || 'cloud'
    };
  }
}
