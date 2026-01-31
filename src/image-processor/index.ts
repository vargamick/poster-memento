/**
 * Image Processor Module - Exports for poster image processing
 */

// Types
export * from './types.js';

// Vision Model Layer
export { VisionModelFactory } from './VisionModelFactory.js';
export { OllamaVisionProvider } from './providers/OllamaVisionProvider.js';
export { VLLMVisionProvider } from './providers/VLLMVisionProvider.js';
export { TransformersVisionProvider } from './providers/TransformersVisionProvider.js';

// Storage
export { ImageStorageService, createImageStorageFromEnv } from './ImageStorageService.js';
export type { ImageStorageConfig } from './ImageStorageService.js';

// Processor
export { PosterProcessor, createPosterProcessor } from './PosterProcessor.js';
export type { ProcessingResult, ProcessingOptions } from './PosterProcessor.js';
