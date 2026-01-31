import { describe, test, expect, vi } from 'vitest';
import { handleUpdateEntity } from '../updateEntity.js';

describe('handleUpdateEntity', () => {
  test('should update entity and return updated entity data', async () => {
    // Arrange
    const args = {
      entityName: 'TestEntity',
      updates: {
        entityType: 'updatedType',
        observations: ['new observation 1', 'new observation 2'],
      },
    };

    const mockUpdatedEntity = {
      name: 'TestEntity',
      entityType: 'updatedType',
      observations: ['existing observation', 'new observation 1', 'new observation 2'],
    };

    const mockKnowledgeGraphManager = {
      updateEntity: vi.fn().mockResolvedValue(mockUpdatedEntity),
    };

    // Act
    const response = await handleUpdateEntity(args, mockKnowledgeGraphManager);

    // Assert
    expect(mockKnowledgeGraphManager.updateEntity).toHaveBeenCalledWith(
      args.entityName,
      args.updates
    );
    expect(response).toEqual({
      content: [
        {
          type: 'text',
          text: JSON.stringify(mockUpdatedEntity, null, 2),
        },
      ],
    });
  });

  test('should throw error when entityName is missing', async () => {
    // Arrange
    const args = {
      updates: { entityType: 'newType' },
    };

    const mockKnowledgeGraphManager = {
      updateEntity: vi.fn(),
    };

    // Act & Assert
    await expect(handleUpdateEntity(args, mockKnowledgeGraphManager)).rejects.toThrow(
      'Missing required parameter: entityName'
    );
    expect(mockKnowledgeGraphManager.updateEntity).not.toHaveBeenCalled();
  });

  test('should throw error when updates is missing', async () => {
    // Arrange
    const args = {
      entityName: 'TestEntity',
    };

    const mockKnowledgeGraphManager = {
      updateEntity: vi.fn(),
    };

    // Act & Assert
    await expect(handleUpdateEntity(args, mockKnowledgeGraphManager)).rejects.toThrow(
      'Missing required parameter: updates'
    );
    expect(mockKnowledgeGraphManager.updateEntity).not.toHaveBeenCalled();
  });

  test('should handle KnowledgeGraphManager errors', async () => {
    // Arrange
    const args = {
      entityName: 'NonExistentEntity',
      updates: { entityType: 'newType' },
    };

    const mockKnowledgeGraphManager = {
      updateEntity: vi.fn().mockRejectedValue(new Error('Entity not found')),
    };

    // Act & Assert
    await expect(handleUpdateEntity(args, mockKnowledgeGraphManager)).rejects.toThrow(
      'Failed to update entity: Entity not found'
    );
    expect(mockKnowledgeGraphManager.updateEntity).toHaveBeenCalledWith(
      args.entityName,
      args.updates
    );
  });
});
