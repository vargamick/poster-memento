/**
 * OpenAI Vision Provider - Supports GPT-4o, GPT-4o-mini, GPT-4 Turbo
 */

import { VisionExtractionResult, VisionModelConfig } from '../types.js';
import { BaseCloudVisionProvider, CloudVisionError } from './BaseCloudVisionProvider.js';

interface OpenAIChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class OpenAIVisionProvider extends BaseCloudVisionProvider {
  name: string;
  private baseUrl: string;
  private model: string;

  constructor(config: VisionModelConfig) {
    super(config);
    this.model = config.model;
    this.name = `${config.model}-openai`;
    this.baseUrl = config.baseUrl || 'https://api.openai.com/v1';

    if (!this.apiKey) {
      throw new CloudVisionError(
        'OpenAI API key is required. Set OPENAI_API_KEY environment variable or provide apiKey in config.',
        'openai',
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
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${base64}`
              }
            },
            {
              type: 'text',
              text: effectivePrompt
            }
          ]
        }
      ],
      max_tokens: this.config.options?.maxTokens || 2048,
      temperature: this.config.options?.temperature ?? 0.1
    };

    try {
      const response = await this.requestWithRetry<OpenAIChatCompletionResponse>(
        `${this.baseUrl}/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`
          },
          body: JSON.stringify(requestBody)
        }
      );

      const processingTime = Date.now() - startTime;
      const content = response.choices[0]?.message?.content || '';

      // Parse JSON response
      const jsonData = this.parseJsonResponse(content);
      const structuredData = jsonData ? this.mapToStructuredData(jsonData) : undefined;

      return {
        extracted_text: content,
        structured_data: structuredData,
        model: this.model,
        provider: 'openai',
        processing_time_ms: processingTime,
        usage: response.usage ? {
          input_tokens: response.usage.prompt_tokens,
          output_tokens: response.usage.completion_tokens,
          total_tokens: response.usage.total_tokens
        } : undefined
      };
    } catch (error) {
      if (error instanceof CloudVisionError) {
        throw error;
      }
      throw new CloudVisionError(
        `OpenAI extraction failed: ${error instanceof Error ? error.message : String(error)}`,
        'openai',
        0,
        true
      );
    }
  }

  async listModels(): Promise<string[]> {
    // Return commonly used vision-capable models
    return ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'];
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  getModelInfo(): { name: string; provider: string; parameters?: string } {
    return {
      name: this.model,
      provider: 'openai',
      parameters: this.config.parameters || 'cloud'
    };
  }
}
