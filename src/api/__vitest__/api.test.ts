import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import { createApiServer } from '../server.js';
import { FileStorageProvider } from '../../storage/FileStorageProvider.js';
import { logger } from '../../utils/logger.js';
import { promises as fs } from 'fs';
import path from 'path';
import { tmpdir } from 'os';

describe('Memento MCP API Integration Tests', () => {
  let app: Application;
  let storageProvider: FileStorageProvider;
  let testDataDir: string;
  let apiKey: string;

  // Test data
  const testEntities = [
    {
      name: 'TestUser_001',
      entityType: 'person',
      observations: ['Software developer', 'Works on AI projects', 'Based in Melbourne']
    },
    {
      name: 'TestProject_001',
      entityType: 'project',
      observations: ['Knowledge graph system', 'TypeScript implementation', 'MCP protocol']
    }
  ];

  const testRelations = [
    {
      from: 'TestUser_001',
      to: 'TestProject_001',
      relationType: 'works_on'
    }
  ];

  beforeAll(async () => {
    // Create temporary directory for test data
    testDataDir = path.join(tmpdir(), `memento-api-test-${Date.now()}`);
    await fs.mkdir(testDataDir, { recursive: true });

    // Initialize storage provider with proper options
    storageProvider = new FileStorageProvider({
      memoryFilePath: path.join(testDataDir, 'memory.json')
    });

    // Set up API key for testing
    apiKey = 'test-api-key-12345';

    // Create API server with test configuration
    app = createApiServer(
      { storageProvider },
      {
        requireApiKey: true,
        apiKeys: [apiKey],
        enableCors: true
      }
    );

    // Note: logger doesn't have a level property, so we'll just leave it as is
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

  describe('Health and Info Endpoints', () => {
    it('should return health status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toMatchObject({
        status: 'healthy',
        timestamp: expect.any(String),
        uptime: expect.any(Number)
      });
    });

    it('should return API information', async () => {
      const response = await request(app)
        .get('/api')
        .expect(200);

      expect(response.body).toMatchObject({
        name: 'Memento MCP API',
        version: '1.0.0',
        description: 'REST API for Memento MCP Knowledge Graph',
        endpoints: expect.any(Object)
      });
    });
  });

  describe('Authentication', () => {
    it('should accept valid API key', async () => {
      const response = await request(app)
        .get('/api/v1/entities?q=test')
        .set('X-API-Key', apiKey)
        .expect(200);

      expect(response.body).toBeDefined();
    });

    it('should reject invalid API key', async () => {
      await request(app)
        .get('/api/v1/entities?q=test')
        .set('X-API-Key', 'invalid-key')
        .expect(401);
    });

    it('should reject requests without API key', async () => {
      await request(app)
        .get('/api/v1/entities?q=test')
        .expect(401);
    });
  });

  describe('Entity Management', () => {
    it('should create a single entity', async () => {
      const response = await request(app)
        .post('/api/v1/entities')
        .set('X-API-Key', apiKey)
        .send({ entities: [testEntities[0]] })
        .expect(201);

      expect(response.body.data).toBeDefined();
      expect(response.body.data.entities).toHaveLength(1);
      expect(response.body.data.entities[0]).toMatchObject({
        name: testEntities[0].name,
        entityType: testEntities[0].entityType
      });
    });

    it('should create multiple entities', async () => {
      const response = await request(app)
        .post('/api/v1/entities')
        .set('X-API-Key', apiKey)
        .send({ entities: testEntities })
        .expect(201);

      expect(response.body.data.entities).toHaveLength(2);
    });

    it('should get entity by name', async () => {
      // First create the entity
      await request(app)
        .post('/api/v1/entities')
        .set('X-API-Key', apiKey)
        .send({ entities: [testEntities[0]] });

      // Then retrieve it
      const response = await request(app)
        .get(`/api/v1/entities/${testEntities[0].name}`)
        .set('X-API-Key', apiKey)
        .expect(200);

      expect(response.body.data).toMatchObject({
        name: testEntities[0].name,
        entityType: testEntities[0].entityType
      });
    });

    it('should update entity', async () => {
      // First create the entity
      await request(app)
        .post('/api/v1/entities')
        .set('X-API-Key', apiKey)
        .send({ entities: [testEntities[0]] });

      // Then update it
      const updates = {
        observations: ['Updated observation 1', 'Updated observation 2']
      };

      const response = await request(app)
        .put(`/api/v1/entities/${testEntities[0].name}`)
        .set('X-API-Key', apiKey)
        .send({ updates })
        .expect(200);

      expect(response.body.data.observations).toEqual(updates.observations);
    });

    it('should delete entity', async () => {
      // First create the entity
      await request(app)
        .post('/api/v1/entities')
        .set('X-API-Key', apiKey)
        .send({ entities: [testEntities[0]] });

      // Then delete it
      await request(app)
        .delete(`/api/v1/entities/${testEntities[0].name}`)
        .set('X-API-Key', apiKey)
        .expect(204);

      // Verify it's gone
      await request(app)
        .get(`/api/v1/entities/${testEntities[0].name}`)
        .set('X-API-Key', apiKey)
        .expect(404);
    });

    it('should add observations to entity', async () => {
      // First create the entity
      await request(app)
        .post('/api/v1/entities')
        .set('X-API-Key', apiKey)
        .send({ entities: [testEntities[0]] });

      // Then add observations
      const newObservations = ['New observation 1', 'New observation 2'];
      
      await request(app)
        .post(`/api/v1/entities/${testEntities[0].name}/observations`)
        .set('X-API-Key', apiKey)
        .send({ contents: newObservations })
        .expect(201);

      // Verify observations were added
      const response = await request(app)
        .get(`/api/v1/entities/${testEntities[0].name}`)
        .set('X-API-Key', apiKey)
        .expect(200);

      expect(response.body.data.observations).toEqual(
        expect.arrayContaining(newObservations)
      );
    });

    it('should delete observations from entity', async () => {
      // First create the entity
      await request(app)
        .post('/api/v1/entities')
        .set('X-API-Key', apiKey)
        .send({ entities: [testEntities[0]] });

      // Then delete specific observations
      const observationsToDelete = [testEntities[0].observations[0]];
      
      await request(app)
        .delete(`/api/v1/entities/${testEntities[0].name}/observations`)
        .set('X-API-Key', apiKey)
        .send({ observations: observationsToDelete })
        .expect(204);

      // Verify observation was removed
      const response = await request(app)
        .get(`/api/v1/entities/${testEntities[0].name}`)
        .set('X-API-Key', apiKey)
        .expect(200);

      expect(response.body.data.observations).not.toContain(observationsToDelete[0]);
    });

    it('should handle entity not found', async () => {
      await request(app)
        .get('/api/v1/entities/NonExistentEntity')
        .set('X-API-Key', apiKey)
        .expect(404);
    });

    it('should validate entity creation', async () => {
      const invalidEntity = {
        entities: [{
          name: '',
          entityType: 'test'
        }]
      };

      await request(app)
        .post('/api/v1/entities')
        .set('X-API-Key', apiKey)
        .send(invalidEntity)
        .expect(400);
    });
  });

  describe('Relation Management', () => {
    beforeEach(async () => {
      // Create test entities for relation tests
      await request(app)
        .post('/api/v1/entities')
        .set('X-API-Key', apiKey)
        .send({ entities: testEntities });
    });

    it('should create a single relation', async () => {
      const response = await request(app)
        .post('/api/v1/relations')
        .set('X-API-Key', apiKey)
        .send({ relations: [testRelations[0]] })
        .expect(201);

      expect(response.body.data.relations).toHaveLength(1);
      expect(response.body.data.relations[0]).toMatchObject(testRelations[0]);
    });

    it('should create multiple relations', async () => {
      const multipleRelations = [
        testRelations[0],
        {
          from: 'TestUser_001',
          to: 'TestProject_001',
          relationType: 'manages'
        }
      ];

      const response = await request(app)
        .post('/api/v1/relations')
        .set('X-API-Key', apiKey)
        .send({ relations: multipleRelations })
        .expect(201);

      expect(response.body.data.relations).toHaveLength(2);
    });

    it('should get specific relation', async () => {
      // First create the relation
      await request(app)
        .post('/api/v1/relations')
        .set('X-API-Key', apiKey)
        .send({ relations: [testRelations[0]] });

      // Then retrieve it
      const response = await request(app)
        .get(`/api/v1/relations/${testRelations[0].from}/${testRelations[0].to}/${testRelations[0].relationType}`)
        .set('X-API-Key', apiKey)
        .expect(200);

      expect(response.body.data).toMatchObject(testRelations[0]);
    });

    it('should update relation', async () => {
      // First create the relation
      await request(app)
        .post('/api/v1/relations')
        .set('X-API-Key', apiKey)
        .send({ relations: [testRelations[0]] });

      // Then update it
      const updates = {
        strength: 0.9,
        confidence: 0.8
      };

      const response = await request(app)
        .put(`/api/v1/relations/${testRelations[0].from}/${testRelations[0].to}/${testRelations[0].relationType}`)
        .set('X-API-Key', apiKey)
        .send({ updates })
        .expect(200);

      expect(response.body.data.strength).toBe(updates.strength);
      expect(response.body.data.confidence).toBe(updates.confidence);
    });

    it('should delete relations', async () => {
      // First create the relation
      await request(app)
        .post('/api/v1/relations')
        .set('X-API-Key', apiKey)
        .send({ relations: [testRelations[0]] });

      // Then delete it
      await request(app)
        .delete('/api/v1/relations')
        .set('X-API-Key', apiKey)
        .send({ relations: [testRelations[0]] })
        .expect(204);

      // Verify it's gone
      await request(app)
        .get(`/api/v1/relations/${testRelations[0].from}/${testRelations[0].to}/${testRelations[0].relationType}`)
        .set('X-API-Key', apiKey)
        .expect(404);
    });

    it('should handle relation not found', async () => {
      await request(app)
        .get('/api/v1/relations/NonExistent/Entity/relation_type')
        .set('X-API-Key', apiKey)
        .expect(404);
    });

    it('should validate relation creation', async () => {
      const invalidRelation = {
        relations: [{
          from: '',
          to: 'TestProject_001',
          relationType: 'works_on'
        }]
      };

      await request(app)
        .post('/api/v1/relations')
        .set('X-API-Key', apiKey)
        .send(invalidRelation)
        .expect(400);
    });
  });

  describe('Search Functionality', () => {
    beforeEach(async () => {
      // Create test entities for search tests
      await request(app)
        .post('/api/v1/entities')
        .set('X-API-Key', apiKey)
        .send({ entities: testEntities });
    });

    it('should perform basic text search', async () => {
      const response = await request(app)
        .get('/api/v1/search?q=software&limit=10')
        .set('X-API-Key', apiKey)
        .expect(200);

      expect(response.body.data).toBeDefined();
      expect(response.body.pagination).toMatchObject({
        limit: 10,
        offset: 0
      });
    });

    it('should search with filters', async () => {
      const response = await request(app)
        .get('/api/v1/search?q=test&entityTypes=person,project&limit=5')
        .set('X-API-Key', apiKey)
        .expect(200);

      expect(response.body.data).toBeDefined();
      expect(response.body.pagination.limit).toBe(5);
    });

    it('should handle empty search query', async () => {
      await request(app)
        .get('/api/v1/search?q=')
        .set('X-API-Key', apiKey)
        .expect(400);
    });

    it('should support pagination', async () => {
      const response = await request(app)
        .get('/api/v1/search?q=test&limit=5&offset=5')
        .set('X-API-Key', apiKey)
        .expect(200);

      expect(response.body.pagination).toMatchObject({
        limit: 5,
        offset: 5
      });
    });
  });

  describe('Analytics Endpoints', () => {
    beforeEach(async () => {
      // Create test data for analytics
      await request(app)
        .post('/api/v1/entities')
        .set('X-API-Key', apiKey)
        .send({ entities: testEntities });

      await request(app)
        .post('/api/v1/relations')
        .set('X-API-Key', apiKey)
        .send({ relations: testRelations });
    });

    it('should return graph statistics or not implemented', async () => {
      const response = await request(app)
        .get('/api/v1/analytics/statistics')
        .set('X-API-Key', apiKey);

      // Should be either 200 with statistics or 501 not implemented
      expect([200, 501]).toContain(response.status);

      if (response.status === 200) {
        expect(response.body.data).toBeDefined();
      }
    });

    it('should return system health', async () => {
      const response = await request(app)
        .get('/api/v1/analytics/health')
        .set('X-API-Key', apiKey);

      // Should be either 200 with health data or 501 not implemented
      expect([200, 501]).toContain(response.status);

      if (response.status === 200) {
        expect(response.body).toMatchObject({
          uptime: expect.any(Number)
        });
      }
    });
  });

  describe('Temporal Queries', () => {
    it('should handle graph at timestamp or return not implemented', async () => {
      const timestamp = Date.now();
      const response = await request(app)
        .get(`/api/v1/temporal/graph/${timestamp}`)
        .set('X-API-Key', apiKey);

      // Should be either 200 with historical data or 501 not implemented
      expect([200, 501]).toContain(response.status);
    });

    it('should handle entity history or return not implemented', async () => {
      // First create an entity
      await request(app)
        .post('/api/v1/entities')
        .set('X-API-Key', apiKey)
        .send({ entities: [testEntities[0]] });

      const response = await request(app)
        .get(`/api/v1/temporal/entity/${testEntities[0].name}/history`)
        .set('X-API-Key', apiKey);

      // Should be either 200 with history or 501 not implemented
      expect([200, 501]).toContain(response.status);
    });

    it('should handle invalid timestamp', async () => {
      await request(app)
        .get('/api/v1/temporal/graph/invalid-timestamp')
        .set('X-API-Key', apiKey)
        .expect(400);
    });
  });

  describe('Expertise Areas', () => {
    it('should list expertise areas', async () => {
      const response = await request(app)
        .get('/api/v1/expertise-areas')
        .set('X-API-Key', apiKey)
        .expect(200);

      expect(response.body.data).toBeDefined();
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('should get expertise area details', async () => {
      const response = await request(app)
        .get('/api/v1/expertise-areas/software-development')
        .set('X-API-Key', apiKey);

      // Should be either 200 with details or 404 not found
      expect([200, 404]).toContain(response.status);
    });

    it('should handle non-existent expertise area', async () => {
      await request(app)
        .get('/api/v1/expertise-areas/non-existent-area')
        .set('X-API-Key', apiKey)
        .expect(404);
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed JSON', async () => {
      await request(app)
        .post('/api/v1/entities')
        .set('X-API-Key', apiKey)
        .set('Content-Type', 'application/json')
        .send('{ invalid json }')
        .expect(400);
    });

    it('should handle unsupported HTTP method', async () => {
      await request(app)
        .patch('/api/v1/entities')
        .set('X-API-Key', apiKey)
        .expect(405);
    });

    it('should handle non-existent endpoint', async () => {
      await request(app)
        .get('/api/v1/non-existent-endpoint')
        .set('X-API-Key', apiKey)
        .expect(404);
    });
  });

  describe('Integration Tests', () => {
    it('should complete entity lifecycle', async () => {
      const entityName = 'TestEntity_Lifecycle';
      const entity = {
        name: entityName,
        entityType: 'test',
        observations: ['Initial observation']
      };

      // 1. Create entity
      await request(app)
        .post('/api/v1/entities')
        .set('X-API-Key', apiKey)
        .send({ entities: [entity] })
        .expect(201);

      // 2. Retrieve entity
      await request(app)
        .get(`/api/v1/entities/${entityName}`)
        .set('X-API-Key', apiKey)
        .expect(200);

      // 3. Update entity
      await request(app)
        .put(`/api/v1/entities/${entityName}`)
        .set('X-API-Key', apiKey)
        .send({ updates: { observations: ['Updated observation'] } })
        .expect(200);

      // 4. Add observations
      await request(app)
        .post(`/api/v1/entities/${entityName}/observations`)
        .set('X-API-Key', apiKey)
        .send({ contents: ['Additional observation'] })
        .expect(201);

      // 5. Search for entity
      const searchResponse = await request(app)
        .get(`/api/v1/search?q=${entityName}`)
        .set('X-API-Key', apiKey)
        .expect(200);

      expect(searchResponse.body.data).toBeDefined();

      // 6. Delete entity
      await request(app)
        .delete(`/api/v1/entities/${entityName}`)
        .set('X-API-Key', apiKey)
        .expect(204);

      // 7. Verify entity is gone
      await request(app)
        .get(`/api/v1/entities/${entityName}`)
        .set('X-API-Key', apiKey)
        .expect(404);
    });

    it('should handle entity-relation integration', async () => {
      // 1. Create entities
      await request(app)
        .post('/api/v1/entities')
        .set('X-API-Key', apiKey)
        .send({ entities: testEntities })
        .expect(201);

      // 2. Create relation
      await request(app)
        .post('/api/v1/relations')
        .set('X-API-Key', apiKey)
        .send({ relations: testRelations })
        .expect(201);

      // 3. Verify relation exists
      await request(app)
        .get(`/api/v1/relations/${testRelations[0].from}/${testRelations[0].to}/${testRelations[0].relationType}`)
        .set('X-API-Key', apiKey)
        .expect(200);

      // 4. Delete one entity
      await request(app)
        .delete(`/api/v1/entities/${testEntities[0].name}`)
        .set('X-API-Key', apiKey)
        .expect(204);

      // 5. Verify relation handling (implementation dependent)
      const relationResponse = await request(app)
        .get(`/api/v1/relations/${testRelations[0].from}/${testRelations[0].to}/${testRelations[0].relationType}`)
        .set('X-API-Key', apiKey);

      // Relation might be deleted (cascade) or return 404
      expect([200, 404]).toContain(relationResponse.status);
    });
  });
});
