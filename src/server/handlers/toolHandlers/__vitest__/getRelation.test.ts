import { describe, test, expect, vi } from 'vitest';
import { handleGetRelation } from '../getRelation.js';

describe('handleGetRelation', () => {
  test('should return relation when found', async () => {
    // Arrange
    const args = {
      from: 'Entity1',
      to: 'Entity2',
      relationType: 'knows',
    };

    const mockRelation = {
      from: 'Entity1',
      to: 'Entity2',
      relationType: 'knows',
      strength: 0.8,
      confidence: 0.9,
    };

    const mockKnowledgeGraphManager = {
      getRelation: vi.fn().mockResolvedValue(mockRelation),
    };

    // Act
    const response = await handleGetRelation(args, mockKnowledgeGraphManager);

    // Assert
    expect(mockKnowledgeGraphManager.getRelation).toHaveBeenCalledWith(
      args.from,
      args.to,
      args.relationType
    );
    expect(response).toEqual({
      content: [
        {
          type: 'text',
          text: JSON.stringify(mockRelation, null, 2),
        },
      ],
    });
  });

  test('should return not found message when relation does not exist', async () => {
    // Arrange
    const args = {
      from: 'Entity1',
      to: 'Entity2',
      relationType: 'knows',
    };

    const mockKnowledgeGraphManager = {
      getRelation: vi.fn().mockResolvedValue(null),
    };

    // Act
    const response = await handleGetRelation(args, mockKnowledgeGraphManager);

    // Assert
    expect(mockKnowledgeGraphManager.getRelation).toHaveBeenCalledWith(
      args.from,
      args.to,
      args.relationType
    );
    expect(response).toEqual({
      content: [
        {
          type: 'text',
          text: `Relation not found: ${args.from} -> ${args.relationType} -> ${args.to}`,
        },
      ],
    });
  });
});
