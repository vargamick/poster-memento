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

// Cloud Vision Providers
export { BaseCloudVisionProvider, CloudVisionError } from './providers/BaseCloudVisionProvider.js';
export { OpenAIVisionProvider } from './providers/OpenAIVisionProvider.js';
export { AnthropicVisionProvider } from './providers/AnthropicVisionProvider.js';
export { GoogleVisionProvider } from './providers/GoogleVisionProvider.js';

// Storage - MinIO
export { ImageStorageService, createImageStorageFromEnv } from './ImageStorageService.js';
export type { ImageStorageConfig } from './ImageStorageService.js';

// Storage - AWS S3
export { S3ImageStorageService, createS3ImageStorageFromEnv, isS3Configured } from './S3ImageStorageService.js';
export type { S3ImageStorageConfig } from './S3ImageStorageService.js';

// Storage Factory - returns S3 or MinIO based on configuration
export { createImageStorageService } from './imageStorageFactory.js';

// Processor
export { PosterProcessor, createPosterProcessor } from './PosterProcessor.js';
export type { ProcessingResult, ProcessingOptions } from './PosterProcessor.js';

// Run Management
export { ProcessingRunManager, createProcessingRunManager } from './ProcessingRunManager.js';
export type { ProcessedFileRecord, RunMetadata, ProcessingRun } from './ProcessingRunManager.js';
