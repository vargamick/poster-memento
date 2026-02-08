/**
 * Google Cloud Vision Provider - Hybrid OCR + LLM structuring
 *
 * Uses Google Cloud Vision API for high-quality OCR (DOCUMENT_TEXT_DETECTION,
 * TEXT_DETECTION) and label detection (LABEL_DETECTION), then passes the
 * extracted text + labels to a configurable LLM for structured poster data.
 */

import { VisionExtractionResult, VisionModelConfig } from '../types.js';
import { BaseCloudVisionProvider, CloudVisionError } from './BaseCloudVisionProvider.js';
import { VisionModelFactory } from '../VisionModelFactory.js';

interface CloudVisionAnnotateResponse {
  responses: Array<{
    fullTextAnnotation?: {
      text: string;
      pages?: Array<{
        width: number;
        height: number;
      }>;
    };
    textAnnotations?: Array<{
      description: string;
      locale?: string;
      boundingPoly?: {
        vertices: Array<{ x: number; y: number }>;
      };
    }>;
    labelAnnotations?: Array<{
      mid: string;
      description: string;
      score: number;
      topicality: number;
    }>;
    error?: {
      code: number;
      message: string;
    };
  }>;
}

export class GoogleCloudVisionProvider extends BaseCloudVisionProvider {
  name: string;
  private baseUrl: string;
  private structuringModelKey: string;
  private features: string[];

  constructor(config: VisionModelConfig) {
    super(config);
    this.name = 'cloud-vision';
    this.baseUrl = config.baseUrl || 'https://vision.googleapis.com/v1';
    this.structuringModelKey = config.options?.structuringModel || 'gemini-2.0-flash';
    this.features = config.options?.features || [
      'DOCUMENT_TEXT_DETECTION',
      'TEXT_DETECTION',
      'LABEL_DETECTION'
    ];

    if (!this.apiKey) {
      throw new CloudVisionError(
        'Google Cloud Vision API key is required. Set GOOGLE_CLOUD_VISION_API_KEY or GOOGLE_API_KEY environment variable or provide apiKey in config.',
        'google-cloud-vision',
        401,
        false
      );
    }
  }

  async extractFromImage(imagePath: string, prompt?: string): Promise<VisionExtractionResult> {
    const startTime = Date.now();

    // Step 1: Call Cloud Vision API for OCR + labels
    const { base64, mimeType: _mimeType } = this.buildImageContent(imagePath);
    const cloudVisionResult = await this.callCloudVisionAPI(base64);
    const ocrTime = Date.now() - startTime;

    const ocrText = cloudVisionResult.ocrText;
    const labels = cloudVisionResult.labels;

    // Step 2: Use LLM to structure the OCR results
    const structuringPrompt = this.buildStructuringPrompt(ocrText, labels, prompt);

    let structuredData: VisionExtractionResult['structured_data'];
    let llmUsage: VisionExtractionResult['usage'];
    let llmTime = 0;

    try {
      const llmProvider = VisionModelFactory.createByName(this.structuringModelKey);
      const llmResult = await llmProvider.extractFromImage(imagePath, structuringPrompt);
      structuredData = llmResult.structured_data;
      llmUsage = llmResult.usage;
      llmTime = llmResult.processing_time_ms;
    } catch (error) {
      console.warn(
        `[CLOUD-VISION] LLM structuring failed with model "${this.structuringModelKey}": ${error instanceof Error ? error.message : String(error)}. Returning OCR-only result.`
      );
    }

    const totalTime = Date.now() - startTime;

    return {
      extracted_text: ocrText,
      structured_data: structuredData,
      model: `cloud-vision+${this.structuringModelKey}`,
      provider: 'google-cloud-vision',
      processing_time_ms: totalTime,
      confidence: structuredData ? undefined : 0.3, // Low confidence if LLM structuring failed
      usage: llmUsage ? {
        ...llmUsage,
        // Add a note about Cloud Vision API calls in total_tokens
        total_tokens: (llmUsage.total_tokens || 0)
      } : undefined
    };
  }

  /**
   * Call Google Cloud Vision API for OCR and label detection
   */
  private async callCloudVisionAPI(base64Image: string): Promise<{
    ocrText: string;
    labels: Array<{ description: string; score: number }>;
  }> {
    const featureRequests = this.features.map(type => {
      const feature: { type: string; maxResults?: number } = { type };
      if (type === 'LABEL_DETECTION') {
        feature.maxResults = 20;
      }
      return feature;
    });

    const requestBody = {
      requests: [
        {
          image: { content: base64Image },
          features: featureRequests
        }
      ]
    };

    const url = `${this.baseUrl}/images:annotate?key=${this.apiKey}`;

    const response = await this.requestWithRetry<CloudVisionAnnotateResponse>(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      }
    );

    const result = response.responses?.[0];

    if (result?.error) {
      throw new CloudVisionError(
        `Cloud Vision API error: ${result.error.message}`,
        'google-cloud-vision',
        result.error.code,
        result.error.code >= 500
      );
    }

    // Extract OCR text - prefer fullTextAnnotation (DOCUMENT_TEXT_DETECTION) for layout-aware text
    const ocrText = result?.fullTextAnnotation?.text
      || result?.textAnnotations?.[0]?.description
      || '';

    // Extract labels
    const labels = (result?.labelAnnotations || []).map(label => ({
      description: label.description,
      score: label.score
    }));

    return { ocrText, labels };
  }

  /**
   * Build a prompt that includes OCR text and labels for the structuring LLM
   */
  private buildStructuringPrompt(
    ocrText: string,
    labels: Array<{ description: string; score: number }>,
    customPrompt?: string
  ): string {
    if (customPrompt) {
      return `${customPrompt}\n\n--- OCR TEXT (extracted by Google Cloud Vision) ---\n${ocrText}\n\n--- IMAGE LABELS ---\n${labels.map(l => `${l.description} (${(l.score * 100).toFixed(0)}%)`).join(', ')}`;
    }

    const labelsList = labels
      .filter(l => l.score > 0.5)
      .map(l => `${l.description} (${(l.score * 100).toFixed(0)}%)`)
      .join(', ');

    return `You are analyzing a poster image. High-quality OCR text and image labels have already been extracted by Google Cloud Vision API. Use this data along with what you can see in the image to produce accurate structured data.

--- OCR TEXT (extracted by Google Cloud Vision) ---
${ocrText || '(No text detected)'}

--- IMAGE LABELS (detected by Google Cloud Vision) ---
${labelsList || '(No labels detected)'}

--- INSTRUCTIONS ---
Using the OCR text above AND the visual content of the image, determine the poster type and extract all relevant information.

STEP 1: Determine the POSTER TYPE:
- concert: Advertises a concert, gig, or live music performance at a specific venue with a date
- festival: Advertises a music festival with multiple acts (3+ artists typically)
- comedy: Advertises a comedy show or standup performance
- theater: Advertises a theatrical production or play
- film: Advertises a movie or film screening
- album: Promotes an album, single, EP, or music release (NO venue/date, just artist + title)
- promo: General promotional/advertising poster
- exhibition: Art exhibition, gallery show, or museum display
- hybrid: Combines event AND release promotion (e.g., album release party with venue/date)
- unknown: Cannot determine the type

STEP 2: Extract ALL relevant fields from the OCR text. Cross-reference with the image to resolve any ambiguities.

STEP 3: Return a JSON object with this structure:
{
  "poster_type": "concert|festival|comedy|theater|film|album|promo|exhibition|hybrid|unknown",
  "title": "event or release title",
  "headliner": "main artist/performer",
  "supporting_acts": ["list", "of", "supporting", "artists"],
  "venue": "venue name only",
  "city": "city name",
  "state": "state or country",
  "date": "formatted date string",
  "year": 2024,
  "ticket_price": "$XX or null",
  "door_time": "time or null",
  "show_time": "time or null",
  "age_restriction": "18+ or null",
  "tour_name": "tour name or null",
  "record_label": "label name or null",
  "promoter": "promoter name or null",
  "visual_elements": {
    "has_artist_photo": true/false,
    "has_album_artwork": true/false,
    "has_logo": true/false,
    "dominant_colors": ["color1", "color2"],
    "style": "photographic|illustrated|typographic|mixed|other"
  }
}

Return ONLY the JSON object, no other text.`;
  }

  async listModels(): Promise<string[]> {
    return ['cloud-vision-full', 'cloud-vision-ocr-only'];
  }

  async healthCheck(): Promise<boolean> {
    try {
      // Minimal annotate request to verify API key works
      const url = `${this.baseUrl}/images:annotate?key=${this.apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            image: { content: '' },
            features: [{ type: 'LABEL_DETECTION', maxResults: 1 }]
          }]
        })
      });
      // A 200 with an error response (invalid image) still means the API key works
      // A 403 or 401 means the key is invalid
      return response.status !== 401 && response.status !== 403;
    } catch {
      return false;
    }
  }

  getModelInfo(): { name: string; provider: string; parameters?: string } {
    return {
      name: `cloud-vision+${this.structuringModelKey}`,
      provider: 'google-cloud-vision',
      parameters: 'cloud'
    };
  }
}
