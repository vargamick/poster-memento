/**
 * Handles the update_entity tool request
 * @param args The arguments for the tool request
 * @param knowledgeGraphManager The KnowledgeGraphManager instance
 * @returns A response object with the updated entity data
 */

export async function handleUpdateEntity(
  args: Record<string, unknown>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  knowledgeGraphManager: any
): Promise<{ content: Array<{ type: string; text: string }> }> {
  if (!args.entityName || typeof args.entityName !== 'string') {
    throw new Error('Missing required parameter: entityName');
  }

  if (!args.updates || typeof args.updates !== 'object') {
    throw new Error('Missing required parameter: updates');
  }

  try {
    const updatedEntity = await knowledgeGraphManager.updateEntity(args.entityName, args.updates);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(updatedEntity, null, 2),
        },
      ],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to update entity: ${errorMessage}`);
  }
}
