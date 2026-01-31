import { describe, test, expect, vi } from 'vitest';
import { handleDeleteRelations } from '../deleteRelations.js';

describe('handleDeleteRelations', () => {
  test('should delete relations and return success message', async () => {
    // Arrange
    const args = {
      relations: [
        {
          from: 'Entity1',
          to: 'Entity2',
          relationType: 'knows',
        },
        {
          from: 'Entity2',
          to: 'Entity3',
          relationType: 'likes',
        },
      ],
    };

    const mockKnowledgeGraphManager = {
      deleteRelations: vi.fn().mockResolvedValue(undefined),
    };

    // Act
    const response = await handleDeleteRelations(args, mockKnowledgeGraphManager);

    // Assert
    expect(mockKnowledgeGraphManager.deleteRelations).toHaveBeenCalledWith(args.relations);
    expect(response).toEqual({
      content: [
        {
          type: 'text',
          text: 'Relations deleted successfully',
        },
      ],
    });
  });
});
