import * as toolHandlers from './toolHandlers/index.js';

/**
 * Handles the CallTool request.
 * Delegates to the appropriate tool handler based on the tool name.
 *
 * @param request The CallTool request object
 * @param knowledgeGraphManager The KnowledgeGraphManager instance
 * @returns A response object with the result content
 * @throws Error if the tool is unknown or arguments are missing
 */

export async function handleCallToolRequest(
  request: { params?: { name?: string; arguments?: Record<string, unknown> } },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  knowledgeGraphManager: any
): Promise<{ content: Array<{ type: string; text: string }> }> {
  if (!request) {
    throw new Error('Invalid request: request is null or undefined');
  }

  if (!request.params) {
    throw new Error('Invalid request: missing params');
  }

  const { name, arguments: args } = request.params;

  if (!name) {
    throw new Error('Invalid request: missing tool name');
  }

  if (!args) {
    throw new Error(`No arguments provided for tool: ${name}`);
  }

  try {
    switch (name) {
      case 'create_entities':
        return await toolHandlers.handleCreateEntities(args, knowledgeGraphManager);

      case 'read_graph':
        try {
          // Extract pagination and filter options from args
          const options = {
            offset: args.offset,
            limit: args.limit || 100, // Default to 100 for better performance
            page: args.page,
            pageSize: args.pageSize,
            includeTotalCount: args.includeTotalCount,
            entityTypes: args.entityTypes,
            includeRelations: args.includeRelations !== false, // Default to true
          };

          // Call the paginated read graph method
          const result = await knowledgeGraphManager.readGraph(options);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (error: Error | unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: 'text', text: `Error reading graph: ${errorMessage}` }],
          };
        }

      case 'create_relations':
        return await toolHandlers.handleCreateRelations(args, knowledgeGraphManager);

      case 'add_observations':
        return await toolHandlers.handleAddObservations(args, knowledgeGraphManager);

      case 'delete_entities':
        return await toolHandlers.handleDeleteEntities(args, knowledgeGraphManager);

      case 'delete_observations':
        return await toolHandlers.handleDeleteObservations(args, knowledgeGraphManager);

      case 'delete_relations':
        return await toolHandlers.handleDeleteRelations(args, knowledgeGraphManager);

      case 'get_relation':
        return await toolHandlers.handleGetRelation(args, knowledgeGraphManager);

      case 'update_relation':
        return await toolHandlers.handleUpdateRelation(args, knowledgeGraphManager);

      case 'update_entity':
        return await toolHandlers.handleUpdateEntity(args, knowledgeGraphManager);

      case 'find_similar_entities':
        return await toolHandlers.handleFindSimilarEntities(args, knowledgeGraphManager);

      case 'advanced_search':
        return await toolHandlers.handleAdvancedSearch(args, knowledgeGraphManager);

      case 'get_graph_statistics':
        try {
          const statistics = await toolHandlers.getGraphStatistics(knowledgeGraphManager, args);
          return { content: [{ type: 'text', text: JSON.stringify(statistics, null, 2) }] };
        } catch (error: Error | unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: 'text', text: `Error getting graph statistics: ${errorMessage}` }],
          };
        }

      case 'get_node_analytics':
        try {
          const analytics = await toolHandlers.getNodeAnalytics(
            knowledgeGraphManager,
            args as unknown as toolHandlers.GetNodeAnalyticsArgs
          );
          return { content: [{ type: 'text', text: JSON.stringify(analytics, null, 2) }] };
        } catch (error: Error | unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: 'text', text: `Error getting node analytics: ${errorMessage}` }],
          };
        }

      case 'find_paths':
        try {
          const pathResult = await toolHandlers.findPaths(knowledgeGraphManager, args as any);
          return { content: [{ type: 'text', text: JSON.stringify(pathResult, null, 2) }] };
        } catch (error: Error | unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: 'text', text: `Error finding paths: ${errorMessage}` }],
          };
        }

      case 'search_nodes':
        try {
          // Extract pagination and search options from args
          const searchOptions = {
            offset: args.offset,
            limit: args.limit,
            page: args.page,
            pageSize: args.pageSize,
            includeTotalCount: args.includeTotalCount,
            entityTypes: args.entityTypes,
            caseSensitive: args.caseSensitive,
          };

          const result = await knowledgeGraphManager.searchNodes(args.query, searchOptions);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (error: Error | unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: 'text', text: `Error searching nodes: ${errorMessage}` }],
          };
        }

      case 'open_nodes':
        try {
          // Extract pagination options from args
          const paginationOptions = {
            offset: args.offset,
            limit: args.limit,
            page: args.page,
            pageSize: args.pageSize,
            includeTotalCount: args.includeTotalCount,
          };

          const result = await knowledgeGraphManager.openNodes(args.names, paginationOptions);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (error: Error | unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: 'text', text: `Error opening nodes: ${errorMessage}` }],
          };
        }

      case 'get_entity_history':
        try {
          const history = await knowledgeGraphManager.getEntityHistory(args.entityName);
          return { content: [{ type: 'text', text: JSON.stringify(history, null, 2) }] };
        } catch (error: Error | unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: 'text', text: `Error retrieving entity history: ${errorMessage}` }],
          };
        }

      case 'get_relation_history':
        try {
          const history = await knowledgeGraphManager.getRelationHistory(
            args.from,
            args.to,
            args.relationType
          );
          return { content: [{ type: 'text', text: JSON.stringify(history, null, 2) }] };
        } catch (error: Error | unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: 'text', text: `Error retrieving relation history: ${errorMessage}` }],
          };
        }

      case 'get_graph_at_time':
        try {
          const graph = await knowledgeGraphManager.getGraphAtTime(args.timestamp);
          return { content: [{ type: 'text', text: JSON.stringify(graph, null, 2) }] };
        } catch (error: Error | unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: 'text', text: `Error retrieving graph at time: ${errorMessage}` }],
          };
        }

      case 'get_decayed_graph':
        try {
          // Extract optional parameters if provided by client
          const options: {
            referenceTime?: number;
            decayFactor?: number;
          } = {};

          if (args.reference_time) {
            options.referenceTime = Number(args.reference_time);
          }

          if (args.decay_factor) {
            options.decayFactor = Number(args.decay_factor);
          }

          // Pass options to getDecayedGraph if any are provided
          const graph =
            Object.keys(options).length > 0
              ? await knowledgeGraphManager.getDecayedGraph(options)
              : await knowledgeGraphManager.getDecayedGraph();

          return { content: [{ type: 'text', text: JSON.stringify(graph, null, 2) }] };
        } catch (error: Error | unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: 'text', text: `Error retrieving decayed graph: ${errorMessage}` }],
          };
        }

      case 'force_generate_embedding':
        // Validate arguments
        if (!args.entity_name) {
          throw new Error('Missing required parameter: entity_name');
        }

        process.stderr.write(
          `[DEBUG] Force generating embedding for entity: ${args.entity_name}\n`
        );

        try {
          // First determine if the input looks like a UUID
          const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          const isUUID = uuidPattern.test(String(args.entity_name));

          if (isUUID) {
            process.stderr.write(`[DEBUG] Input appears to be a UUID: ${args.entity_name}\n`);
          }

          // Try to get all entities first to locate the correct one
          process.stderr.write(`[DEBUG] Trying to find entity by opening all nodes...\n`);
          const allEntities = await knowledgeGraphManager.openNodes([]);

          let entity = null;

          if (allEntities && allEntities.entities && allEntities.entities.length > 0) {
            process.stderr.write(
              `[DEBUG] Found ${allEntities.entities.length} entities in total\n`
            );

            // Try different methods to find the entity
            // 1. Direct match by name
            entity = allEntities.entities.find(
              (e: { name: string }) => e.name === args.entity_name
            );

            // 2. If not found and input is UUID, try matching by ID
            if (!entity && isUUID) {
              entity = allEntities.entities.find(
                (e: Record<string, unknown>) =>
                  // The id property might not be in the Entity interface, but could exist at runtime
                  'id' in e && e.id === args.entity_name
              );
              process.stderr.write(`[DEBUG] Searching by ID match for UUID: ${args.entity_name}\n`);
            }

            // Log found entities to help debugging
            if (!entity) {
              process.stderr.write(
                `[DEBUG] Entity not found in list. Available entities: ${JSON.stringify(
                  allEntities.entities.map((e: { name: string; id?: string }) => ({
                    name: e.name,
                    id: e.id,
                  }))
                )}\n`
              );
            }
          } else {
            process.stderr.write(`[DEBUG] No entities found in graph\n`);
          }

          // If still not found, try explicit lookup by name
          if (!entity) {
            process.stderr.write(
              `[DEBUG] Entity not found in list, trying explicit lookup by name...\n`
            );
            const openedEntities = await knowledgeGraphManager.openNodes([
              String(args.entity_name),
            ]);

            if (openedEntities && openedEntities.entities && openedEntities.entities.length > 0) {
              entity = openedEntities.entities[0];
              process.stderr.write(
                `[DEBUG] Found entity by name: ${entity.name} (ID: ${(entity as Record<string, unknown>).id || 'none'})\n`
              );
            }
          }

          // If still not found, check if we can query by ID through the storage provider
          if (
            !entity &&
            isUUID &&
            knowledgeGraphManager.storageProvider &&
            typeof knowledgeGraphManager.storageProvider.getEntityById === 'function'
          ) {
            try {
              process.stderr.write(
                `[DEBUG] Trying direct database lookup by ID: ${args.entity_name}\n`
              );
              entity = await knowledgeGraphManager.storageProvider.getEntityById(args.entity_name);
              if (entity) {
                process.stderr.write(
                  `[DEBUG] Found entity by direct ID lookup: ${entity.name} (ID: ${(entity as Record<string, unknown>).id || 'none'})\n`
                );
              }
            } catch (err) {
              process.stderr.write(`[DEBUG] Direct ID lookup failed: ${err}\n`);
            }
          }

          // Final check
          if (!entity) {
            process.stderr.write(
              `[ERROR] Entity not found after all lookup attempts: ${args.entity_name}\n`
            );
            throw new Error(`Entity not found: ${args.entity_name}`);
          }

          process.stderr.write(
            `[DEBUG] Successfully found entity: ${entity.name} (ID: ${(entity as Record<string, unknown>).id || 'none'})\n`
          );

          // Check if embedding service and job manager are available
          if (!knowledgeGraphManager.embeddingJobManager) {
            process.stderr.write(`[ERROR] EmbeddingJobManager not initialized\n`);
            throw new Error('EmbeddingJobManager not initialized');
          }

          process.stderr.write(`[DEBUG] EmbeddingJobManager found, proceeding\n`);

          // Directly get the text for the entity
          const embeddingText =
            knowledgeGraphManager.embeddingJobManager._prepareEntityText(entity);
          process.stderr.write(
            `[DEBUG] Prepared entity text for embedding, length: ${embeddingText.length}\n`
          );

          // Generate embedding directly
          const embeddingService = knowledgeGraphManager.embeddingJobManager.embeddingService;
          if (!embeddingService) {
            process.stderr.write(`[ERROR] Embedding service not available\n`);
            throw new Error('Embedding service not available');
          }

          const vector = await embeddingService.generateEmbedding(embeddingText);
          process.stderr.write(`[DEBUG] Generated embedding vector, length: ${vector.length}\n`);

          // Store embedding directly
          const embedding = {
            vector,
            model: embeddingService.getModelInfo().name,
            lastUpdated: Date.now(),
          };

          // Store the embedding in Neo4j by entity name
          process.stderr.write(`[DEBUG] Storing embedding for entity: ${entity.name}\n`);
          await knowledgeGraphManager.storageProvider.storeEntityVector(entity.name, embedding);

          // Also store in PostgreSQL vector store (same as entity creation flow)
          const entityId = (entity as Record<string, unknown>).id;
          if (knowledgeGraphManager.storageProvider.vectorStore) {
            process.stderr.write(`[DEBUG] Storing embedding in PostgreSQL vector store\n`);
            try {
              await knowledgeGraphManager.storageProvider.vectorStore.addVector(
                entity.name,
                embedding.vector,
                {
                  entityType: entity.entityType,
                  entityId: entityId as string
                }
              );
              process.stderr.write(`[DEBUG] Successfully stored vector in PostgreSQL for ${entity.name}\n`);
            } catch (vectorError) {
              process.stderr.write(
                `[WARN] Failed to store vector in PostgreSQL: ${vectorError}\n`
              );
            }
          }

          process.stderr.write(`[DEBUG] Successfully stored embedding for ${entity.name}\n`);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: true,
                    entity: entity.name,
                    entity_id: (entity as Record<string, unknown>).id,
                    vector_length: vector.length,
                    model: embeddingService.getModelInfo().name,
                  },
                  null,
                  2
                ),
              },
            ],
          };
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (error: any) {
          process.stderr.write(`[ERROR] Failed to force generate embedding: ${error.message}\n`);
          if (error.stack) {
            process.stderr.write(`[ERROR] Stack trace: ${error.stack}\n`);
          }
          return {
            content: [{ type: 'text', text: `Failed to generate embedding: ${error.message}` }],
          };
        }

      case 'semantic_search':
        try {
          // Extract comprehensive search and pagination options from args
          const searchOptions = {
            // Pagination parameters
            offset: args.offset,
            limit: args.limit || 10,
            page: args.page,
            pageSize: args.pageSize,
            includeTotalCount: args.includeTotalCount,
            // Semantic search parameters
            minSimilarity: args.min_similarity || 0.6,
            entityTypes: args.entity_types || [],
            hybridSearch: args.hybrid_search !== undefined ? args.hybrid_search : true,
            semanticWeight: args.semantic_weight || 0.6,
            semanticSearch: true,
          };

          // Call the search method with comprehensive search options
          const results = await knowledgeGraphManager.search(String(args.query), searchOptions);

          return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
        } catch (error: Error | unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: 'text', text: `Error performing semantic search: ${errorMessage}` }],
          };
        }

      case 'get_entity_embedding':
        try {
          // Check if entity exists
          const entity = await knowledgeGraphManager.openNodes([String(args.entity_name)]);
          if (!entity.entities || entity.entities.length === 0) {
            return { content: [{ type: 'text', text: `Entity not found: ${args.entity_name}` }] };
          }

          // Access the embedding using appropriate interface
          if (
            knowledgeGraphManager.storageProvider &&
            typeof (knowledgeGraphManager.storageProvider as Record<string, unknown>)
              .getEntityEmbedding === 'function'
          ) {
            type EntityEmbedding = {
              vector: number[];
              model?: string;
              lastUpdated?: number;
            };

            const embedding = await (
              knowledgeGraphManager.storageProvider as Record<
                string,
                (entityName: string) => Promise<EntityEmbedding | null>
              >
            ).getEntityEmbedding(String(args.entity_name));

            if (!embedding) {
              return {
                content: [
                  { type: 'text', text: `No embedding found for entity: ${args.entity_name}` },
                ],
              };
            }

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      entityName: args.entity_name,
                      embedding: embedding.vector,
                      model: embedding.model || 'unknown',
                      dimensions: embedding.vector ? embedding.vector.length : 0,
                      lastUpdated: embedding.lastUpdated || Date.now(),
                    },
                    null,
                    2
                  ),
                },
              ],
            };
          } else {
            return {
              content: [
                {
                  type: 'text',
                  text: `Embedding retrieval not supported by this storage provider`,
                },
              ],
            };
          }
        } catch (error: Error | unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: 'text', text: `Error retrieving entity embedding: ${errorMessage}` }],
          };
        }

      case 'debug_embedding_config':
        // Diagnostic tool to check embedding configuration
        try {
          // Check for OpenAI API key
          const hasOpenAIKey = !!process.env.OPENAI_API_KEY;
          const embeddingModel = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';

          // Check if embedding job manager is initialized
          const hasEmbeddingJobManager = !!knowledgeGraphManager.embeddingJobManager;

          // Get storage provider info
          const storageType = process.env.MEMORY_STORAGE_TYPE || 'neo4j';
          const storageProvider = knowledgeGraphManager.storageProvider;

          // Get Neo4j specific configuration
          const neo4jInfo: {
            uri: string;
            username: string;
            database: string;
            vectorIndex: string;
            vectorDimensions: string;
            similarityFunction: string;
            connectionStatus: string;
            vectorStoreStatus?: string;
          } = {
            uri: process.env.NEO4J_URI || 'default',
            username: process.env.NEO4J_USERNAME ? 'configured' : 'not configured',
            database: process.env.NEO4J_DATABASE || 'neo4j',
            vectorIndex: process.env.NEO4J_VECTOR_INDEX || 'entity_embeddings',
            vectorDimensions: process.env.NEO4J_VECTOR_DIMENSIONS || '1536',
            similarityFunction: process.env.NEO4J_SIMILARITY_FUNCTION || 'cosine',
            connectionStatus: 'unknown',
          };

          // Check if Neo4j connection manager is available
          if (storageProvider && typeof storageProvider.getConnectionManager === 'function') {
            try {
              const connectionManager = storageProvider.getConnectionManager();
              if (connectionManager) {
                neo4jInfo.connectionStatus = 'available';

                // Check if vector store is initialized
                if (storageProvider.vectorStore) {
                  neo4jInfo.vectorStoreStatus = 'available';
                } else {
                  neo4jInfo.vectorStoreStatus = 'not initialized';
                }
              }
            } catch (error: Error | unknown) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              neo4jInfo.connectionStatus = `error: ${errorMessage}`;
            }
          }

          // Count entities with embeddings via Neo4j vector store
          let entitiesWithEmbeddings = 0;
          if (storageProvider && storageProvider.countEntitiesWithEmbeddings) {
            try {
              entitiesWithEmbeddings = await storageProvider.countEntitiesWithEmbeddings();
            } catch (error) {
              process.stderr.write(`[ERROR] Error checking embeddings count: ${error}\n`);
            }
          }

          // Get embedding service information
          let embeddingServiceInfo = null;
          if (
            hasEmbeddingJobManager &&
            knowledgeGraphManager.embeddingJobManager.embeddingService
          ) {
            try {
              embeddingServiceInfo = (
                knowledgeGraphManager.embeddingJobManager as Record<
                  string,
                  Record<string, () => unknown>
                >
              ).embeddingService.getModelInfo();
            } catch (error: Error | unknown) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              process.stderr.write(
                `[ERROR] Error getting embedding service info: ${errorMessage}\n`
              );
            }
          }

          // Get embedding service provider info if available
          let embeddingProviderInfo = null;
          if (storageProvider && storageProvider.embeddingService) {
            try {
              embeddingProviderInfo = (
                storageProvider as Record<string, Record<string, () => unknown>>
              ).embeddingService.getProviderInfo();
            } catch (error: Error | unknown) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              process.stderr.write(
                `[ERROR] Error getting embedding provider info: ${errorMessage}\n`
              );
            }
          }

          // Check pending embedding jobs if available
          let pendingJobs = 0;
          if (hasEmbeddingJobManager && knowledgeGraphManager.embeddingJobManager.getPendingJobs) {
            try {
              pendingJobs = (
                knowledgeGraphManager.embeddingJobManager as Record<string, () => Array<unknown>>
              ).getPendingJobs().length;
            } catch (error: Error | unknown) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              process.stderr.write(`[ERROR] Error getting pending jobs: ${errorMessage}\n`);
            }
          }

          // Return diagnostic information with proper formatting
          const diagnosticInfo = {
            storage_type: storageType,
            openai_api_key_present: hasOpenAIKey,
            embedding_model: embeddingModel,
            embedding_job_manager_initialized: hasEmbeddingJobManager,
            embedding_service_initialized: !!embeddingProviderInfo,
            embedding_service_info: embeddingServiceInfo,
            embedding_provider_info: embeddingProviderInfo,
            neo4j_config: neo4jInfo,
            entities_with_embeddings: entitiesWithEmbeddings,
            pending_embedding_jobs: pendingJobs,
            environment_variables: {
              DEBUG: process.env.DEBUG === 'true',
              NODE_ENV: process.env.NODE_ENV,
              MEMORY_STORAGE_TYPE: process.env.MEMORY_STORAGE_TYPE || 'neo4j',
            },
          };

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(diagnosticInfo, null, 2),
              },
            ],
          };
        } catch (error: Error | unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          const errorStack = error instanceof Error ? error.stack : undefined;
          process.stderr.write(`[ERROR] Error in debug_embedding_config: ${errorMessage}\n`);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    error: errorMessage,
                    stack: errorStack,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

      case 'diagnose_vector_search':
        if (
          knowledgeGraphManager.storageProvider &&
          typeof (knowledgeGraphManager.storageProvider as Record<string, unknown>)
            .diagnoseVectorSearch === 'function'
        ) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  await (
                    knowledgeGraphManager.storageProvider as Record<string, () => Promise<unknown>>
                  ).diagnoseVectorSearch()
                ),
              },
            ],
          };
        } else {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    error: 'Diagnostic method not available',
                    storageType: knowledgeGraphManager.storageProvider
                      ? knowledgeGraphManager.storageProvider.constructor.name
                      : 'unknown',
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

      case 'list_entities_by_type':
        try {
          // Validate required entityTypes parameter
          if (!args.entityTypes || !Array.isArray(args.entityTypes) || args.entityTypes.length === 0) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    error: 'entityTypes parameter is required and must be a non-empty array',
                    example: ['surface_type', 'equipment_type', 'problem_type'],
                  }, null, 2),
                },
              ],
            };
          }

          // Extract pagination and filter options from args
          const listOptions = {
            offset: args.offset,
            limit: args.limit || 100, // Default to 100
            page: args.page,
            pageSize: args.pageSize,
            includeTotalCount: args.includeTotalCount,
            entityTypes: args.entityTypes,
            includeRelations: args.includeRelations || false, // Default to false for listing
          };

          // Call the paginated read graph method with entityTypes filter
          const result = await knowledgeGraphManager.readGraph(listOptions);

          // Format the response with entity type summary
          const entityTypeCounts: Record<string, number> = {};
          if (result.entities && Array.isArray(result.entities)) {
            for (const entity of result.entities) {
              const type = entity.entityType || 'unknown';
              entityTypeCounts[type] = (entityTypeCounts[type] || 0) + 1;
            }
          }

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  ...result,
                  summary: {
                    requestedTypes: args.entityTypes,
                    returnedCounts: entityTypeCounts,
                    totalReturned: result.entities?.length || 0,
                  },
                }, null, 2),
              },
            ],
          };
        } catch (error: Error | unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: 'text', text: `Error listing entities by type: ${errorMessage}` }],
          };
        }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: Error | unknown) {
    throw error;
  }
}
