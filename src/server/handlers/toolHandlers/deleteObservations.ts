/**
 * Handles the delete_observations tool request
 * @param args The arguments for the tool request
 * @param knowledgeGraphManager The KnowledgeGraphManager instance
 * @returns A response object with the success message
 */

export async function handleDeleteObservations(
  args: Record<string, unknown>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  knowledgeGraphManager: any
): Promise<{ content: Array<{ type: string; text: string }> }> {
  await knowledgeGraphManager.deleteObservations(args.deletions);
  return {
    content: [
      {
        type: 'text',
        text: 'Observations deleted successfully',
      },
    ],
  };
}
