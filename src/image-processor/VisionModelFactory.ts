/**
 * Vision Model Factory - Creates appropriate vision provider based on config
 */

import { VisionModelProvider, VisionModelConfig, VisionModelsConfigFile } from './types.js';
import { OllamaVisionProvider } from './providers/OllamaVisionProvider.js';
import { VLLMVisionProvider } from './providers/VLLMVisionProvider.js';
import { TransformersVisionProvider } from './providers/TransformersVisionProvider.js';
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
    switch (config.provider) {
      case 'ollama':
        return new OllamaVisionProvider(config);
      case 'vllm':
        return new VLLMVisionProvider(config);
      case 'transformers':
        return new TransformersVisionProvider(config);
      default:
        throw new Error(`Unknown provider: ${(config as any).provider}`);
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
