import { describe, test, expect, vi } from 'vitest';
import { handleUpdateRelation } from '../updateRelation.js';

describe('handleUpdateRelation', () => {
  test('should update relation and return success message', async () => {
    // Arrange
    const args = {
      relation: {
        from: 'Entity1',
        to: 'Entity2',
        relationType: 'knows',
        strength: 0.9,
        confidence: 0.95,
        metadata: {
          source: 'user_input',
          timestamp: Date.now(),
        },
      },
    };

    const mockKnowledgeGraphManager = {
      updateRelation: vi.fn().mockResolvedValue(args.relation),
    };

    // Act
    const response = await handleUpdateRelation(args, mockKnowledgeGraphManager);

    // Assert
    expect(mockKnowledgeGraphManager.updateRelation).toHaveBeenCalledWith(args.relation);
    expect(response).toEqual({
      content: [
        {
          type: 'text',
          text: 'Relation updated successfully',
        },
      ],
    });
  });
});
