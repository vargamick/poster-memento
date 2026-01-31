import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getGraphStatistics } from '../getGraphStatistics.js';
import type { KnowledgeGraphManager, GraphStatistics } from '../../../../KnowledgeGraphManager.js';

describe('getGraphStatistics', () => {
  let mockKnowledgeGraphManager: KnowledgeGraphManager;

  beforeEach(() => {
    mockKnowledgeGraphManager = {
      getGraphStatistics: vi.fn(),
    } as unknown as KnowledgeGraphManager;
  });

  describe('Basic functionality', () => {
    it('should return basic graph statistics with default options', async () => {
      const mockStatistics: GraphStatistics = {
        totalEntities: 10,
        totalRelations: 15,
        entityTypeDistribution: { person: 5, organization: 3, concept: 2 },
        relationTypeDistribution: { knows: 8, works_for: 4, related_to: 3 },
        graphDensity: 0.167,
        averageConnections: 3.0,
        mostConnectedEntities: [
          { name: 'John Doe', connectionCount: 8 },
          { name: 'ACME Corp', connectionCount: 6 },
        ],
        isolatedEntities: ['Isolated Entity'],
        timestamp: 1640995200000,
      };

      vi.mocked(mockKnowledgeGraphManager.getGraphStatistics).mockResolvedValue(mockStatistics);

      const result = await getGraphStatistics(mockKnowledgeGraphManager, {});

      expect(mockKnowledgeGraphManager.getGraphStatistics).toHaveBeenCalledWith({
        includeAdvanced: false,
        includeClustering: false,
        includeComponents: true,
      });
      expect(result).toEqual(mockStatistics);
    });

    it('should return statistics with advanced metrics when requested', async () => {
      const mockStatistics: GraphStatistics = {
        totalEntities: 20,
        totalRelations: 30,
        entityTypeDistribution: { person: 10, organization: 6, concept: 4 },
        relationTypeDistribution: { knows: 15, works_for: 8, related_to: 7 },
        graphDensity: 0.079,
        averageConnections: 3.0,
        mostConnectedEntities: [
          { name: 'Central Node', connectionCount: 12 },
          { name: 'Hub Entity', connectionCount: 10 },
        ],
        isolatedEntities: [],
        stronglyConnectedComponents: 3,
        weaklyConnectedComponents: 2,
        averagePathLength: 2.5,
        timestamp: 1640995200000,
      };

      vi.mocked(mockKnowledgeGraphManager.getGraphStatistics).mockResolvedValue(mockStatistics);

      const result = await getGraphStatistics(mockKnowledgeGraphManager, {
        includeAdvanced: true,
        includeComponents: true,
      });

      expect(mockKnowledgeGraphManager.getGraphStatistics).toHaveBeenCalledWith({
        includeAdvanced: true,
        includeClustering: false,
        includeComponents: true,
      });
      expect(result).toEqual(mockStatistics);
      expect(result.stronglyConnectedComponents).toBe(3);
      expect(result.weaklyConnectedComponents).toBe(2);
      expect(result.averagePathLength).toBe(2.5);
    });

    it('should return statistics with clustering metrics when requested', async () => {
      const mockStatistics: GraphStatistics = {
        totalEntities: 15,
        totalRelations: 25,
        entityTypeDistribution: { person: 8, organization: 4, concept: 3 },
        relationTypeDistribution: { knows: 12, works_for: 7, related_to: 6 },
        graphDensity: 0.119,
        averageConnections: 3.33,
        mostConnectedEntities: [
          { name: 'Clustered Node', connectionCount: 9 },
          { name: 'Network Hub', connectionCount: 7 },
        ],
        isolatedEntities: ['Lone Entity'],
        clustering: {
          globalClusteringCoefficient: 0.45,
          averageLocalClustering: 0.38,
        },
        timestamp: 1640995200000,
      };

      vi.mocked(mockKnowledgeGraphManager.getGraphStatistics).mockResolvedValue(mockStatistics);

      const result = await getGraphStatistics(mockKnowledgeGraphManager, {
        includeClustering: true,
      });

      expect(mockKnowledgeGraphManager.getGraphStatistics).toHaveBeenCalledWith({
        includeAdvanced: false,
        includeClustering: true,
        includeComponents: true,
      });
      expect(result).toEqual(mockStatistics);
      expect(result.clustering).toBeDefined();
      expect(result.clustering!.globalClusteringCoefficient).toBe(0.45);
      expect(result.clustering!.averageLocalClustering).toBe(0.38);
    });

    it('should return comprehensive statistics with all options enabled', async () => {
      const mockStatistics: GraphStatistics = {
        totalEntities: 50,
        totalRelations: 100,
        entityTypeDistribution: {
          person: 20,
          organization: 15,
          concept: 10,
          location: 5,
        },
        relationTypeDistribution: {
          knows: 30,
          works_for: 25,
          related_to: 20,
          located_in: 15,
          manages: 10,
        },
        graphDensity: 0.041,
        averageConnections: 4.0,
        mostConnectedEntities: [
          { name: 'Super Hub', connectionCount: 25 },
          { name: 'Major Node', connectionCount: 20 },
          { name: 'Important Entity', connectionCount: 18 },
        ],
        isolatedEntities: [],
        stronglyConnectedComponents: 5,
        weaklyConnectedComponents: 3,
        averagePathLength: 3.2,
        clustering: {
          globalClusteringCoefficient: 0.62,
          averageLocalClustering: 0.55,
        },
        timestamp: 1640995200000,
      };

      vi.mocked(mockKnowledgeGraphManager.getGraphStatistics).mockResolvedValue(mockStatistics);

      const result = await getGraphStatistics(mockKnowledgeGraphManager, {
        includeAdvanced: true,
        includeClustering: true,
        includeComponents: true,
      });

      expect(mockKnowledgeGraphManager.getGraphStatistics).toHaveBeenCalledWith({
        includeAdvanced: true,
        includeClustering: true,
        includeComponents: true,
      });
      expect(result).toEqual(mockStatistics);
      expect(result.stronglyConnectedComponents).toBe(5);
      expect(result.clustering).toBeDefined();
      expect(result.averagePathLength).toBe(3.2);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty graph statistics', async () => {
      const mockStatistics: GraphStatistics = {
        totalEntities: 0,
        totalRelations: 0,
        entityTypeDistribution: {},
        relationTypeDistribution: {},
        graphDensity: 0,
        averageConnections: 0,
        mostConnectedEntities: [],
        isolatedEntities: [],
        timestamp: 1640995200000,
      };

      vi.mocked(mockKnowledgeGraphManager.getGraphStatistics).mockResolvedValue(mockStatistics);

      const result = await getGraphStatistics(mockKnowledgeGraphManager, {});

      expect(result).toEqual(mockStatistics);
      expect(result.totalEntities).toBe(0);
      expect(result.totalRelations).toBe(0);
      expect(result.graphDensity).toBe(0);
      expect(result.averageConnections).toBe(0);
    });

    it('should handle single entity graph', async () => {
      const mockStatistics: GraphStatistics = {
        totalEntities: 1,
        totalRelations: 0,
        entityTypeDistribution: { person: 1 },
        relationTypeDistribution: {},
        graphDensity: 0,
        averageConnections: 0,
        mostConnectedEntities: [{ name: 'Only Entity', connectionCount: 0 }],
        isolatedEntities: ['Only Entity'],
        timestamp: 1640995200000,
      };

      vi.mocked(mockKnowledgeGraphManager.getGraphStatistics).mockResolvedValue(mockStatistics);

      const result = await getGraphStatistics(mockKnowledgeGraphManager, {});

      expect(result).toEqual(mockStatistics);
      expect(result.totalEntities).toBe(1);
      expect(result.isolatedEntities).toContain('Only Entity');
    });

    it('should handle large graph statistics', async () => {
      const mockStatistics: GraphStatistics = {
        totalEntities: 10000,
        totalRelations: 50000,
        entityTypeDistribution: {
          person: 5000,
          organization: 2000,
          concept: 1500,
          location: 1000,
          event: 500,
        },
        relationTypeDistribution: {
          knows: 20000,
          works_for: 10000,
          related_to: 8000,
          located_in: 7000,
          participates_in: 5000,
        },
        graphDensity: 0.0005,
        averageConnections: 10.0,
        mostConnectedEntities: [
          { name: 'Mega Hub', connectionCount: 500 },
          { name: 'Super Connector', connectionCount: 450 },
          { name: 'Major Junction', connectionCount: 400 },
        ],
        isolatedEntities: [],
        stronglyConnectedComponents: 50,
        weaklyConnectedComponents: 25,
        averagePathLength: 4.8,
        timestamp: 1640995200000,
      };

      vi.mocked(mockKnowledgeGraphManager.getGraphStatistics).mockResolvedValue(mockStatistics);

      const result = await getGraphStatistics(mockKnowledgeGraphManager, {
        includeAdvanced: true,
      });

      expect(result).toEqual(mockStatistics);
      expect(result.totalEntities).toBe(10000);
      expect(result.totalRelations).toBe(50000);
      expect(result.graphDensity).toBeLessThan(0.001);
    });

    it('should handle graph with only isolated entities', async () => {
      const mockStatistics: GraphStatistics = {
        totalEntities: 5,
        totalRelations: 0,
        entityTypeDistribution: { concept: 5 },
        relationTypeDistribution: {},
        graphDensity: 0,
        averageConnections: 0,
        mostConnectedEntities: [
          { name: 'Entity1', connectionCount: 0 },
          { name: 'Entity2', connectionCount: 0 },
          { name: 'Entity3', connectionCount: 0 },
          { name: 'Entity4', connectionCount: 0 },
          { name: 'Entity5', connectionCount: 0 },
        ],
        isolatedEntities: ['Entity1', 'Entity2', 'Entity3', 'Entity4', 'Entity5'],
        timestamp: 1640995200000,
      };

      vi.mocked(mockKnowledgeGraphManager.getGraphStatistics).mockResolvedValue(mockStatistics);

      const result = await getGraphStatistics(mockKnowledgeGraphManager, {});

      expect(result).toEqual(mockStatistics);
      expect(result.isolatedEntities).toHaveLength(5);
      expect(result.totalRelations).toBe(0);
    });

    it('should handle fully connected small graph', async () => {
      const mockStatistics: GraphStatistics = {
        totalEntities: 4,
        totalRelations: 12, // 4 * 3 = 12 for fully connected directed graph
        entityTypeDistribution: { person: 4 },
        relationTypeDistribution: { knows: 12 },
        graphDensity: 1.0, // Fully connected
        averageConnections: 6.0, // Each node has 3 outgoing + 3 incoming
        mostConnectedEntities: [
          { name: 'Person1', connectionCount: 6 },
          { name: 'Person2', connectionCount: 6 },
          { name: 'Person3', connectionCount: 6 },
          { name: 'Person4', connectionCount: 6 },
        ],
        isolatedEntities: [],
        stronglyConnectedComponents: 1,
        weaklyConnectedComponents: 1,
        averagePathLength: 1.0,
        clustering: {
          globalClusteringCoefficient: 1.0,
          averageLocalClustering: 1.0,
        },
        timestamp: 1640995200000,
      };

      vi.mocked(mockKnowledgeGraphManager.getGraphStatistics).mockResolvedValue(mockStatistics);

      const result = await getGraphStatistics(mockKnowledgeGraphManager, {
        includeAdvanced: true,
        includeClustering: true,
      });

      expect(result).toEqual(mockStatistics);
      expect(result.graphDensity).toBe(1.0);
      expect(result.clustering!.globalClusteringCoefficient).toBe(1.0);
    });
  });

  describe('Parameter handling', () => {
    it('should use default values for undefined parameters', async () => {
      const mockStatistics: GraphStatistics = {
        totalEntities: 5,
        totalRelations: 8,
        entityTypeDistribution: { person: 3, concept: 2 },
        relationTypeDistribution: { knows: 5, related_to: 3 },
        graphDensity: 0.4,
        averageConnections: 3.2,
        mostConnectedEntities: [{ name: 'Popular Entity', connectionCount: 6 }],
        isolatedEntities: [],
        timestamp: 1640995200000,
      };

      vi.mocked(mockKnowledgeGraphManager.getGraphStatistics).mockResolvedValue(mockStatistics);

      await getGraphStatistics(mockKnowledgeGraphManager, {});

      expect(mockKnowledgeGraphManager.getGraphStatistics).toHaveBeenCalledWith({
        includeAdvanced: false,
        includeClustering: false,
        includeComponents: true,
      });
    });

    it('should handle explicit false values', async () => {
      const mockStatistics: GraphStatistics = {
        totalEntities: 3,
        totalRelations: 2,
        entityTypeDistribution: { person: 3 },
        relationTypeDistribution: { knows: 2 },
        graphDensity: 0.33,
        averageConnections: 1.33,
        mostConnectedEntities: [{ name: 'Connected Entity', connectionCount: 2 }],
        isolatedEntities: ['Isolated Entity'],
        timestamp: 1640995200000,
      };

      vi.mocked(mockKnowledgeGraphManager.getGraphStatistics).mockResolvedValue(mockStatistics);

      await getGraphStatistics(mockKnowledgeGraphManager, {
        includeAdvanced: false,
        includeClustering: false,
        includeComponents: false,
      });

      expect(mockKnowledgeGraphManager.getGraphStatistics).toHaveBeenCalledWith({
        includeAdvanced: false,
        includeClustering: false,
        includeComponents: false,
      });
    });

    it('should handle mixed parameter values', async () => {
      const mockStatistics: GraphStatistics = {
        totalEntities: 8,
        totalRelations: 12,
        entityTypeDistribution: { person: 5, organization: 3 },
        relationTypeDistribution: { knows: 7, works_for: 5 },
        graphDensity: 0.214,
        averageConnections: 3.0,
        mostConnectedEntities: [{ name: 'Mixed Entity', connectionCount: 8 }],
        isolatedEntities: [],
        clustering: {
          globalClusteringCoefficient: 0.3,
          averageLocalClustering: 0.25,
        },
        timestamp: 1640995200000,
      };

      vi.mocked(mockKnowledgeGraphManager.getGraphStatistics).mockResolvedValue(mockStatistics);

      await getGraphStatistics(mockKnowledgeGraphManager, {
        includeAdvanced: false,
        includeClustering: true,
        includeComponents: false,
      });

      expect(mockKnowledgeGraphManager.getGraphStatistics).toHaveBeenCalledWith({
        includeAdvanced: false,
        includeClustering: true,
        includeComponents: false,
      });
    });
  });

  describe('Error handling', () => {
    it('should propagate KnowledgeGraphManager errors', async () => {
      const errorMessage = 'Database connection failed';
      vi.mocked(mockKnowledgeGraphManager.getGraphStatistics).mockRejectedValue(
        new Error(errorMessage)
      );

      await expect(getGraphStatistics(mockKnowledgeGraphManager, {})).rejects.toThrow(
        `Failed to get graph statistics: ${errorMessage}`
      );
    });

    it('should handle unknown errors', async () => {
      vi.mocked(mockKnowledgeGraphManager.getGraphStatistics).mockRejectedValue('Unknown error');

      await expect(getGraphStatistics(mockKnowledgeGraphManager, {})).rejects.toThrow(
        'Failed to get graph statistics: Unknown error'
      );
    });

    it('should handle null/undefined errors', async () => {
      vi.mocked(mockKnowledgeGraphManager.getGraphStatistics).mockRejectedValue(null);

      await expect(getGraphStatistics(mockKnowledgeGraphManager, {})).rejects.toThrow(
        'Failed to get graph statistics: Unknown error'
      );
    });

    it('should handle storage provider errors', async () => {
      const storageError = 'Neo4j connection timeout';
      vi.mocked(mockKnowledgeGraphManager.getGraphStatistics).mockRejectedValue(
        new Error(storageError)
      );

      await expect(
        getGraphStatistics(mockKnowledgeGraphManager, { includeAdvanced: true })
      ).rejects.toThrow(`Failed to get graph statistics: ${storageError}`);
    });

    it('should handle computation errors', async () => {
      const computationError = 'Graph algorithm failed';
      vi.mocked(mockKnowledgeGraphManager.getGraphStatistics).mockRejectedValue(
        new Error(computationError)
      );

      await expect(
        getGraphStatistics(mockKnowledgeGraphManager, { includeClustering: true })
      ).rejects.toThrow(`Failed to get graph statistics: ${computationError}`);
    });
  });

  describe('Performance considerations', () => {
    it('should handle statistics calculation for performance testing', async () => {
      const performanceStatistics: GraphStatistics = {
        totalEntities: 1000,
        totalRelations: 5000,
        entityTypeDistribution: { person: 600, organization: 300, concept: 100 },
        relationTypeDistribution: { knows: 2000, works_for: 1500, related_to: 1500 },
        graphDensity: 0.005,
        averageConnections: 10.0,
        mostConnectedEntities: [
          { name: 'Performance Hub', connectionCount: 100 },
          { name: 'Speed Test Node', connectionCount: 95 },
        ],
        isolatedEntities: [],
        stronglyConnectedComponents: 10,
        weaklyConnectedComponents: 5,
        averagePathLength: 3.5,
        clustering: {
          globalClusteringCoefficient: 0.4,
          averageLocalClustering: 0.35,
        },
        timestamp: 1640995200000,
      };

      vi.mocked(mockKnowledgeGraphManager.getGraphStatistics).mockResolvedValue(
        performanceStatistics
      );

      const startTime = Date.now();
      const result = await getGraphStatistics(mockKnowledgeGraphManager, {
        includeAdvanced: true,
        includeClustering: true,
      });
      const endTime = Date.now();

      expect(result).toEqual(performanceStatistics);
      expect(endTime - startTime).toBeLessThan(1000); // Should complete quickly in tests
    });

    it('should handle concurrent statistics requests', async () => {
      const mockStatistics: GraphStatistics = {
        totalEntities: 100,
        totalRelations: 200,
        entityTypeDistribution: { person: 60, organization: 40 },
        relationTypeDistribution: { knows: 120, works_for: 80 },
        graphDensity: 0.02,
        averageConnections: 4.0,
        mostConnectedEntities: [{ name: 'Concurrent Node', connectionCount: 20 }],
        isolatedEntities: [],
        timestamp: 1640995200000,
      };

      vi.mocked(mockKnowledgeGraphManager.getGraphStatistics).mockResolvedValue(mockStatistics);

      // Simulate concurrent requests
      const promises = Array.from({ length: 5 }, () =>
        getGraphStatistics(mockKnowledgeGraphManager, {})
      );

      const results = await Promise.all(promises);

      expect(results).toHaveLength(5);
      results.forEach((result) => {
        expect(result).toEqual(mockStatistics);
      });
      expect(mockKnowledgeGraphManager.getGraphStatistics).toHaveBeenCalledTimes(5);
    });
  });

  describe('Data validation', () => {
    it('should return valid statistics structure', async () => {
      const mockStatistics: GraphStatistics = {
        totalEntities: 25,
        totalRelations: 40,
        entityTypeDistribution: { person: 15, organization: 10 },
        relationTypeDistribution: { knows: 25, works_for: 15 },
        graphDensity: 0.067,
        averageConnections: 3.2,
        mostConnectedEntities: [
          { name: 'Valid Entity', connectionCount: 12 },
          { name: 'Another Entity', connectionCount: 10 },
        ],
        isolatedEntities: ['Isolated One'],
        timestamp: 1640995200000,
      };

      vi.mocked(mockKnowledgeGraphManager.getGraphStatistics).mockResolvedValue(mockStatistics);

      const result = await getGraphStatistics(mockKnowledgeGraphManager, {});

      // Validate required fields
      expect(typeof result.totalEntities).toBe('number');
      expect(typeof result.totalRelations).toBe('number');
      expect(typeof result.entityTypeDistribution).toBe('object');
      expect(typeof result.relationTypeDistribution).toBe('object');
      expect(typeof result.graphDensity).toBe('number');
      expect(typeof result.averageConnections).toBe('number');
      expect(Array.isArray(result.mostConnectedEntities)).toBe(true);
      expect(Array.isArray(result.isolatedEntities)).toBe(true);
      expect(typeof result.timestamp).toBe('number');

      // Validate mostConnectedEntities structure
      result.mostConnectedEntities.forEach((entity) => {
        expect(typeof entity.name).toBe('string');
        expect(typeof entity.connectionCount).toBe('number');
      });
    });

    it('should handle statistics with optional advanced fields', async () => {
      const mockStatistics: GraphStatistics = {
        totalEntities: 30,
        totalRelations: 50,
        entityTypeDistribution: { person: 20, organization: 10 },
        relationTypeDistribution: { knows: 30, works_for: 20 },
        graphDensity: 0.057,
        averageConnections: 3.33,
        mostConnectedEntities: [{ name: 'Advanced Entity', connectionCount: 15 }],
        isolatedEntities: [],
        stronglyConnectedComponents: 5,
        weaklyConnectedComponents: 3,
        averagePathLength: 2.8,
        clustering: {
          globalClusteringCoefficient: 0.5,
          averageLocalClustering: 0.45,
        },
        timestamp: 1640995200000,
      };

      vi.mocked(mockKnowledgeGraphManager.getGraphStatistics).mockResolvedValue(mockStatistics);

      const result = await getGraphStatistics(mockKnowledgeGraphManager, {
        includeAdvanced: true,
        includeClustering: true,
      });

      // Validate optional advanced fields
      expect(typeof result.stronglyConnectedComponents).toBe('number');
      expect(typeof result.weaklyConnectedComponents).toBe('number');
      expect(typeof result.averagePathLength).toBe('number');
      expect(typeof result.clustering).toBe('object');
      expect(typeof result.clustering!.globalClusteringCoefficient).toBe('number');
      expect(typeof result.clustering!.averageLocalClustering).toBe('number');
    });
  });
});
