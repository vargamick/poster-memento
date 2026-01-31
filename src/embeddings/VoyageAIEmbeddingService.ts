import axios from 'axios';
import { EmbeddingService, type EmbeddingModelInfo } from './EmbeddingService.js';
import { logger } from '../utils/logger.js';

/**
 * Configuration for Voyage AI embedding service
 */
export interface VoyageAIEmbeddingConfig {
  /**
   * Voyage AI API key
   */
  apiKey: string;

  /**
   * Optional model name to use
   * Default: voyage-3
   */
  model?: string;

  /**
   * Optional dimensions override
   * voyage-3: 1024 dimensions
   * voyage-3-lite: 512 dimensions
   */
  dimensions?: number;

  /**
   * Optional version string
   */
  version?: string;

  /**
   * Optional timeout in milliseconds
   * Default: 30000 (30 seconds)
   */
  timeout?: number;
}

/**
 * Voyage AI API response structure
 */
interface VoyageAIEmbeddingResponse {
  data: Array<{
    embedding: number[];
    index: number;
  }>;
  model: string;
  usage: {
    total_tokens: number;
  };
}

/**
 * Service implementation that generates embeddings using Voyage AI's API
 * Voyage AI is recommended by Anthropic for embeddings with Claude applications
 */
export class VoyageAIEmbeddingService extends EmbeddingService {
  private apiKey: string;
  private model: string;
  private dimensions: number;
  private version: string;
  private timeout: number;
  private apiEndpoint: string;

  /**
   * Create a new Voyage AI embedding service
   *
   * @param config - Configuration for the service
   */
  constructor(config: VoyageAIEmbeddingConfig) {
    super();

    if (!config) {
      throw new Error('Configuration is required for Voyage AI embedding service');
    }

    if (!config.apiKey && !process.env.VOYAGE_API_KEY) {
      throw new Error('API key is required for Voyage AI embedding service');
    }

    this.apiKey = config.apiKey || process.env.VOYAGE_API_KEY || '';
    this.model = config.model || 'voyage-3';
    this.dimensions = config.dimensions || 1024; // voyage-3 has 1024 dimensions
    this.version = config.version || '1.0.0';
    this.timeout = config.timeout || 30000; // 30 second default timeout
    this.apiEndpoint = 'https://api.voyageai.com/v1/embeddings';
  }

  /**
   * Generate an embedding for a single text
   *
   * @param text - Text to generate embedding for
   * @returns Promise resolving to embedding vector
   */
  override async generateEmbedding(text: string): Promise<number[]> {
    if (!this.apiKey) {
      throw new Error('No Voyage AI API key available');
    }

    logger.debug('Generating embedding with Voyage AI', {
      text: text.substring(0, 50) + '...',
      model: this.model,
      apiEndpoint: this.apiEndpoint,
    });

    try {
      const response = await axios.post<VoyageAIEmbeddingResponse>(
        this.apiEndpoint,
        {
          input: [text], // Voyage AI expects an array
          model: this.model,
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: this.timeout,
        }
      );

      logger.debug('Received response from Voyage AI API');

      if (!response.data || !response.data.data || !response.data.data[0]) {
        logger.error('Invalid response from Voyage AI API', { response: response.data });
        throw new Error('Invalid response from Voyage AI API - missing embedding data');
      }

      const embedding = response.data.data[0].embedding;

      if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
        logger.error('Invalid embedding returned', { embedding });
        throw new Error('Invalid embedding returned from Voyage AI API');
      }

      logger.debug('Generated embedding with Voyage AI', {
        length: embedding.length,
        sample: embedding.slice(0, 5),
        isArray: Array.isArray(embedding),
      });

      // Log token usage if in debug mode
      if (process.env.DEBUG === 'true') {
        const tokens = response.data.usage?.total_tokens || 'unknown';
        logger.debug('Voyage AI embedding token usage', { tokens });
      }

      // Normalize the embedding vector
      this._normalizeVector(embedding);
      logger.debug('Normalized embedding', {
        length: embedding.length,
        sample: embedding.slice(0, 5),
      });

      return embedding;
    } catch (error: unknown) {
      // Handle axios errors specifically
      const axiosError = error as {
        isAxiosError?: boolean;
        response?: {
          status?: number;
          data?: unknown;
        };
        message?: string;
      };

      if (axiosError.isAxiosError) {
        const statusCode = axiosError.response?.status;
        const responseData = axiosError.response?.data;

        logger.error('Voyage AI API error', {
          status: statusCode,
          data: responseData,
          message: axiosError.message,
        });

        // Handle specific error types
        if (statusCode === 401) {
          throw new Error('Voyage AI API authentication failed - invalid API key');
        } else if (statusCode === 429) {
          throw new Error('Voyage AI API rate limit exceeded - try again later');
        } else if (statusCode && statusCode >= 500) {
          throw new Error(`Voyage AI API server error (${statusCode}) - try again later`);
        }

        // Include response data in error if available
        const errorDetails = responseData
          ? `: ${JSON.stringify(responseData).substring(0, 200)}`
          : '';

        throw new Error(`Voyage AI API error (${statusCode || 'unknown'})${errorDetails}`);
      }

      // Handle other errors
      const errorMessage = this._getErrorMessage(error);
      logger.error('Failed to generate embedding with Voyage AI', { error: errorMessage });
      throw new Error(`Error generating embedding: ${errorMessage}`);
    }
  }

  /**
   * Generate embeddings for multiple texts
   *
   * @param texts - Array of texts to generate embeddings for
   * @returns Promise resolving to array of embedding vectors
   */
  override async generateEmbeddings(texts: string[]): Promise<number[][]> {
    try {
      const response = await axios.post<VoyageAIEmbeddingResponse>(
        this.apiEndpoint,
        {
          input: texts,
          model: this.model,
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: this.timeout,
        }
      );

      const embeddings = response.data.data.map((item) => item.embedding);

      // Normalize each embedding vector
      embeddings.forEach((embedding) => {
        this._normalizeVector(embedding);
      });

      return embeddings;
    } catch (error: unknown) {
      const errorMessage = this._getErrorMessage(error);
      throw new Error(`Failed to generate embeddings with Voyage AI: ${errorMessage}`);
    }
  }

  /**
   * Get information about the embedding model
   *
   * @returns Model information
   */
  override getModelInfo(): EmbeddingModelInfo {
    return {
      name: this.model,
      dimensions: this.dimensions,
      version: this.version,
    };
  }

  /**
   * Extract error message from error object
   *
   * @private
   * @param error - Error object
   * @returns Error message string
   */
  private _getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  /**
   * Normalize a vector to unit length (L2 norm)
   *
   * @private
   * @param vector - Vector to normalize in-place
   */
  private _normalizeVector(vector: number[]): void {
    // Calculate magnitude (Euclidean norm / L2 norm)
    let magnitude = 0;
    for (let i = 0; i < vector.length; i++) {
      magnitude += vector[i] * vector[i];
    }
    magnitude = Math.sqrt(magnitude);

    // Avoid division by zero
    if (magnitude > 0) {
      // Normalize each component
      for (let i = 0; i < vector.length; i++) {
        vector[i] /= magnitude;
      }
    } else {
      // If magnitude is 0, set first element to 1 for a valid unit vector
      vector[0] = 1;
    }
  }
}
