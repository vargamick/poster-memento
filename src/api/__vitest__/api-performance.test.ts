import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import { createApiServer } from '../server.js';
import { FileStorageProvider } from '../../storage/FileStorageProvider.js';
import { promises as fs } from 'fs';
import path from 'path';
import { tmpdir } from 'os';

describe('Memento MCP API Performance Tests', () => {
  let app: Application;
  let storageProvider: FileStorageProvider;
  let testDataDir: string;
  let apiKey: string;

  beforeAll(async () => {
    // Create temporary directory for test data
    testDataDir = path.join(tmpdir(), `memento-api-perf-test-${Date.now()}`);
    await fs.mkdir(testDataDir, { recursive: true });

    // Initialize storage provider
    storageProvider = new FileStorageProvider({
      memoryFilePath: path.join(testDataDir, 'memory.json')
    });

    // Set up API key for testing
    apiKey = 'test-api-key-performance';

    // Create API server
    app = createApiServer(
      { storageProvider },
      {
        requireApiKey: true,
        apiKeys: [apiKey],
        enableCors: true
      }
    );
  });

  afterAll(async () => {
    // Clean up test data
    try {
      await fs.rm(testDataDir, { recursive: true, force: true });
    } catch (error) {
      console.warn('Failed to clean up test directory:', error);
    }
  });

  beforeEach(async () => {
    // Clean up any existing test data before each test
    try {
      const files = await fs.readdir(testDataDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          await fs.unlink(path.join(testDataDir, file));
        }
      }
    } catch (error) {
      // Directory might be empty, ignore
    }
  });

  describe('Entity Creation Performance', () => {
    it('should create 100 entities within 5 seconds', async () => {
      const entities = Array.from({ length: 100 }, (_, i) => ({
        name: `PerfTestEntity_${i}`,
        entityType: 'performance_test',
        observations: [`Performance test entity ${i}`, `Created for bulk testing`]
      }));

      const startTime = Date.now();
      
      const response = await request(app)
        .post('/api/v1/entities')
        .set('X-API-Key', apiKey)
        .send({ entities })
        .expect(201);

      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(duration).toBeLessThan(5000); // Less than 5 seconds
      expect(response.body.data.entities).toHaveLength(100);
    }, 10000); // 10 second timeout

    it('should create entities in batches efficiently', async () => {
      const batchSize = 25;
      const totalEntities = 100;
      const batches = Math.ceil(totalEntities / batchSize);

      const startTime = Date.now();

      for (let batch = 0; batch < batches; batch++) {
        const entities = Array.from({ length: batchSize }, (_, i) => ({
          name: `BatchTestEntity_${batch}_${i}`,
          entityType: 'batch_test',
          observations: [`Batch ${batch} entity ${i}`]
        }));

        await request(app)
          .post('/api/v1/entities')
          .set('X-API-Key', apiKey)
          .send({ entities })
          .expect(201);
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(duration).toBeLessThan(8000); // Less than 8 seconds for batched creation
    }, 15000);
  });

  describe('Search Performance', () => {
    beforeEach(async () => {
      // Create a large dataset for search testing
      const entities = Array.from({ length: 200 }, (_, i) => ({
        name: `SearchTestEntity_${i}`,
        entityType: i % 2 === 0 ? 'even_entity' : 'odd_entity',
        observations: [
          `Search test entity number ${i}`,
          `Contains keyword ${i % 10 === 0 ? 'special' : 'normal'}`,
          `Category: ${i < 50 ? 'alpha' : i < 100 ? 'beta' : i < 150 ? 'gamma' : 'delta'}`
        ]
      }));

      await request(app)
        .post('/api/v1/entities')
        .set('X-API-Key', apiKey)
        .send({ entities });
    });

    it('should search large dataset within 2 seconds', async () => {
      const startTime = Date.now();

      const response = await request(app)
        .get('/api/v1/search?q=search&limit=50')
        .set('X-API-Key', apiKey)
        .expect(200);

      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(duration).toBeLessThan(2000); // Less than 2 seconds
      expect(response.body.data).toBeDefined();
    }, 5000);

    it('should handle filtered search efficiently', async () => {
      const startTime = Date.now();

      const response = await request(app)
        .get('/api/v1/search?q=special&entityTypes=even_entity&limit=20')
        .set('X-API-Key', apiKey)
        .expect(200);

      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(duration).toBeLessThan(1500); // Less than 1.5 seconds
      expect(response.body.data).toBeDefined();
    }, 3000);

    it('should handle pagination efficiently', async () => {
      const startTime = Date.now();

      // Test multiple pages
      const promises = [];
      for (let offset = 0; offset < 100; offset += 25) {
        promises.push(
          request(app)
            .get(`/api/v1/search?q=test&limit=25&offset=${offset}`)
            .set('X-API-Key', apiKey)
            .expect(200)
        );
      }

      await Promise.all(promises);

      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(duration).toBeLessThan(3000); // Less than 3 seconds for 4 concurrent requests
    }, 5000);
  });

  describe('Concurrent Request Handling', () => {
    it('should handle 20 concurrent entity creation requests', async () => {
      const startTime = Date.now();

      const promises = Array.from({ length: 20 }, (_, i) =>
        request(app)
          .post('/api/v1/entities')
          .set('X-API-Key', apiKey)
          .send({
            entities: [{
              name: `ConcurrentEntity_${i}`,
              entityType: 'concurrent_test',
              observations: [`Concurrent test entity ${i}`]
            }]
          })
          .expect(201)
      );

      const responses = await Promise.all(promises);

      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(duration).toBeLessThan(5000); // Less than 5 seconds
      expect(responses).toHaveLength(20);
      responses.forEach(response => {
        expect(response.body.data.entities).toHaveLength(1);
      });
    }, 10000);

    it('should handle mixed concurrent operations', async () => {
      // First create some entities
      const setupEntities = Array.from({ length: 10 }, (_, i) => ({
        name: `MixedTestEntity_${i}`,
        entityType: 'mixed_test',
        observations: [`Mixed test entity ${i}`]
      }));

      await request(app)
        .post('/api/v1/entities')
        .set('X-API-Key', apiKey)
        .send({ entities: setupEntities });

      const startTime = Date.now();

      // Mix of different operations
      const createPromises = Array.from({ length: 5 }, (_, i) =>
        request(app)
          .post('/api/v1/entities')
          .set('X-API-Key', apiKey)
          .send({
            entities: [{
              name: `MixedConcurrentEntity_${i}`,
              entityType: 'mixed_concurrent',
              observations: [`Mixed concurrent entity ${i}`]
            }]
          })
      );

      const readPromises = Array.from({ length: 5 }, (_, i) =>
        request(app)
          .get(`/api/v1/entities/MixedTestEntity_${i}`)
          .set('X-API-Key', apiKey)
      );

      const searchPromises = Array.from({ length: 5 }, () =>
        request(app)
          .get('/api/v1/search?q=mixed&limit=10')
          .set('X-API-Key', apiKey)
      );

      const promises = [...createPromises, ...readPromises, ...searchPromises];

      const responses = await Promise.all(promises);

      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(duration).toBeLessThan(4000); // Less than 4 seconds
      expect(responses).toHaveLength(15);

      // Check that all operations succeeded
      responses.forEach((response, index) => {
        if (index < 5) {
          // Create operations
          expect(response.status).toBe(201);
        } else if (index < 10) {
          // Read operations
          expect(response.status).toBe(200);
        } else {
          // Search operations
          expect(response.status).toBe(200);
        }
      });
    }, 8000);
  });

  describe('Memory Usage', () => {
    it('should handle large entity creation without memory issues', async () => {
      const initialMemory = process.memoryUsage();

      // Create entities with large observation arrays
      const entities = Array.from({ length: 50 }, (_, i) => ({
        name: `LargeEntity_${i}`,
        entityType: 'large_test',
        observations: Array.from({ length: 20 }, (_, j) => 
          `Large observation ${j} for entity ${i} with some additional content to make it bigger`
        )
      }));

      await request(app)
        .post('/api/v1/entities')
        .set('X-API-Key', apiKey)
        .send({ entities })
        .expect(201);

      const finalMemory = process.memoryUsage();
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;

      // Memory increase should be reasonable (less than 50MB)
      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024);
    }, 10000);
  });

  describe('Response Time Consistency', () => {
    beforeEach(async () => {
      // Create baseline entities
      const entities = Array.from({ length: 50 }, (_, i) => ({
        name: `BaselineEntity_${i}`,
        entityType: 'baseline',
        observations: [`Baseline entity ${i}`]
      }));

      await request(app)
        .post('/api/v1/entities')
        .set('X-API-Key', apiKey)
        .send({ entities });
    });

    it('should have consistent response times for entity retrieval', async () => {
      const responseTimes: number[] = [];

      // Test 10 consecutive requests
      for (let i = 0; i < 10; i++) {
        const startTime = Date.now();
        
        await request(app)
          .get(`/api/v1/entities/BaselineEntity_${i % 10}`)
          .set('X-API-Key', apiKey)
          .expect(200);

        const endTime = Date.now();
        responseTimes.push(endTime - startTime);
      }

      // Calculate statistics
      const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
      const maxResponseTime = Math.max(...responseTimes);
      const minResponseTime = Math.min(...responseTimes);

      expect(avgResponseTime).toBeLessThan(500); // Average less than 500ms
      expect(maxResponseTime).toBeLessThan(1000); // Max less than 1 second
      expect(maxResponseTime - minResponseTime).toBeLessThan(800); // Variance less than 800ms
    }, 15000);

    it('should maintain performance under sustained load', async () => {
      const testDuration = 5000; // 5 seconds
      const startTime = Date.now();
      const responseTimes: number[] = [];
      let requestCount = 0;

      while (Date.now() - startTime < testDuration) {
        const requestStart = Date.now();
        
        await request(app)
          .get('/api/v1/search?q=baseline&limit=10')
          .set('X-API-Key', apiKey)
          .expect(200);

        const requestEnd = Date.now();
        responseTimes.push(requestEnd - requestStart);
        requestCount++;

        // Small delay to prevent overwhelming
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
      
      expect(requestCount).toBeGreaterThan(10); // Should handle multiple requests
      expect(avgResponseTime).toBeLessThan(1000); // Average response time under load
    }, 10000);
  });
});
