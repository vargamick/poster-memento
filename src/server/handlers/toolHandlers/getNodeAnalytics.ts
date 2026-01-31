import type { KnowledgeGraphManager, NodeAnalytics } from '../../../KnowledgeGraphManager.js';

export interface GetNodeAnalyticsArgs {
  entityName: string;
  includeNeighbors?: boolean;
  neighborDepth?: number;
  includeCentrality?: boolean;
  includePathMetrics?: boolean;
  includeClustering?: boolean;
  maxNeighbors?: number;
}

export async function getNodeAnalytics(
  knowledgeGraphManager: KnowledgeGraphManager,
  args: GetNodeAnalyticsArgs
): Promise<NodeAnalytics> {
  // Validation
  if (!args.entityName?.trim()) {
    throw new Error('Entity name is required and cannot be empty');
  }

  if (args.neighborDepth !== undefined && (args.neighborDepth < 1 || args.neighborDepth > 3)) {
    throw new Error('Neighbor depth must be between 1 and 3');
  }

  if (args.maxNeighbors !== undefined && (args.maxNeighbors < 1 || args.maxNeighbors > 1000)) {
    throw new Error('Max neighbors must be between 1 and 1000');
  }

  try {
    const analytics = await knowledgeGraphManager.getNodeAnalytics(args.entityName.trim(), {
      includeNeighbors: args.includeNeighbors ?? true,
      neighborDepth: args.neighborDepth ?? 1,
      includeCentrality: args.includeCentrality ?? false,
      includePathMetrics: args.includePathMetrics ?? false,
      includeClustering: args.includeClustering ?? false,
      maxNeighbors: args.maxNeighbors ?? 100,
    });

    return analytics;
  } catch (error) {
    throw new Error(
      `Failed to get node analytics for '${args.entityName}': ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}
