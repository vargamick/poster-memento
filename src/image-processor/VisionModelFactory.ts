/**
 * Vision Model Factory - Creates appropriate vision provider based on config
 */

import { VisionModelProvider, VisionModelConfig, VisionModelsConfigFile } from './types.js';
import { OllamaVisionProvider } from './providers/OllamaVisionProvider.js';
import { VLLMVisionProvider } from './providers/VLLMVisionProvider.js';
import { TransformersVisionProvider } from './providers/TransformersVisionProvider.js';
import { OpenAIVisionProvider } from './providers/OpenAIVisionProvider.js';
import { AnthropicVisionProvider } from './providers/AnthropicVisionProvider.js';
import { GoogleVisionProvider } from './providers/GoogleVisionProvider.js';
import { GoogleCloudVisionProvider } from './providers/GoogleCloudVisionProvider.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class VisionModelFactory {
  private static configPath = path.join(__dirname, '../../config/vision-models.json');
  private static configCache: VisionModelsConfigFile | null = null;

  /**
   * Create a vision provider based on the provided config
   */
  static create(config: VisionModelConfig): VisionModelProvider {
    // Override baseUrl with environment variable if available
    const effectiveConfig = { ...config };
    if (config.provider === 'ollama' && process.env.OLLAMA_URL) {
      effectiveConfig.baseUrl = process.env.OLLAMA_URL;
    }

    // API key overrides from environment variables (cloud providers)
    if (config.provider === 'openai') {
      effectiveConfig.apiKey = process.env.OPENAI_API_KEY || config.apiKey;
    }
    if (config.provider === 'anthropic') {
      effectiveConfig.apiKey = process.env.ANTHROPIC_API_KEY || config.apiKey;
    }
    if (config.provider === 'google') {
      effectiveConfig.apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || config.apiKey;
    }
    if (config.provider === 'google-cloud-vision') {
      effectiveConfig.apiKey = process.env.GOOGLE_CLOUD_VISION_API_KEY || process.env.GOOGLE_API_KEY || config.apiKey;
    }

    switch (effectiveConfig.provider) {
      case 'ollama':
        return new OllamaVisionProvider(effectiveConfig);
      case 'vllm':
        return new VLLMVisionProvider(effectiveConfig);
      case 'transformers':
        return new TransformersVisionProvider(effectiveConfig);
      case 'openai':
        return new OpenAIVisionProvider(effectiveConfig);
      case 'anthropic':
        return new AnthropicVisionProvider(effectiveConfig);
      case 'google':
        return new GoogleVisionProvider(effectiveConfig);
      case 'google-cloud-vision':
        return new GoogleCloudVisionProvider(effectiveConfig);
      default:
        throw new Error(`Unknown provider: ${(effectiveConfig as any).provider}`);
    }
  }

  /**
   * Load the vision models configuration file
   */
  static loadConfig(): VisionModelsConfigFile {
    if (this.configCache) {
      return this.configCache;
    }

    try {
      const configContent = fs.readFileSync(this.configPath, 'utf-8');
      this.configCache = JSON.parse(configContent);
      return this.configCache!;
    } catch (error) {
      console.error(`Failed to load vision models config from ${this.configPath}:`, error);
      // Return default config
      return {
        default: 'minicpm-v-ollama',
        models: {
          'minicpm-v-ollama': {
            provider: 'ollama',
            baseUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
            model: 'minicpm-v',
            description: 'MiniCPM-V 4.5 - Best OCR, document understanding',
            parameters: '8.7B'
          }
        }
      };
    }
  }

  /**
   * Create the default vision provider from config
   */
  static createDefault(): VisionModelProvider {
    const config = this.loadConfig();
    const modelKey = process.env.VISION_MODEL || config.default;
    const modelConfig = config.models[modelKey];

    if (!modelConfig) {
      throw new Error(`Vision model not found: ${modelKey}. Available models: ${Object.keys(config.models).join(', ')}`);
    }

    return this.create(modelConfig);
  }

  /**
   * Create a vision provider by model key name
   */
  static createByName(modelKey: string): VisionModelProvider {
    const config = this.loadConfig();
    const modelConfig = config.models[modelKey];

    if (!modelConfig) {
      throw new Error(`Vision model not found: ${modelKey}. Available models: ${Object.keys(config.models).join(', ')}`);
    }

    return this.create(modelConfig);
  }

  /**
   * List all available model keys
   */
  static listAvailableModels(): string[] {
    const config = this.loadConfig();
    return Object.keys(config.models);
  }

  /**
   * Get model configuration by key
   */
  static getModelConfig(modelKey: string): VisionModelConfig | undefined {
    const config = this.loadConfig();
    return config.models[modelKey];
  }

  /**
   * Get the current default model key
   */
  static getDefaultModelKey(): string {
    const config = this.loadConfig();
    return process.env.VISION_MODEL || config.default;
  }

  /**
   * Clear the config cache (useful for testing or config updates)
   */
  static clearCache(): void {
    this.configCache = null;
  }
}
