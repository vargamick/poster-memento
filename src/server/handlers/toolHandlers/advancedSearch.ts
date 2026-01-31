/**
 * Handles the advanced_search tool request
 * @param args The arguments for the tool request
 * @param knowledgeGraphManager The KnowledgeGraphManager instance
 * @returns A response object with the search results data
 */

export async function handleAdvancedSearch(
  args: Record<string, unknown>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  knowledgeGraphManager: any
): Promise<{ content: Array<{ type: string; text: string }> }> {
  if (!args.query || typeof args.query !== 'string') {
    throw new Error('Missing required parameter: query');
  }

  // Extract optional parameters with validation
  const options: {
    semanticSearch?: boolean;
    hybridSearch?: boolean;
    limit?: number;
    threshold?: number;
    minSimilarity?: number;
    entityTypes?: string[];
    facets?: string[];
    offset?: number;
  } = {};

  if (args.semanticSearch !== undefined) {
    if (typeof args.semanticSearch !== 'boolean') {
      throw new Error('Parameter "semanticSearch" must be a boolean');
    }
    options.semanticSearch = args.semanticSearch;
  }

  if (args.hybridSearch !== undefined) {
    if (typeof args.hybridSearch !== 'boolean') {
      throw new Error('Parameter "hybridSearch" must be a boolean');
    }
    options.hybridSearch = args.hybridSearch;
  }

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

  if (args.minSimilarity !== undefined) {
    if (typeof args.minSimilarity !== 'number') {
      throw new Error('Parameter "minSimilarity" must be a number');
    }
    options.minSimilarity = args.minSimilarity;
  }

  if (args.entityTypes !== undefined) {
    if (!Array.isArray(args.entityTypes)) {
      throw new Error('Parameter "entityTypes" must be an array');
    }
    // Validate that all items are strings
    for (const entityType of args.entityTypes) {
      if (typeof entityType !== 'string') {
        throw new Error('All items in "entityTypes" must be strings');
      }
    }
    options.entityTypes = args.entityTypes as string[];
  }

  if (args.facets !== undefined) {
    if (!Array.isArray(args.facets)) {
      throw new Error('Parameter "facets" must be an array');
    }
    // Validate that all items are strings
    for (const facet of args.facets) {
      if (typeof facet !== 'string') {
        throw new Error('All items in "facets" must be strings');
      }
    }
    options.facets = args.facets as string[];
  }

  if (args.offset !== undefined) {
    if (typeof args.offset !== 'number') {
      throw new Error('Parameter "offset" must be a number');
    }
    options.offset = args.offset;
  }

  try {
    const searchResults = await knowledgeGraphManager.search(args.query, options);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(searchResults, null, 2),
        },
      ],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to perform advanced search: ${errorMessage}`);
  }
}
