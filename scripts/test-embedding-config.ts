#!/usr/bin/env npx tsx
/**
 * Test Embedding Configuration
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment from instance .env file
const envPath = path.resolve('./instances/posters/.env');
console.log(`Loading environment from: ${envPath}`);
dotenv.config({ path: envPath });

console.log('\n=== Environment Configuration ===');
console.log(`EMBEDDING_PROVIDER: ${process.env.EMBEDDING_PROVIDER || 'not set'}`);
console.log(`VOYAGE_API_KEY: ${process.env.VOYAGE_API_KEY ? '***' + process.env.VOYAGE_API_KEY.slice(-8) : 'not set'}`);
console.log(`VOYAGE_EMBEDDING_MODEL: ${process.env.VOYAGE_EMBEDDING_MODEL || 'not set'}`);
console.log(`EMBEDDING_DIMENSIONS: ${process.env.EMBEDDING_DIMENSIONS || 'not set'}`);
console.log(`OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? '***' + process.env.OPENAI_API_KEY.slice(-8) : 'not set'}`);

// Now import the embedding service factory
import { EmbeddingServiceFactory } from '../src/embeddings/EmbeddingServiceFactory.js';

console.log('\n=== Creating Embedding Service ===');
const service = EmbeddingServiceFactory.createFromEnvironment();
const info = service.getModelInfo();

console.log(`Provider: ${info.name}`);
console.log(`Dimensions: ${info.dimensions}`);
console.log(`Version: ${info.version}`);

// Test generating an embedding
console.log('\n=== Testing Embedding Generation ===');
try {
  const testText = "Test embedding for Akmal comedy poster";
  const embedding = await service.generateEmbedding(testText);
  console.log(`Generated embedding with ${embedding.length} dimensions`);
  console.log(`Expected: 1024 dimensions (Voyage AI)`);
  console.log(`Match: ${embedding.length === 1024 ? 'YES ✓' : 'NO ✗ - Using wrong provider!'}`);
} catch (error) {
  console.error('Error generating embedding:', error);
}
