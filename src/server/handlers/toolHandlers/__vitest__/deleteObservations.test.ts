import { describe, test, expect, vi } from 'vitest';
import { handleDeleteObservations } from '../deleteObservations.js';

describe('handleDeleteObservations', () => {
  test('should delete observations and return success message', async () => {
    // Arrange
    const args = {
      deletions: [
        {
          entityName: 'Entity1',
          observations: ['observation1', 'observation2'],
        },
        {
          entityName: 'Entity2',
          observations: ['observation3'],
        },
      ],
    };

    const mockKnowledgeGraphManager = {
      deleteObservations: vi.fn().mockResolvedValue(undefined),
    };

    // Act
    const response = await handleDeleteObservations(args, mockKnowledgeGraphManager);

    // Assert
    expect(mockKnowledgeGraphManager.deleteObservations).toHaveBeenCalledWith(args.deletions);
    expect(response).toEqual({
      content: [
        {
          type: 'text',
          text: 'Observations deleted successfully',
        },
      ],
    });
  });
});
