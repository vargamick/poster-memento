import { describe, test, expect, vi } from 'vitest';
import { handleFindSimilarEntities } from '../findSimilarEntities.js';

describe('handleFindSimilarEntities', () => {
  test('should find similar entities and return results with scores', async () => {
    // Arrange
    const args = {
      query: 'React component development',
      limit: 5,
      threshold: 0.8,
    };

    const mockSimilarEntities = [
      { name: 'React_Component_Best_Practices', score: 0.95 },
      { name: 'Frontend_Development_Patterns', score: 0.87 },
      { name: 'JavaScript_UI_Components', score: 0.82 },
    ];

    const mockKnowledgeGraphManager = {
      findSimilarEntities: vi.fn().mockResolvedValue(mockSimilarEntities),
    };

    // Act
    const response = await handleFindSimilarEntities(args, mockKnowledgeGraphManager);

    // Assert
    expect(mockKnowledgeGraphManager.findSimilarEntities).toHaveBeenCalledWith(
      args.query,
      { limit: args.limit, threshold: args.threshold }
    );
    expect(response).toEqual({
      content: [
        {
          type: 'text',
          text: JSON.stringify(mockSimilarEntities, null, 2),
        },
      ],
    });
  });

  test('should handle query with default options when limit and threshold not provided', async () => {
    // Arrange
    const args = {
      query: 'machine learning algorithms',
    };

    const mockSimilarEntities = [
      { name: 'ML_Algorithm_Entity', score: 0.92 },
      { name: 'Data_Science_Patterns', score: 0.78 },
    ];

    const mockKnowledgeGraphManager = {
      findSimilarEntities: vi.fn().mockResolvedValue(mockSimilarEntities),
    };

    // Act
    const response = await handleFindSimilarEntities(args, mockKnowledgeGraphManager);

    // Assert
    expect(mockKnowledgeGraphManager.findSimilarEntities).toHaveBeenCalledWith(
      args.query,
      {}
    );
    expect(response).toEqual({
      content: [
        {
          type: 'text',
          text: JSON.stringify(mockSimilarEntities, null, 2),
        },
      ],
    });
  });

  test('should handle empty results gracefully', async () => {
    // Arrange
    const args = {
      query: 'nonexistent topic',
      limit: 10,
    };

    const mockSimilarEntities: Array<{ name: string; score: number }> = [];

    const mockKnowledgeGraphManager = {
      findSimilarEntities: vi.fn().mockResolvedValue(mockSimilarEntities),
    };

    // Act
    const response = await handleFindSimilarEntities(args, mockKnowledgeGraphManager);

    // Assert
    expect(mockKnowledgeGraphManager.findSimilarEntities).toHaveBeenCalledWith(
      args.query,
      { limit: args.limit }
    );
    expect(response).toEqual({
      content: [
        {
          type: 'text',
          text: JSON.stringify([], null, 2),
        },
      ],
    });
  });

  test('should throw error when query is missing', async () => {
    // Arrange
    const args = {
      limit: 5,
      threshold: 0.7,
    };

    const mockKnowledgeGraphManager = {
      findSimilarEntities: vi.fn(),
    };

    // Act & Assert
    await expect(handleFindSimilarEntities(args, mockKnowledgeGraphManager)).rejects.toThrow(
      'Missing required parameter: query'
    );
    expect(mockKnowledgeGraphManager.findSimilarEntities).not.toHaveBeenCalled();
  });

  test('should throw error when query is not a string', async () => {
    // Arrange
    const args = {
      query: 123,
      limit: 5,
    };

    const mockKnowledgeGraphManager = {
      findSimilarEntities: vi.fn(),
    };

    // Act & Assert
    await expect(handleFindSimilarEntities(args, mockKnowledgeGraphManager)).rejects.toThrow(
      'Missing required parameter: query'
    );
    expect(mockKnowledgeGraphManager.findSimilarEntities).not.toHaveBeenCalled();
  });

  test('should throw error when limit is not a number', async () => {
    // Arrange
    const args = {
      query: 'test query',
      limit: 'invalid',
    };

    const mockKnowledgeGraphManager = {
      findSimilarEntities: vi.fn(),
    };

    // Act & Assert
    await expect(handleFindSimilarEntities(args, mockKnowledgeGraphManager)).rejects.toThrow(
      'Parameter "limit" must be a number'
    );
    expect(mockKnowledgeGraphManager.findSimilarEntities).not.toHaveBeenCalled();
  });

  test('should throw error when threshold is not a number', async () => {
    // Arrange
    const args = {
      query: 'test query',
      threshold: 'invalid',
    };

    const mockKnowledgeGraphManager = {
      findSimilarEntities: vi.fn(),
    };

    // Act & Assert
    await expect(handleFindSimilarEntities(args, mockKnowledgeGraphManager)).rejects.toThrow(
      'Parameter "threshold" must be a number'
    );
    expect(mockKnowledgeGraphManager.findSimilarEntities).not.toHaveBeenCalled();
  });

  test('should handle KnowledgeGraphManager errors', async () => {
    // Arrange
    const args = {
      query: 'test query',
      limit: 5,
    };

    const mockKnowledgeGraphManager = {
      findSimilarEntities: vi.fn().mockRejectedValue(new Error('Embedding service not available')),
    };

    // Act & Assert
    await expect(handleFindSimilarEntities(args, mockKnowledgeGraphManager)).rejects.toThrow(
      'Failed to find similar entities: Embedding service not available'
    );
    expect(mockKnowledgeGraphManager.findSimilarEntities).toHaveBeenCalledWith(
      args.query,
      { limit: args.limit }
    );
  });

  test('should handle non-Error exceptions from KnowledgeGraphManager', async () => {
    // Arrange
    const args = {
      query: 'test query',
    };

    const mockKnowledgeGraphManager = {
      findSimilarEntities: vi.fn().mockRejectedValue('String error'),
    };

    // Act & Assert
    await expect(handleFindSimilarEntities(args, mockKnowledgeGraphManager)).rejects.toThrow(
      'Failed to find similar entities: String error'
    );
    expect(mockKnowledgeGraphManager.findSimilarEntities).toHaveBeenCalledWith(
      args.query,
      {}
    );
  });

  test('should handle only limit parameter', async () => {
    // Arrange
    const args = {
      query: 'database optimization',
      limit: 3,
    };

    const mockSimilarEntities = [
      { name: 'Database_Performance', score: 0.89 },
    ];

    const mockKnowledgeGraphManager = {
      findSimilarEntities: vi.fn().mockResolvedValue(mockSimilarEntities),
    };

    // Act
    const response = await handleFindSimilarEntities(args, mockKnowledgeGraphManager);

    // Assert
    expect(mockKnowledgeGraphManager.findSimilarEntities).toHaveBeenCalledWith(
      args.query,
      { limit: args.limit }
    );
    expect(response).toEqual({
      content: [
        {
          type: 'text',
          text: JSON.stringify(mockSimilarEntities, null, 2),
        },
      ],
    });
  });

  test('should handle only threshold parameter', async () => {
    // Arrange
    const args = {
      query: 'API design patterns',
      threshold: 0.9,
    };

    const mockSimilarEntities = [
      { name: 'REST_API_Patterns', score: 0.95 },
    ];

    const mockKnowledgeGraphManager = {
      findSimilarEntities: vi.fn().mockResolvedValue(mockSimilarEntities),
    };

    // Act
    const response = await handleFindSimilarEntities(args, mockKnowledgeGraphManager);

    // Assert
    expect(mockKnowledgeGraphManager.findSimilarEntities).toHaveBeenCalledWith(
      args.query,
      { threshold: args.threshold }
    );
    expect(response).toEqual({
      content: [
        {
          type: 'text',
          text: JSON.stringify(mockSimilarEntities, null, 2),
        },
      ],
    });
  });
});
