/**
 * Anthropic Vision Provider - Supports Claude 4.5 Opus, Sonnet, Haiku
 */

import { VisionExtractionResult, VisionModelConfig } from '../types.js';
import { BaseCloudVisionProvider, CloudVisionError } from './BaseCloudVisionProvider.js';

interface AnthropicMessageResponse {
  id: string;
  type: string;
  role: string;
  content: Array<{
    type: string;
    text?: string;
  }>;
  model: string;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export class AnthropicVisionProvider extends BaseCloudVisionProvider {
  name: string;
  private baseUrl: string;
  private model: string;

  constructor(config: VisionModelConfig) {
    super(config);
    this.model = config.model;
    this.name = `${config.model}-anthropic`;
    this.baseUrl = config.baseUrl || 'https://api.anthropic.com/v1';

    if (!this.apiKey) {
      throw new CloudVisionError(
        'Anthropic API key is required. Set ANTHROPIC_API_KEY environment variable or provide apiKey in config.',
        'anthropic',
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
      model: this.model,
      max_tokens: this.config.options?.maxTokens || 2048,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mimeType,
                data: base64
              }
            },
            {
              type: 'text',
              text: effectivePrompt
            }
          ]
        }
      ]
    };

    // Add temperature if not default (Anthropic doesn't like temperature: 0)
    if (this.config.options?.temperature && this.config.options.temperature > 0) {
      (requestBody as any).temperature = this.config.options.temperature;
    }

    try {
      const response = await this.requestWithRetry<AnthropicMessageResponse>(
        `${this.baseUrl}/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify(requestBody)
        }
      );

      const processingTime = Date.now() - startTime;

      // Extract text content from response
      const textContent = response.content.find(c => c.type === 'text');
      const content = textContent?.text || '';

      // Parse JSON response
      const jsonData = this.parseJsonResponse(content);
      const structuredData = jsonData ? this.mapToStructuredData(jsonData) : undefined;

      return {
        extracted_text: content,
        structured_data: structuredData,
        model: this.model,
        provider: 'anthropic',
        processing_time_ms: processingTime,
        usage: {
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens,
          total_tokens: response.usage.input_tokens + response.usage.output_tokens
        }
      };
    } catch (error) {
      if (error instanceof CloudVisionError) {
        throw error;
      }
      throw new CloudVisionError(
        `Anthropic extraction failed: ${error instanceof Error ? error.message : String(error)}`,
        'anthropic',
        0,
        true
      );
    }
  }

  async listModels(): Promise<string[]> {
    // Return currently available vision-capable Claude models (Claude 4.5 family)
    return [
      'claude-opus-4-5-20251101',
      'claude-sonnet-4-5-20250929',
      'claude-haiku-4-5-20251001'
    ];
  }

  async healthCheck(): Promise<boolean> {
    // Anthropic doesn't have a simple health endpoint, so we just check if we have an API key
    return !!this.apiKey;
  }

  getModelInfo(): { name: string; provider: string; parameters?: string } {
    return {
      name: this.model,
      provider: 'anthropic',
      parameters: this.config.parameters || 'cloud'
    };
  }
}
