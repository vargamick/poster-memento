/**
 * Handles the find_similar_entities tool request
 * @param args The arguments for the tool request
 * @param knowledgeGraphManager The KnowledgeGraphManager instance
 * @returns A response object with the similar entities data
 */

export async function handleFindSimilarEntities(
  args: Record<string, unknown>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  knowledgeGraphManager: any
): Promise<{ content: Array<{ type: string; text: string }> }> {
  if (!args.query || typeof args.query !== 'string') {
    throw new Error('Missing required parameter: query');
  }

  // Extract optional parameters with defaults
  const options: { limit?: number; threshold?: number } = {};

  if (args.limit !== undefined) {
    if (typeof args.limit !== 'number') {
      throw new Error('Parameter "limit" must be a number');
    }
    options.limit = args.limit;
  }

  if (args.threshold !== undefined) {
    if (typeof args.threshold !== 'number') {
      throw new Error('Parameter "threshold" must be a number');
    }
    options.threshold = args.threshold;
  }

  try {
    const similarEntities = await knowledgeGraphManager.findSimilarEntities(args.query, options);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(similarEntities, null, 2),
        },
      ],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to find similar entities: ${errorMessage}`);
  }
}
