/**
 * Handles the get_relation tool request
 * @param args The arguments for the tool request
 * @param knowledgeGraphManager The KnowledgeGraphManager instance
 * @returns A response object with the relation data or not found message
 */

export async function handleGetRelation(
  args: Record<string, unknown>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  knowledgeGraphManager: any
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const relation = await knowledgeGraphManager.getRelation(args.from, args.to, args.relationType);

  if (!relation) {
    return {
      content: [
        {
          type: 'text',
          text: `Relation not found: ${args.from} -> ${args.relationType} -> ${args.to}`,
        },
      ],
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(relation, null, 2),
      },
    ],
  };
}
