/**
 * Handles the ListTools request.
 * Returns a list of all available tools with their schemas.
 */
export async function handleListToolsRequest(): Promise<{ tools: Array<Record<string, unknown>> }> {
  // Define the base tools without the temporal-specific ones
  const baseTools = [
    {
      name: 'create_entities',
      description: 'Create multiple new entities in your 3DN Memento knowledge graph memory system',
      inputSchema: {
        type: 'object',
        properties: {
          entities: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  description: 'The name of the entity',
                },
                entityType: {
                  type: 'string',
                  description: 'The type of the entity',
                },
                observations: {
                  type: 'array',
                  items: {
                    type: 'string',
                  },
                  description: 'An array of observation contents associated with the entity',
                },
                // Temporal fields - optional
                id: { type: 'string', description: 'Optional entity ID' },
                version: { type: 'number', description: 'Optional entity version' },
                createdAt: { type: 'number', description: 'Optional creation timestamp' },
                updatedAt: { type: 'number', description: 'Optional update timestamp' },
                validFrom: { type: 'number', description: 'Optional validity start timestamp' },
                validTo: { type: 'number', description: 'Optional validity end timestamp' },
                changedBy: { type: 'string', description: 'Optional user/system identifier' },
              },
              required: ['name', 'entityType', 'observations'],
            },
          },
        },
        required: ['entities'],
      },
    },
    {
      name: 'create_relations',
      description:
        'Create multiple new relations between entities in your 3DN Memento knowledge graph memory. Relations should be in active voice',
      inputSchema: {
        type: 'object',
        properties: {
          relations: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                from: {
                  type: 'string',
                  description: 'The name of the entity where the relation starts',
                },
                to: {
                  type: 'string',
                  description: 'The name of the entity where the relation ends',
                },
                relationType: {
                  type: 'string',
                  description: 'The type of the relation',
                },
                strength: {
                  type: 'number',
                  description: 'Optional strength of relation (0.0 to 1.0)',
                },
                confidence: {
                  type: 'number',
                  description: 'Optional confidence level in relation accuracy (0.0 to 1.0)',
                },
                metadata: {
                  type: 'object',
                  description:
                    'Optional metadata about the relation (source, timestamps, tags, etc.)',
                  additionalProperties: true,
                },
                // Temporal fields - optional
                id: { type: 'string', description: 'Optional relation ID' },
                version: { type: 'number', description: 'Optional relation version' },
                createdAt: { type: 'number', description: 'Optional creation timestamp' },
                updatedAt: { type: 'number', description: 'Optional update timestamp' },
                validFrom: { type: 'number', description: 'Optional validity start timestamp' },
                validTo: { type: 'number', description: 'Optional validity end timestamp' },
                changedBy: { type: 'string', description: 'Optional user/system identifier' },
              },
              required: ['from', 'to', 'relationType'],
            },
          },
        },
        required: ['relations'],
      },
    },
    {
      name: 'add_observations',
      description:
        'Add new observations to existing entities in your 3DN Memento knowledge graph memory',
      inputSchema: {
        type: 'object',
        properties: {
          observations: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                entityName: {
                  type: 'string',
                  description: 'The name of the entity to add the observations to',
                },
                contents: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'An array of observation contents to add',
                },
                // Optional parameters at the observation level
                strength: {
                  type: 'number',
                  description: 'Strength value (0.0 to 1.0) for this specific observation',
                },
                confidence: {
                  type: 'number',
                  description: 'Confidence level (0.0 to 1.0) for this specific observation',
                },
                metadata: {
                  type: 'object',
                  description: 'Metadata for this specific observation',
                  additionalProperties: true,
                },
              },
              required: ['entityName', 'contents'],
            },
          },
          // Optional parameters at the top level (apply to all observations)
          strength: {
            type: 'number',
            description: 'Default strength value (0.0 to 1.0) for all observations',
          },
          confidence: {
            type: 'number',
            description: 'Default confidence level (0.0 to 1.0) for all observations',
          },
          metadata: {
            type: 'object',
            description: 'Default metadata for all observations',
            additionalProperties: true,
          },
        },
        required: ['observations'],
      },
    },
    {
      name: 'delete_entities',
      description:
        'Delete multiple entities and their associated relations from your 3DN Memento knowledge graph memory',
      inputSchema: {
        type: 'object',
        properties: {
          entityNames: {
            type: 'array',
            items: { type: 'string' },
            description: 'An array of entity names to delete',
          },
        },
        required: ['entityNames'],
      },
    },
    {
      name: 'delete_observations',
      description:
        'Delete specific observations from entities in your 3DN Memento knowledge graph memory',
      inputSchema: {
        type: 'object',
        properties: {
          deletions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                entityName: {
                  type: 'string',
                  description: 'The name of the entity containing the observations',
                },
                observations: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'An array of observations to delete',
                },
              },
              required: ['entityName', 'observations'],
            },
          },
        },
        required: ['deletions'],
      },
    },
    {
      name: 'delete_relations',
      description: 'Delete multiple relations from your 3DN Memento knowledge graph memory',
      inputSchema: {
        type: 'object',
        properties: {
          relations: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                from: {
                  type: 'string',
                  description: 'The name of the entity where the relation starts',
                },
                to: {
                  type: 'string',
                  description: 'The name of the entity where the relation ends',
                },
                relationType: { type: 'string', description: 'The type of the relation' },
              },
              required: ['from', 'to', 'relationType'],
            },
            description: 'An array of relations to delete',
          },
        },
        required: ['relations'],
      },
    },
    {
      name: 'get_relation',
      description:
        'Get a specific relation with its enhanced properties from your 3DN Memento knowledge graph memory',
      inputSchema: {
        type: 'object',
        properties: {
          from: {
            type: 'string',
            description: 'The name of the entity where the relation starts',
          },
          to: {
            type: 'string',
            description: 'The name of the entity where the relation ends',
          },
          relationType: {
            type: 'string',
            description: 'The type of the relation',
          },
        },
        required: ['from', 'to', 'relationType'],
      },
    },
    {
      name: 'update_relation',
      description:
        'Update an existing relation with enhanced properties in your 3DN Memento knowledge graph memory',
      inputSchema: {
        type: 'object',
        properties: {
          relation: {
            type: 'object',
            properties: {
              from: {
                type: 'string',
                description: 'The name of the entity where the relation starts',
              },
              to: {
                type: 'string',
                description: 'The name of the entity where the relation ends',
              },
              relationType: {
                type: 'string',
                description: 'The type of the relation',
              },
              strength: {
                type: 'number',
                description: 'Optional strength of relation (0.0 to 1.0)',
              },
              confidence: {
                type: 'number',
                description: 'Optional confidence level in relation accuracy (0.0 to 1.0)',
              },
              metadata: {
                type: 'object',
                description:
                  'Optional metadata about the relation (source, timestamps, tags, etc.)',
                additionalProperties: true,
              },
              // Temporal fields - optional
              id: { type: 'string', description: 'Optional relation ID' },
              version: { type: 'number', description: 'Optional relation version' },
              createdAt: { type: 'number', description: 'Optional creation timestamp' },
              updatedAt: { type: 'number', description: 'Optional update timestamp' },
              validFrom: { type: 'number', description: 'Optional validity start timestamp' },
              validTo: { type: 'number', description: 'Optional validity end timestamp' },
              changedBy: { type: 'string', description: 'Optional user/system identifier' },
            },
            required: ['from', 'to', 'relationType'],
          },
        },
        required: ['relation'],
      },
    },
    {
      name: 'update_entity',
      description:
        'Update an existing entity with new properties in your 3DN Memento knowledge graph memory',
      inputSchema: {
        type: 'object',
        properties: {
          entityName: {
            type: 'string',
            description: 'The name of the entity to update',
          },
          updates: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'New name for the entity',
              },
              entityType: {
                type: 'string',
                description: 'New type for the entity',
              },
              observations: {
                type: 'array',
                items: { type: 'string' },
                description: 'New observations array (replaces existing observations)',
              },
            },
            description: 'Object containing the properties to update',
            additionalProperties: false,
          },
        },
        required: ['entityName', 'updates'],
      },
    },
    {
      name: 'list_entities_by_type',
      description:
        'List all entities filtered by one or more entity types. Returns entities matching the specified types with pagination support.',
      inputSchema: {
        type: 'object',
        properties: {
          entityTypes: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Array of entity types to filter by (e.g., ["surface_type", "equipment_type", "problem_type"])',
          },
          // Pagination parameters
          offset: {
            type: 'number',
            description: 'Number of results to skip for pagination (default: 0)',
            minimum: 0,
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results to return (default: 100)',
            minimum: 1,
            maximum: 1000,
          },
          page: {
            type: 'number',
            description: 'Page number for pagination (1-based, alternative to offset)',
            minimum: 1,
          },
          pageSize: {
            type: 'number',
            description: 'Number of results per page (when using page-based pagination)',
            minimum: 1,
            maximum: 100,
          },
          includeTotalCount: {
            type: 'boolean',
            description: 'Include total count of results in response',
          },
          includeRelations: {
            type: 'boolean',
            description: 'Include relations for the returned entities (default: false)',
          },
        },
        required: ['entityTypes'],
      },
    },
    {
      name: 'find_similar_entities',
      description:
        'Find entities semantically similar to a query using vector embeddings in your 3DN Memento knowledge graph memory',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The text query to find similar entities for',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results to return (default: 10)',
          },
          threshold: {
            type: 'number',
            description: 'Minimum similarity threshold from 0.0 to 1.0 (default: 0.7)',
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'advanced_search',
      description:
        'Perform advanced search with semantic, hybrid, and faceted options in your 3DN Memento knowledge graph memory',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query string',
          },
          semanticSearch: {
            type: 'boolean',
            description: 'Enable semantic search using vector embeddings (default: false)',
          },
          hybridSearch: {
            type: 'boolean',
            description:
              'Enable hybrid search combining keyword and semantic search (default: false)',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results to return (default: 10)',
          },
          threshold: {
            type: 'number',
            description: 'Minimum similarity threshold from 0.0 to 1.0 for semantic search',
          },
          minSimilarity: {
            type: 'number',
            description: 'Alternative name for threshold - minimum similarity from 0.0 to 1.0',
          },
          entityTypes: {
            type: 'array',
            items: { type: 'string' },
            description: 'Filter results by specific entity types',
          },
          facets: {
            type: 'array',
            items: { type: 'string' },
            description: 'Faceted search options for categorizing results',
          },
          offset: {
            type: 'number',
            description: 'Number of results to skip for pagination (default: 0)',
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'read_graph',
      description: 'Read the entire 3DN Memento knowledge graph memory system with pagination support',
      inputSchema: {
        type: 'object',
        properties: {
          // Pagination parameters
          offset: {
            type: 'number',
            description: 'Number of entities to skip for pagination (default: 0)',
            minimum: 0,
          },
          limit: {
            type: 'number',
            description: 'Maximum number of entities to return (default: 100)',
            minimum: 1,
            maximum: 10000,
          },
          page: {
            type: 'number',
            description: 'Page number for pagination (1-based, alternative to offset)',
            minimum: 1,
          },
          pageSize: {
            type: 'number',
            description: 'Number of entities per page (when using page-based pagination)',
            minimum: 1,
            maximum: 1000,
          },
          includeTotalCount: {
            type: 'boolean',
            description: 'Include total count of entities and relations in response',
          },
          // Filter options
          entityTypes: {
            type: 'array',
            items: { type: 'string' },
            description: 'Filter entities by specific types',
          },
          includeRelations: {
            type: 'boolean',
            description: 'Include relations between entities (default: true)',
          },
          // Legacy parameter for backward compatibility
          random_string: {
            type: 'string',
            description: 'Legacy dummy parameter for backward compatibility (ignored)',
          },
        },
      },
    },
    {
      name: 'search_nodes',
      description: 'Search for nodes in your 3DN Memento knowledge graph memory based on a query',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'The search query to match against entity names, types, and observation content',
          },
          // Pagination parameters
          offset: {
            type: 'number',
            description: 'Number of results to skip for pagination (default: 0)',
            minimum: 0,
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results to return (default: 10)',
            minimum: 1,
            maximum: 1000,
          },
          page: {
            type: 'number',
            description: 'Page number for pagination (1-based, alternative to offset)',
            minimum: 1,
          },
          pageSize: {
            type: 'number',
            description: 'Number of results per page (when using page-based pagination)',
            minimum: 1,
            maximum: 100,
          },
          includeTotalCount: {
            type: 'boolean',
            description: 'Include total count of results in response (may impact performance)',
          },
          // Search filters
          entityTypes: {
            type: 'array',
            items: { type: 'string' },
            description: 'Filter results by specific entity types',
          },
          caseSensitive: {
            type: 'boolean',
            description: 'Whether the search should be case-sensitive (default: false)',
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'open_nodes',
      description: 'Open specific nodes in your 3DN Memento knowledge graph memory by their names',
      inputSchema: {
        type: 'object',
        properties: {
          names: {
            type: 'array',
            items: { type: 'string' },
            description: 'An array of entity names to retrieve',
          },
          // Pagination parameters
          offset: {
            type: 'number',
            description: 'Number of entities to skip in the names array (default: 0)',
            minimum: 0,
          },
          limit: {
            type: 'number',
            description: 'Maximum number of entities to retrieve (default: 10)',
            minimum: 1,
            maximum: 1000,
          },
          page: {
            type: 'number',
            description: 'Page number for pagination (1-based, alternative to offset)',
            minimum: 1,
          },
          pageSize: {
            type: 'number',
            description: 'Number of entities per page (when using page-based pagination)',
            minimum: 1,
            maximum: 100,
          },
          includeTotalCount: {
            type: 'boolean',
            description: 'Include total count of available entities in response',
          },
        },
        required: ['names'],
      },
    },
    {
      name: 'semantic_search',
      description:
        'Search for entities semantically using vector embeddings and similarity in your 3DN Memento knowledge graph memory',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The text query to search for semantically',
          },
          // Pagination parameters
          offset: {
            type: 'number',
            description: 'Number of results to skip for pagination (default: 0)',
            minimum: 0,
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results to return (default: 10)',
            minimum: 1,
            maximum: 1000,
          },
          page: {
            type: 'number',
            description: 'Page number for pagination (1-based, alternative to offset)',
            minimum: 1,
          },
          pageSize: {
            type: 'number',
            description: 'Number of results per page (when using page-based pagination)',
            minimum: 1,
            maximum: 100,
          },
          includeTotalCount: {
            type: 'boolean',
            description: 'Include total count of results in response (may impact performance)',
          },
          // Semantic search parameters
          min_similarity: {
            type: 'number',
            description: 'Minimum similarity threshold from 0.0 to 1.0 (default: 0.6)',
            minimum: 0.0,
            maximum: 1.0,
          },
          entity_types: {
            type: 'array',
            items: { type: 'string' },
            description: 'Filter results by entity types',
          },
          hybrid_search: {
            type: 'boolean',
            description: 'Whether to combine keyword and semantic search (default: true)',
          },
          semantic_weight: {
            type: 'number',
            description:
              'Weight of semantic results in hybrid search from 0.0 to 1.0 (default: 0.6)',
            minimum: 0.0,
            maximum: 1.0,
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'get_entity_embedding',
      description:
        'Get the vector embedding for a specific entity from your 3DN Memento knowledge graph memory',
      inputSchema: {
        type: 'object',
        properties: {
          entity_name: {
            type: 'string',
            description: 'The name of the entity to get the embedding for',
          },
        },
        required: ['entity_name'],
      },
    },
    {
      name: 'get_graph_statistics',
      description:
        'Get comprehensive statistics about the knowledge graph including entity counts, relation distributions, and connectivity metrics',
      inputSchema: {
        type: 'object',
        properties: {
          includeAdvanced: {
            type: 'boolean',
            description:
              'Include advanced metrics like path lengths and components (may be slower)',
            default: false,
          },
          includeClustering: {
            type: 'boolean',
            description: 'Include clustering coefficient calculations',
            default: false,
          },
          includeComponents: {
            type: 'boolean',
            description: 'Include connected component analysis',
            default: true,
          },
        },
      },
    },
    {
      name: 'get_node_analytics',
      description:
        "Analyze a specific entity's position and importance in the knowledge graph with comprehensive metrics",
      inputSchema: {
        type: 'object',
        properties: {
          entityName: {
            type: 'string',
            description: 'Name of the entity to analyze',
          },
          includeNeighbors: {
            type: 'boolean',
            description: 'Include neighbor analysis (default: true)',
            default: true,
          },
          neighborDepth: {
            type: 'number',
            description: 'Depth of neighbor analysis (1-3, default: 1)',
            minimum: 1,
            maximum: 3,
            default: 1,
          },
          includeCentrality: {
            type: 'boolean',
            description: 'Include centrality measures (may be slower)',
            default: false,
          },
          includePathMetrics: {
            type: 'boolean',
            description: 'Include path-based metrics (may be slower)',
            default: false,
          },
          includeClustering: {
            type: 'boolean',
            description: 'Include clustering coefficient calculations',
            default: false,
          },
          maxNeighbors: {
            type: 'number',
            description: 'Maximum number of neighbors to analyze (default: 100)',
            minimum: 1,
            maximum: 1000,
            default: 100,
          },
        },
        required: ['entityName'],
      },
    },
    {
      name: 'find_paths',
      description:
        'Find and analyze paths between two entities in the knowledge graph with comprehensive options',
      inputSchema: {
        type: 'object',
        properties: {
          fromEntity: {
            type: 'string',
            description: 'Starting entity name',
          },
          toEntity: {
            type: 'string',
            description: 'Target entity name',
          },
          maxDepth: {
            type: 'number',
            description: 'Maximum path length to search (1-10, default: 6)',
            minimum: 1,
            maximum: 10,
            default: 6,
          },
          findAllPaths: {
            type: 'boolean',
            description: 'Find all paths, not just shortest (default: false)',
            default: false,
          },
          maxPaths: {
            type: 'number',
            description: 'Maximum number of paths to return (1-100, default: 10)',
            minimum: 1,
            maximum: 100,
            default: 10,
          },
          relationTypes: {
            type: 'array',
            items: { type: 'string' },
            description: 'Only use these relation types in paths',
          },
          excludeRelationTypes: {
            type: 'array',
            items: { type: 'string' },
            description: 'Exclude these relation types from paths',
          },
          bidirectional: {
            type: 'boolean',
            description: 'Allow traversal in both directions (default: true)',
            default: true,
          },
          includeWeights: {
            type: 'boolean',
            description: 'Consider relation weights/strengths (default: false)',
            default: false,
          },
          algorithm: {
            type: 'string',
            enum: ['dijkstra', 'bfs', 'dfs', 'astar'],
            description: 'Pathfinding algorithm to use (default: bfs)',
            default: 'bfs',
          },
          includeAnalysis: {
            type: 'boolean',
            description: 'Include detailed path analysis (default: true)',
            default: true,
          },
        },
        required: ['fromEntity', 'toEntity'],
      },
    },
  ];

  // Define the temporal-specific tools
  const temporalTools = [
    {
      name: 'get_entity_history',
      description:
        'Get the version history of an entity from your 3DN Memento knowledge graph memory',
      inputSchema: {
        type: 'object',
        properties: {
          entityName: {
            type: 'string',
            description: 'The name of the entity to retrieve history for',
          },
        },
        required: ['entityName'],
      },
    },
    {
      name: 'get_relation_history',
      description:
        'Get the version history of a relation from your 3DN Memento knowledge graph memory',
      inputSchema: {
        type: 'object',
        properties: {
          from: {
            type: 'string',
            description: 'The name of the entity where the relation starts',
          },
          to: {
            type: 'string',
            description: 'The name of the entity where the relation ends',
          },
          relationType: {
            type: 'string',
            description: 'The type of the relation',
          },
        },
        required: ['from', 'to', 'relationType'],
      },
    },
    {
      name: 'get_graph_at_time',
      description:
        'Get your 3DN Memento knowledge graph memory as it existed at a specific point in time',
      inputSchema: {
        type: 'object',
        properties: {
          timestamp: {
            type: 'number',
            description: 'The timestamp (in milliseconds since epoch) to query the graph at',
          },
        },
        required: ['timestamp'],
      },
    },
    {
      name: 'get_decayed_graph',
      description:
        'Get your 3DN Memento knowledge graph memory with confidence values decayed based on time',
      inputSchema: {
        type: 'object',
        properties: {
          reference_time: {
            type: 'number',
            description:
              'Optional reference timestamp (in milliseconds since epoch) for decay calculation',
          },
          decay_factor: {
            type: 'number',
            description: 'Optional decay factor override (normally calculated from half-life)',
          },
        },
      },
    },
  ];

  // Add debug tools only when DEBUG is enabled
  const debugTools = [
    {
      name: 'force_generate_embedding',
      description:
        'Forcibly generate and store an embedding for an entity in your 3DN Memento knowledge graph memory',
      inputSchema: {
        type: 'object',
        properties: {
          entity_name: {
            type: 'string',
            description: 'Name of the entity to generate embedding for',
          },
        },
        required: ['entity_name'],
      },
    },
    {
      name: 'debug_embedding_config',
      description:
        'Debug tool to check embedding configuration and status of your 3DN Memento knowledge graph memory system',
      inputSchema: {
        type: 'object',
        properties: {
          random_string: {
            type: 'string',
            description: 'Dummy parameter for no-parameter tools',
          },
        },
      },
    },
    {
      name: 'diagnose_vector_search',
      description:
        'Diagnostic tool to directly query Neo4j database for entity embeddings, bypassing application abstractions',
      inputSchema: {
        type: 'object',
        properties: {
          random_string: {
            type: 'string',
            description: 'Dummy parameter for no-parameter tools',
          },
        },
      },
    },
  ];

  // Return the list of tools with debug tools conditionally included
  return {
    tools: [...baseTools, ...temporalTools, ...(process.env.DEBUG === 'true' ? debugTools : [])],
  };
}
