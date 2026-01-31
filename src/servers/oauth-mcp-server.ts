#!/usr/bin/env node
/**
 * OAuth MCP Server Entry Point
 *
 * This is a streamlined STDIO-based MCP server designed to work with
 * the mcp-auth-proxy OAuth wrapper for Claude Connectors deployment.
 *
 * The OAuth authentication is handled by mcp-auth-proxy - this server
 * just implements the MCP protocol over stdio.
 *
 * Architecture:
 *   Claude Connectors (HTTPS) -> mcp-auth-proxy (OAuth) -> this server (stdio) -> Neo4j
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { KnowledgeGraphManager } from '../KnowledgeGraphManager.js';
import { initializeStorageProvider } from '../config/storage.js';
import { setupServer } from '../server/setup.js';
import { EmbeddingJobManager } from '../embeddings/EmbeddingJobManager.js';
import { EmbeddingServiceFactory } from '../embeddings/EmbeddingServiceFactory.js';
import { logger } from '../utils/logger.js';

// Log to stderr only (stdout is reserved for MCP protocol)
const log = (message: string, data?: Record<string, unknown>) => {
  if (data) {
    logger.info(message, data);
  } else {
    logger.info(message);
  }
};

const logError = (message: string, error?: unknown) => {
  logger.error(message, {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
};

async function main(): Promise<void> {
  log('OAuth MCP Server starting...');

  // Initialize storage provider
  const storageProvider = initializeStorageProvider();
  log('Storage provider initialized');

  // Initialize embedding job manager
  let embeddingJobManager: EmbeddingJobManager | undefined = undefined;

  try {
    if (!process.env.OPENAI_API_KEY) {
      log('OPENAI_API_KEY not set - semantic search will use random embeddings');
    } else {
      log('OpenAI API key found, initializing embedding service');
    }

    const embeddingService = EmbeddingServiceFactory.createFromEnvironment();

    const rateLimiterOptions = {
      tokensPerInterval: process.env.EMBEDDING_RATE_LIMIT_TOKENS
        ? parseInt(process.env.EMBEDDING_RATE_LIMIT_TOKENS, 10)
        : 20,
      interval: process.env.EMBEDDING_RATE_LIMIT_INTERVAL
        ? parseInt(process.env.EMBEDDING_RATE_LIMIT_INTERVAL, 10)
        : 60 * 1000,
    };

    // Create adapted storage provider for embedding manager
    const adaptedStorageProvider = {
      ...storageProvider,
      db: {
        exec: () => null,
        prepare: () => ({
          run: () => null,
          all: () => [],
          get: () => null,
        }),
      },
      getEntity: async (name: string) => {
        if (typeof storageProvider.getEntity === 'function') {
          return storageProvider.getEntity(name);
        }
        const result = await storageProvider.openNodes([name]);
        return result.entities[0] || null;
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      storeEntityVector: async (name: string, embedding: any) => {
        const formattedEmbedding = {
          vector: embedding.vector || embedding,
          model: embedding.model || 'unknown',
          lastUpdated: embedding.lastUpdated || Date.now(),
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (typeof (storageProvider as any).updateEntityEmbedding === 'function') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return await (storageProvider as any).updateEntityEmbedding(name, formattedEmbedding);
        }
        throw new Error('updateEntityEmbedding not implemented');
      },
    };

    embeddingJobManager = new EmbeddingJobManager(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      adaptedStorageProvider as any,
      embeddingService,
      rateLimiterOptions,
      null,
      logger
    );

    log('Embedding job manager initialized');
  } catch (error) {
    logError('Failed to initialize embedding job manager', error);
  }

  // Create the KnowledgeGraphManager
  const knowledgeGraphManager = new KnowledgeGraphManager({
    storageProvider,
    embeddingJobManager,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vectorStoreOptions: (storageProvider as any).vectorStoreOptions,
  });

  // Add storeEntityVector adapter if needed
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const kgmAny = knowledgeGraphManager as any;
  if (kgmAny.storageProvider && typeof kgmAny.storageProvider.storeEntityVector !== 'function') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    kgmAny.storageProvider.storeEntityVector = async (name: string, embedding: any) => {
      const formattedEmbedding = {
        vector: embedding.vector || embedding,
        model: embedding.model || 'unknown',
        lastUpdated: embedding.lastUpdated || Date.now(),
      };

      if (typeof kgmAny.storageProvider.updateEntityEmbedding === 'function') {
        return await kgmAny.storageProvider.updateEntityEmbedding(name, formattedEmbedding);
      }
      throw new Error('updateEntityEmbedding not implemented');
    };
  }

  // Wrap createEntities for immediate embedding processing
  if (knowledgeGraphManager && typeof knowledgeGraphManager.createEntities === 'function') {
    const originalCreateEntities = knowledgeGraphManager.createEntities.bind(knowledgeGraphManager);
    knowledgeGraphManager.createEntities = async function (entities) {
      const result = await originalCreateEntities(entities);

      if (embeddingJobManager) {
        try {
          log('Processing embedding jobs after entity creation', {
            entityCount: entities.length,
          });
          await embeddingJobManager.processJobs(entities.length);
        } catch (error) {
          logError('Error processing embedding jobs', error);
        }
      }

      return result;
    };
  }

  // Setup the MCP server
  const server = setupServer(knowledgeGraphManager);
  log('MCP server configured');

  // Connect via STDIO transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('MCP server connected via stdio transport');

  // Start background embedding job processor
  if (embeddingJobManager && !process.env.DISABLE_JOB_PROCESSING) {
    const EMBEDDING_PROCESS_INTERVAL = 30000; // 30 seconds
    setTimeout(() => {
      log('Starting background embedding job processor');
      setInterval(async () => {
        try {
          await embeddingJobManager?.processJobs(10);
        } catch (error) {
          logError('Error in scheduled job processing', error);
        }
      }, EMBEDDING_PROCESS_INTERVAL);
    }, 5000);
  }

  log('OAuth MCP Server running - ready for connections');
}

// Start the server
main().catch((error) => {
  logger.error('Fatal error starting OAuth MCP Server', {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exit(1);
});
