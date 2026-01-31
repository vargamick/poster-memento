import type { KnowledgeGraphManager, GraphStatistics } from '../../../KnowledgeGraphManager.js';

export interface GetGraphStatisticsArgs {
  includeAdvanced?: boolean;
  includeClustering?: boolean;
  includeComponents?: boolean;
}

export async function getGraphStatistics(
  knowledgeGraphManager: KnowledgeGraphManager,
  args: GetGraphStatisticsArgs
): Promise<GraphStatistics> {
  try {
    const statistics = await knowledgeGraphManager.getGraphStatistics({
      includeAdvanced: args.includeAdvanced ?? false,
      includeClustering: args.includeClustering ?? false,
      includeComponents: args.includeComponents ?? true,
    });

    return statistics;
  } catch (error) {
    throw new Error(
      `Failed to get graph statistics: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}
