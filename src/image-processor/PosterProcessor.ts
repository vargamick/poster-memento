/**
 * Poster Processor - Main processing logic for extracting poster metadata
 */

import { VisionModelFactory } from './VisionModelFactory.js';
import { ImageStorageService, createImageStorageFromEnv } from './ImageStorageService.js';
import { VisionModelProvider, PosterEntity, VisionExtractionResult } from './types.js';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';

export interface ProcessingResult {
  success: boolean;
  entity?: PosterEntity;
  error?: string;
  processingTimeMs: number;
}

export interface ProcessingOptions {
  skipStorage?: boolean;
  skipIfExists?: boolean;
  customPrompt?: string;
  modelKey?: string;
}

export class PosterProcessor {
  private vision: VisionModelProvider;
  private storage: ImageStorageService | null;

  constructor(
    visionProvider?: VisionModelProvider,
    storageService?: ImageStorageService
  ) {
    this.vision = visionProvider || VisionModelFactory.createDefault();
    this.storage = storageService || null;
  }

  /**
   * Initialize the processor with storage
   */
  async initialize(): Promise<void> {
    if (!this.storage) {
      this.storage = createImageStorageFromEnv();
    }
    await this.storage.initialize();
  }

  /**
   * Process a single image file and extract poster metadata
   */
  async processImage(imagePath: string, options: ProcessingOptions = {}): Promise<ProcessingResult> {
    const startTime = Date.now();

    try {
      // Validate file exists
      if (!fs.existsSync(imagePath)) {
        return {
          success: false,
          error: `File not found: ${imagePath}`,
          processingTimeMs: Date.now() - startTime
        };
      }

      // Use custom model if specified
      let visionProvider = this.vision;
      if (options.modelKey) {
        visionProvider = VisionModelFactory.createByName(options.modelKey);
      }

      // Check if already processed (by hash)
      let storedImage = null;
      if (this.storage && !options.skipStorage) {
        const hash = this.storage.getFileHash(imagePath);

        if (options.skipIfExists) {
          const exists = await this.storage.imageExists(hash);
          if (exists) {
            return {
              success: false,
              error: `Image already processed (hash: ${hash})`,
              processingTimeMs: Date.now() - startTime
            };
          }
        }

        // Store the original image
        storedImage = await this.storage.storeImage(imagePath);
      }

      // Extract text and metadata using vision model
      const extraction = await visionProvider.extractFromImage(imagePath, options.customPrompt);

      // Build the poster entity
      const entity = this.buildPosterEntity(imagePath, extraction, storedImage);

      // Store processing result
      if (this.storage && storedImage && !options.skipStorage) {
        await this.storage.storeProcessingResult(storedImage.hash, {
          extraction,
          entity,
          processedAt: new Date().toISOString()
        });
      }

      return {
        success: true,
        entity,
        processingTimeMs: Date.now() - startTime
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        processingTimeMs: Date.now() - startTime
      };
    }
  }

  /**
   * Process multiple images in batch
   */
  async processBatch(
    imagePaths: string[],
    options: ProcessingOptions = {},
    onProgress?: (completed: number, total: number, current: string) => void
  ): Promise<ProcessingResult[]> {
    const results: ProcessingResult[] = [];

    for (let i = 0; i < imagePaths.length; i++) {
      const imagePath = imagePaths[i];

      if (onProgress) {
        onProgress(i, imagePaths.length, imagePath);
      }

      const result = await this.processImage(imagePath, options);
      results.push(result);

      // Small delay between processing to avoid overwhelming the vision model
      if (i < imagePaths.length - 1) {
        await this.delay(100);
      }
    }

    return results;
  }

  /**
   * Build a PosterEntity from extraction results
   */
  private buildPosterEntity(
    imagePath: string,
    extraction: VisionExtractionResult,
    storedImage: { url: string; hash: string; originalFilename: string; sizeBytes: number } | null
  ): PosterEntity {
    const structured = extraction.structured_data || {};
    const hash = storedImage?.hash || this.generateHash(imagePath);

    // Extract year and decade
    let year = structured.year;
    if (!year && structured.date) {
      const yearMatch = structured.date.match(/\b(19[6-9]\d|20[0-2]\d)\b/);
      if (yearMatch) {
        year = parseInt(yearMatch[0], 10);
      }
    }

    const decade = year ? `${Math.floor(year / 10) * 10}s` : undefined;

    return {
      name: `poster_${hash}`,
      entityType: 'Poster',
      poster_type: structured.poster_type || 'unknown',
      title: structured.title,
      headliner: structured.headliner,
      supporting_acts: structured.supporting_acts,
      venue_name: structured.venue,
      city: structured.city,
      state: structured.state,
      event_date: structured.date,
      year,
      decade,
      ticket_price: structured.ticket_price,
      door_time: structured.door_time,
      show_time: structured.show_time,
      age_restriction: structured.age_restriction,
      tour_name: structured.tour_name,
      record_label: structured.record_label,
      promoter: structured.promoter,
      extracted_text: extraction.extracted_text,
      visual_elements: structured.visual_elements,
      observations: [
        `Extracted from image: ${path.basename(imagePath)}`,
        `Poster type: ${structured.poster_type || 'unknown'}`,
        extraction.extracted_text.substring(0, 500) + (extraction.extracted_text.length > 500 ? '...' : '')
      ],
      metadata: {
        source_image_url: storedImage?.url || `file://${imagePath}`,
        source_image_hash: hash,
        original_filename: storedImage?.originalFilename || path.basename(imagePath),
        file_size_bytes: storedImage?.sizeBytes || fs.statSync(imagePath).size,
        vision_model: extraction.model,
        processing_time_ms: extraction.processing_time_ms,
        extraction_confidence: extraction.confidence,
        processing_date: new Date().toISOString()
      }
    };
  }

  private generateHash(filePath: string): string {
    const fileBuffer = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(fileBuffer).digest('hex').slice(0, 16);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get the current vision model info
   */
  getVisionModelInfo(): { name: string; provider: string; parameters?: string } {
    return this.vision.getModelInfo();
  }

  /**
   * Switch to a different vision model
   */
  switchVisionModel(modelKey: string): void {
    this.vision = VisionModelFactory.createByName(modelKey);
  }

  /**
   * Health check for all services
   */
  async healthCheck(): Promise<{ vision: boolean; storage: boolean }> {
    const [visionOk, storageOk] = await Promise.all([
      this.vision.healthCheck(),
      this.storage?.healthCheck() ?? Promise.resolve(false)
    ]);

    return { vision: visionOk, storage: storageOk };
  }
}

/**
 * Create a PosterProcessor from environment configuration
 */
export async function createPosterProcessor(): Promise<PosterProcessor> {
  const processor = new PosterProcessor();
  await processor.initialize();
  return processor;
}
