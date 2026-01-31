import { describe, test, expect, vi } from 'vitest';
import { handleAdvancedSearch } from '../advancedSearch.js';

describe('handleAdvancedSearch', () => {
  test('should perform advanced search with all options and return results', async () => {
    // Arrange
    const args = {
      query: 'React component development',
      semanticSearch: true,
      hybridSearch: false,
      limit: 5,
      threshold: 0.8,
      minSimilarity: 0.7,
      entityTypes: ['component', 'pattern'],
      facets: ['frontend', 'react'],
      offset: 0,
    };

    const mockSearchResults = {
      entities: [
        {
          name: 'React_Component_Best_Practices',
          entityType: 'component',
          observations: ['Best practices for React components'],
        },
        {
          name: 'Frontend_Development_Patterns',
          entityType: 'pattern',
          observations: ['Common frontend patterns'],
        },
      ],
      relations: [
        {
          from: 'React_Component_Best_Practices',
          to: 'Frontend_Development_Patterns',
          relationType: 'relates_to',
        },
      ],
      total: 2,
      timeTaken: 150,
    };

    const mockKnowledgeGraphManager = {
      search: vi.fn().mockResolvedValue(mockSearchResults),
    };

    // Act
    const response = await handleAdvancedSearch(args, mockKnowledgeGraphManager);

    // Assert
    expect(mockKnowledgeGraphManager.search).toHaveBeenCalledWith(args.query, {
      semanticSearch: args.semanticSearch,
      hybridSearch: args.hybridSearch,
      limit: args.limit,
      threshold: args.threshold,
      minSimilarity: args.minSimilarity,
      entityTypes: args.entityTypes,
      facets: args.facets,
      offset: args.offset,
    });
    expect(response).toEqual({
      content: [
        {
          type: 'text',
          text: JSON.stringify(mockSearchResults, null, 2),
        },
      ],
    });
  });

  test('should handle query with default options when no optional parameters provided', async () => {
    // Arrange
    const args = {
      query: 'machine learning algorithms',
    };

    const mockSearchResults = {
      entities: [
        {
          name: 'ML_Algorithm_Entity',
          entityType: 'algorithm',
          observations: ['Machine learning algorithm details'],
        },
      ],
      relations: [],
      total: 1,
    };

    const mockKnowledgeGraphManager = {
      search: vi.fn().mockResolvedValue(mockSearchResults),
    };

    // Act
    const response = await handleAdvancedSearch(args, mockKnowledgeGraphManager);

    // Assert
    expect(mockKnowledgeGraphManager.search).toHaveBeenCalledWith(args.query, {});
    expect(response).toEqual({
      content: [
        {
          type: 'text',
          text: JSON.stringify(mockSearchResults, null, 2),
        },
      ],
    });
  });

  test('should handle semantic search only', async () => {
    // Arrange
    const args = {
      query: 'database optimization',
      semanticSearch: true,
      limit: 10,
    };

    const mockSearchResults = {
      entities: [
        {
          name: 'Database_Performance',
          entityType: 'optimization',
          observations: ['Database performance optimization techniques'],
        },
      ],
      relations: [],
      total: 1,
    };

    const mockKnowledgeGraphManager = {
      search: vi.fn().mockResolvedValue(mockSearchResults),
    };

    // Act
    const response = await handleAdvancedSearch(args, mockKnowledgeGraphManager);

    // Assert
    expect(mockKnowledgeGraphManager.search).toHaveBeenCalledWith(args.query, {
      semanticSearch: args.semanticSearch,
      limit: args.limit,
    });
    expect(response).toEqual({
      content: [
        {
          type: 'text',
          text: JSON.stringify(mockSearchResults, null, 2),
        },
      ],
    });
  });

  test('should handle hybrid search', async () => {
    // Arrange
    const args = {
      query: 'API design patterns',
      hybridSearch: true,
      threshold: 0.9,
      entityTypes: ['pattern', 'api'],
    };

    const mockSearchResults = {
      entities: [
        {
          name: 'REST_API_Patterns',
          entityType: 'pattern',
          observations: ['RESTful API design patterns'],
        },
      ],
      relations: [],
      total: 1,
    };

    const mockKnowledgeGraphManager = {
      search: vi.fn().mockResolvedValue(mockSearchResults),
    };

    // Act
    const response = await handleAdvancedSearch(args, mockKnowledgeGraphManager);

    // Assert
    expect(mockKnowledgeGraphManager.search).toHaveBeenCalledWith(args.query, {
      hybridSearch: args.hybridSearch,
      threshold: args.threshold,
      entityTypes: args.entityTypes,
    });
    expect(response).toEqual({
      content: [
        {
          type: 'text',
          text: JSON.stringify(mockSearchResults, null, 2),
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

    const mockSearchResults = {
      entities: [],
      relations: [],
      total: 0,
    };

    const mockKnowledgeGraphManager = {
      search: vi.fn().mockResolvedValue(mockSearchResults),
    };

    // Act
    const response = await handleAdvancedSearch(args, mockKnowledgeGraphManager);

    // Assert
    expect(mockKnowledgeGraphManager.search).toHaveBeenCalledWith(args.query, {
      limit: args.limit,
    });
    expect(response).toEqual({
      content: [
        {
          type: 'text',
          text: JSON.stringify(mockSearchResults, null, 2),
        },
      ],
    });
  });

  test('should throw error when query is missing', async () => {
    // Arrange
    const args = {
      limit: 5,
      semanticSearch: true,
    };

    const mockKnowledgeGraphManager = {
      search: vi.fn(),
    };

    // Act & Assert
    await expect(handleAdvancedSearch(args, mockKnowledgeGraphManager)).rejects.toThrow(
      'Missing required parameter: query'
    );
    expect(mockKnowledgeGraphManager.search).not.toHaveBeenCalled();
  });

  test('should throw error when query is not a string', async () => {
    // Arrange
    const args = {
      query: 123,
      limit: 5,
    };

    const mockKnowledgeGraphManager = {
      search: vi.fn(),
    };

    // Act & Assert
    await expect(handleAdvancedSearch(args, mockKnowledgeGraphManager)).rejects.toThrow(
      'Missing required parameter: query'
    );
    expect(mockKnowledgeGraphManager.search).not.toHaveBeenCalled();
  });

  test('should throw error when semanticSearch is not a boolean', async () => {
    // Arrange
    const args = {
      query: 'test query',
      semanticSearch: 'invalid',
    };

    const mockKnowledgeGraphManager = {
      search: vi.fn(),
    };

    // Act & Assert
    await expect(handleAdvancedSearch(args, mockKnowledgeGraphManager)).rejects.toThrow(
      'Parameter "semanticSearch" must be a boolean'
    );
    expect(mockKnowledgeGraphManager.search).not.toHaveBeenCalled();
  });

  test('should throw error when hybridSearch is not a boolean', async () => {
    // Arrange
    const args = {
      query: 'test query',
      hybridSearch: 'invalid',
    };

    const mockKnowledgeGraphManager = {
      search: vi.fn(),
    };

    // Act & Assert
    await expect(handleAdvancedSearch(args, mockKnowledgeGraphManager)).rejects.toThrow(
      'Parameter "hybridSearch" must be a boolean'
    );
    expect(mockKnowledgeGraphManager.search).not.toHaveBeenCalled();
  });

  test('should throw error when limit is not a number', async () => {
    // Arrange
    const args = {
      query: 'test query',
      limit: 'invalid',
    };

    const mockKnowledgeGraphManager = {
      search: vi.fn(),
    };

    // Act & Assert
    await expect(handleAdvancedSearch(args, mockKnowledgeGraphManager)).rejects.toThrow(
      'Parameter "limit" must be a number'
    );
    expect(mockKnowledgeGraphManager.search).not.toHaveBeenCalled();
  });

  test('should throw error when threshold is not a number', async () => {
    // Arrange
    const args = {
      query: 'test query',
      threshold: 'invalid',
    };

    const mockKnowledgeGraphManager = {
      search: vi.fn(),
    };

    // Act & Assert
    await expect(handleAdvancedSearch(args, mockKnowledgeGraphManager)).rejects.toThrow(
      'Parameter "threshold" must be a number'
    );
    expect(mockKnowledgeGraphManager.search).not.toHaveBeenCalled();
  });

  test('should throw error when minSimilarity is not a number', async () => {
    // Arrange
    const args = {
      query: 'test query',
      minSimilarity: 'invalid',
    };

    const mockKnowledgeGraphManager = {
      search: vi.fn(),
    };

    // Act & Assert
    await expect(handleAdvancedSearch(args, mockKnowledgeGraphManager)).rejects.toThrow(
      'Parameter "minSimilarity" must be a number'
    );
    expect(mockKnowledgeGraphManager.search).not.toHaveBeenCalled();
  });

  test('should throw error when entityTypes is not an array', async () => {
    // Arrange
    const args = {
      query: 'test query',
      entityTypes: 'invalid',
    };

    const mockKnowledgeGraphManager = {
      search: vi.fn(),
    };

    // Act & Assert
    await expect(handleAdvancedSearch(args, mockKnowledgeGraphManager)).rejects.toThrow(
      'Parameter "entityTypes" must be an array'
    );
    expect(mockKnowledgeGraphManager.search).not.toHaveBeenCalled();
  });

  test('should throw error when entityTypes contains non-string items', async () => {
    // Arrange
    const args = {
      query: 'test query',
      entityTypes: ['valid', 123, 'also_valid'],
    };

    const mockKnowledgeGraphManager = {
      search: vi.fn(),
    };

    // Act & Assert
    await expect(handleAdvancedSearch(args, mockKnowledgeGraphManager)).rejects.toThrow(
      'All items in "entityTypes" must be strings'
    );
    expect(mockKnowledgeGraphManager.search).not.toHaveBeenCalled();
  });

  test('should throw error when facets is not an array', async () => {
    // Arrange
    const args = {
      query: 'test query',
      facets: 'invalid',
    };

    const mockKnowledgeGraphManager = {
      search: vi.fn(),
    };

    // Act & Assert
    await expect(handleAdvancedSearch(args, mockKnowledgeGraphManager)).rejects.toThrow(
      'Parameter "facets" must be an array'
    );
    expect(mockKnowledgeGraphManager.search).not.toHaveBeenCalled();
  });

  test('should throw error when facets contains non-string items', async () => {
    // Arrange
    const args = {
      query: 'test query',
      facets: ['valid', 123, 'also_valid'],
    };

    const mockKnowledgeGraphManager = {
      search: vi.fn(),
    };

    // Act & Assert
    await expect(handleAdvancedSearch(args, mockKnowledgeGraphManager)).rejects.toThrow(
      'All items in "facets" must be strings'
    );
    expect(mockKnowledgeGraphManager.search).not.toHaveBeenCalled();
  });

  test('should throw error when offset is not a number', async () => {
    // Arrange
    const args = {
      query: 'test query',
      offset: 'invalid',
    };

    const mockKnowledgeGraphManager = {
      search: vi.fn(),
    };

    // Act & Assert
    await expect(handleAdvancedSearch(args, mockKnowledgeGraphManager)).rejects.toThrow(
      'Parameter "offset" must be a number'
    );
    expect(mockKnowledgeGraphManager.search).not.toHaveBeenCalled();
  });

  test('should handle KnowledgeGraphManager errors', async () => {
    // Arrange
    const args = {
      query: 'test query',
      semanticSearch: true,
    };

    const mockKnowledgeGraphManager = {
      search: vi.fn().mockRejectedValue(new Error('Embedding service not available')),
    };

    // Act & Assert
    await expect(handleAdvancedSearch(args, mockKnowledgeGraphManager)).rejects.toThrow(
      'Failed to perform advanced search: Embedding service not available'
    );
    expect(mockKnowledgeGraphManager.search).toHaveBeenCalledWith(args.query, {
      semanticSearch: args.semanticSearch,
    });
  });

  test('should handle non-Error exceptions from KnowledgeGraphManager', async () => {
    // Arrange
    const args = {
      query: 'test query',
    };

    const mockKnowledgeGraphManager = {
      search: vi.fn().mockRejectedValue('String error'),
    };

    // Act & Assert
    await expect(handleAdvancedSearch(args, mockKnowledgeGraphManager)).rejects.toThrow(
      'Failed to perform advanced search: String error'
    );
    expect(mockKnowledgeGraphManager.search).toHaveBeenCalledWith(args.query, {});
  });

  test('should handle partial options correctly', async () => {
    // Arrange
    const args = {
      query: 'partial options test',
      semanticSearch: true,
      limit: 15,
      entityTypes: ['test', 'partial'],
    };

    const mockSearchResults = {
      entities: [
        {
          name: 'Test_Entity',
          entityType: 'test',
          observations: ['Test entity for partial options'],
        },
      ],
      relations: [],
      total: 1,
    };

    const mockKnowledgeGraphManager = {
      search: vi.fn().mockResolvedValue(mockSearchResults),
    };

    // Act
    const response = await handleAdvancedSearch(args, mockKnowledgeGraphManager);

    // Assert
    expect(mockKnowledgeGraphManager.search).toHaveBeenCalledWith(args.query, {
      semanticSearch: args.semanticSearch,
      limit: args.limit,
      entityTypes: args.entityTypes,
    });
    expect(response).toEqual({
      content: [
        {
          type: 'text',
          text: JSON.stringify(mockSearchResults, null, 2),
        },
      ],
    });
  });
});
