import type { KnowledgeGraphManager, PathFindingResult } from '../../../KnowledgeGraphManager.js';

export interface FindPathsArgs {
  fromEntity: string;
  toEntity: string;
  maxDepth?: number;
  findAllPaths?: boolean;
  maxPaths?: number;
  relationTypes?: string[];
  excludeRelationTypes?: string[];
  bidirectional?: boolean;
  includeWeights?: boolean;
  algorithm?: 'dijkstra' | 'bfs' | 'dfs' | 'astar';
  includeAnalysis?: boolean;
}

export async function findPaths(
  knowledgeGraphManager: KnowledgeGraphManager,
  args: FindPathsArgs
): Promise<PathFindingResult> {
  // Comprehensive validation
  if (!args.fromEntity?.trim()) {
    throw new Error('From entity name is required and cannot be empty');
  }

  if (!args.toEntity?.trim()) {
    throw new Error('To entity name is required and cannot be empty');
  }

  if (args.fromEntity.trim() === args.toEntity.trim()) {
    throw new Error('From and to entities cannot be the same');
  }

  if (args.maxDepth !== undefined && (args.maxDepth < 1 || args.maxDepth > 10)) {
    throw new Error('Max depth must be between 1 and 10');
  }

  if (args.maxPaths !== undefined && (args.maxPaths < 1 || args.maxPaths > 100)) {
    throw new Error('Max paths must be between 1 and 100');
  }

  if (args.relationTypes && args.excludeRelationTypes) {
    const overlap = args.relationTypes.filter((type) => args.excludeRelationTypes!.includes(type));
    if (overlap.length > 0) {
      throw new Error(`Cannot both include and exclude relation types: ${overlap.join(', ')}`);
    }
  }

  const validAlgorithms = ['dijkstra', 'bfs', 'dfs', 'astar'];
  if (args.algorithm && !validAlgorithms.includes(args.algorithm)) {
    throw new Error(`Algorithm must be one of: ${validAlgorithms.join(', ')}`);
  }

  try {
    const result = await knowledgeGraphManager.findPaths(
      args.fromEntity.trim(),
      args.toEntity.trim(),
      {
        maxDepth: args.maxDepth ?? 6,
        findAllPaths: args.findAllPaths ?? false,
        maxPaths: args.maxPaths ?? 10,
        relationTypes: args.relationTypes,
        excludeRelationTypes: args.excludeRelationTypes,
        bidirectional: args.bidirectional ?? true,
        includeWeights: args.includeWeights ?? false,
        algorithm: args.algorithm ?? 'bfs',
        includeAnalysis: args.includeAnalysis ?? true,
      }
    );

    return result;
  } catch (error) {
    throw new Error(
      `Failed to find paths from '${args.fromEntity}' to '${args.toEntity}': ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}
