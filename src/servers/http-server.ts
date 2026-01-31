#!/usr/bin/env node
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { KnowledgeGraphManager } from '../KnowledgeGraphManager.js';
import { initializeStorageProvider } from '../config/storage.js';
import { setupServer } from '../server/setup.js';
import { EmbeddingJobManager } from '../embeddings/EmbeddingJobManager.js';
import { EmbeddingServiceFactory } from '../embeddings/EmbeddingServiceFactory.js';
import type { EmbeddingService } from '../embeddings/EmbeddingService.js';
import { logger } from '../utils/logger.js';
import { VectorStoreFactory } from '../storage/VectorStoreFactory.js';
import { SearchService } from '../core/services/SearchService.js';
import { createStorageConfig } from '../config/storage.js';
import { handleListToolsRequest } from '../server/handlers/listToolsHandler.js';
import { handleCallToolRequest } from '../server/handlers/callToolHandler.js';

// Import API server components
import { createEntityRoutes } from '../api/routes/entities.js';
import { createRelationRoutes } from '../api/routes/relations.js';
import { createSearchRoutes } from '../api/routes/search.js';
import { createAnalyticsRoutes } from '../api/routes/analytics.js';
import { createTemporalRoutes } from '../api/routes/temporal.js';
import { createExpertiseRoutes } from '../api/routes/expertise.js';
import { EntityService } from '../core/services/EntityService.js';
import { RelationService } from '../core/services/RelationService.js';
import { expertiseAreaManager } from '../core/domain/ExpertiseArea.js';
import { errorHandler } from '../api/middleware/errorHandler.js';
import { requestLogger } from '../api/middleware/requestLogger.js';
import { createAdminRoutes } from '../api/routes/admin.js';
import {
  createAdminServiceFromEnv,
  createS3ServiceFromEnv,
  createProcessingServiceFromEnv
} from '../services/index.js';

// Authentication middleware
const authenticateApiKey = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void => {
  // Support multiple authentication methods:
  // 1. X-API-Key header
  // 2. Authorization: Bearer <token> header
  // 3. key query parameter
  const apiKey = req.headers['x-api-key'] || 
                 req.get('Authorization')?.replace('Bearer ', '') ||
                 req.query.key;
  
  // Support MEMENTO_API_KEY
  const expectedKey = process.env.MEMENTO_API_KEY;

  if (!expectedKey) {
    res
      .status(500)
      .json({ error: 'Server not configured with API key (MEMENTO_API_KEY required)' });
    return;
  }

  if (!apiKey || apiKey !== expectedKey) {
    res.status(401).json({ error: 'Invalid or missing API key' });
    return;
  }

  next();
};

// Initialize storage and create KnowledgeGraphManager (same as stdio version)
const storageProvider = initializeStorageProvider();
const storageConfig = createStorageConfig(process.env.MEMORY_STORAGE_TYPE);

// Initialize embedding service at module level for use by both EmbeddingJobManager and SearchService
let embeddingService: EmbeddingService | undefined = undefined;

// Initialize embedding job manager (same as stdio version)
let embeddingJobManager: EmbeddingJobManager | undefined = undefined;
try {
  logger.debug(`OpenAI API key exists: ${!!process.env.OPENAI_API_KEY}`);
  logger.debug(`OpenAI Embedding model: ${process.env.OPENAI_EMBEDDING_MODEL || 'not set'}`);
  logger.debug(`Storage provider type: ${process.env.MEMORY_STORAGE_TYPE || 'default'}`);

  if (!process.env.OPENAI_API_KEY) {
    logger.warn(
      'OPENAI_API_KEY environment variable is not set. Semantic search will use random embeddings.'
    );
  } else {
    logger.info('OpenAI API key found, will use for generating embeddings');
  }

  embeddingService = EmbeddingServiceFactory.createFromEnvironment();
  logger.debug(`Embedding service model info: ${JSON.stringify(embeddingService.getModelInfo())}`);

  const rateLimiterOptions = {
    tokensPerInterval: process.env.EMBEDDING_RATE_LIMIT_TOKENS
      ? parseInt(process.env.EMBEDDING_RATE_LIMIT_TOKENS, 10)
      : 20,
    interval: process.env.EMBEDDING_RATE_LIMIT_INTERVAL
      ? parseInt(process.env.EMBEDDING_RATE_LIMIT_INTERVAL, 10)
      : 60 * 1000,
  };

  logger.info('Initializing EmbeddingJobManager', {
    rateLimiterOptions,
    model: embeddingService.getModelInfo().name,
    storageType: process.env.MEMORY_STORAGE_TYPE || 'neo4j',
  });

  // Neo4j storage provider adapter (same as stdio version)
  const adaptedStorageProvider = {
    ...storageProvider,
    db: {
      exec: (sql: string) => {
        logger.debug(`Neo4j adapter: Received SQL: ${sql}`);
        return null;
      },
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
    storeEntityVector: async (name: string, embedding: any) => {
      logger.debug(`Neo4j adapter: storeEntityVector called for ${name}`, {
        embeddingType: typeof embedding,
        vectorLength: embedding?.vector?.length || 'no vector',
        model: embedding?.model || 'no model',
      });

      const formattedEmbedding = {
        vector: embedding.vector || embedding,
        model: embedding.model || 'unknown',
        lastUpdated: embedding.lastUpdated || Date.now(),
      };

      if (typeof (storageProvider as any).updateEntityEmbedding === 'function') {
        try {
          logger.debug(`Neo4j adapter: Using updateEntityEmbedding for ${name}`);
          return await (storageProvider as any).updateEntityEmbedding(name, formattedEmbedding);
        } catch (error) {
          logger.error(`Neo4j adapter: Error in storeEntityVector for ${name}`, error);
          throw error;
        }
      } else {
        const errorMsg = `Neo4j adapter: Neither storeEntityVector nor updateEntityEmbedding implemented for ${name}`;
        logger.error(errorMsg);
        throw new Error(errorMsg);
      }
    },
  };

  embeddingJobManager = new EmbeddingJobManager(
    adaptedStorageProvider as any,
    embeddingService,
    rateLimiterOptions,
    null,
    logger
  );
} catch (error) {
  logger.error('Failed to initialize EmbeddingJobManager', {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  embeddingJobManager = undefined;
}

// Create the KnowledgeGraphManager
const knowledgeGraphManager = new KnowledgeGraphManager({
  storageProvider,
  embeddingJobManager,
  vectorStoreOptions: (storageProvider as any).vectorStoreOptions,
});

// Add storeEntityVector method to storage provider (same as stdio version)
const knowledgeGraphManagerAny = knowledgeGraphManager as any;

if (
  knowledgeGraphManagerAny.storageProvider &&
  typeof knowledgeGraphManagerAny.storageProvider.storeEntityVector !== 'function'
) {
  knowledgeGraphManagerAny.storageProvider.storeEntityVector = async (
    name: string,
    embedding: any
  ) => {
    logger.debug(`Neo4j knowledgeGraphManager adapter: storeEntityVector called for ${name}`, {
      embeddingType: typeof embedding,
      vectorLength: embedding?.vector?.length || 'no vector',
      model: embedding?.model || 'no model',
    });

    const formattedEmbedding = {
      vector: embedding.vector || embedding,
      model: embedding.model || 'unknown',
      lastUpdated: embedding.lastUpdated || Date.now(),
    };

    if (typeof knowledgeGraphManagerAny.storageProvider.updateEntityEmbedding === 'function') {
      try {
        logger.debug(
          `Neo4j knowledgeGraphManager adapter: Using updateEntityEmbedding for ${name}`
        );
        return await knowledgeGraphManagerAny.storageProvider.updateEntityEmbedding(
          name,
          formattedEmbedding
        );
      } catch (error) {
        logger.error(
          `Neo4j knowledgeGraphManager adapter: Error in storeEntityVector for ${name}`,
          error
        );
        throw error;
      }
    } else {
      const errorMsg = `Neo4j knowledgeGraphManager adapter: updateEntityEmbedding not implemented for ${name}`;
      logger.error(errorMsg);
      throw new Error(errorMsg);
    }
  };

  logger.info(
    'Added storeEntityVector adapter method to Neo4j storage provider for KnowledgeGraphManager'
  );
}

// Custom createEntities method for immediate job processing (same as stdio version)
if (knowledgeGraphManager && typeof knowledgeGraphManager.createEntities === 'function') {
  const originalCreateEntities = knowledgeGraphManager.createEntities.bind(knowledgeGraphManager);
  knowledgeGraphManager.createEntities = async function (entities) {
    const result = await originalCreateEntities(entities);

    if (embeddingJobManager) {
      try {
        logger.info('Processing embedding jobs immediately after entity creation', {
          entityCount: entities.length,
          entityNames: entities.map((e) => e.name).join(', '),
        });
        await embeddingJobManager.processJobs(entities.length);
      } catch (error) {
        logger.error('Error processing embedding jobs immediately', {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
      }
    }

    return result;
  };
}

// Setup the MCP server (for potential future use)
const _mcpServer = setupServer(knowledgeGraphManager);

// Create Express app
const app = express();
const port = parseInt(process.env.PORT || '3000', 10);

// Middleware
app.use(
  cors({
    origin: ['https://claude.ai', 'https://api.anthropic.com'],
    credentials: true,
  })
);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static file serving for admin UI
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, '../../public');
app.use('/admin', express.static(path.join(publicDir, 'admin')));
logger.info('Admin UI enabled at /admin');

// Health check endpoint - available at both root and memento path
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    port: port,
    env: process.env.NODE_ENV || 'development',
  });
});

app.get('/memento/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    port: port,
    env: process.env.NODE_ENV || 'development',
    path: '/memento',
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: '3DN Memento Server with REST API',
    status: 'running',
    endpoints: {
      health: '/health',
      mcp: '/mcp (POST with API key)',
      tools: '/tools (GET with API key - Flowise compatible)',
      'memento-health': '/memento/health',
      '3dn-memento': '/memento/mcp (POST with API key)',
      'memento-tools': '/memento/tools (GET with API key)',
      'rest-api': '/api/v1/* (REST API endpoints with API key)',
      'api-info': '/api (GET - API information)',
    },
    timestamp: new Date().toISOString(),
  });
});

// Create service instances for REST API
const entityService = new EntityService(storageProvider, expertiseAreaManager);
const relationService = new RelationService(storageProvider, expertiseAreaManager);

// Create SearchService with vector store for semantic search
let searchService: SearchService | undefined = undefined;

// Initialize SearchService asynchronously
async function initializeSearchService(): Promise<void> {
  if (!storageConfig.vectorStoreOptions) {
    logger.warn('No vector store options configured - SearchService will not be available');
    return;
  }

  if (!embeddingService) {
    logger.warn('Embedding service not available - SearchService will not be available');
    return;
  }

  try {
    logger.info('Initializing VectorStore for SearchService', {
      type: storageConfig.vectorStoreOptions.type,
      dimensions: storageConfig.vectorStoreOptions.dimensions,
    });

    const vectorStore = await VectorStoreFactory.createVectorStore({
      ...storageConfig.vectorStoreOptions,
      initializeImmediately: true,
    });

    const defaultStrategy = (process.env.DEFAULT_SEARCH_STRATEGY as 'graph' | 'vector' | 'hybrid') || 'hybrid';

    searchService = new SearchService(
      storageProvider,
      vectorStore,
      embeddingService,
      {
        defaultStrategy,
        hybridConfig: {
          graphWeight: parseFloat(process.env.HYBRID_GRAPH_WEIGHT || '0.4'),
          vectorWeight: parseFloat(process.env.HYBRID_VECTOR_WEIGHT || '0.6'),
          deduplication: process.env.HYBRID_DEDUPLICATION !== 'false',
          rerankingEnabled: process.env.HYBRID_RERANKING === 'true',
          mergeMethod: (process.env.HYBRID_MERGE_METHOD as 'weighted' | 'rrf') || 'weighted'
        },
        enableMetadataFiltering: process.env.ENABLE_METADATA_FILTERING !== 'false',
        enableQueryAnalysis: process.env.ENABLE_QUERY_ANALYSIS !== 'false'
      }
    );

    logger.info('SearchService initialized successfully with hybrid search support');
  } catch (error) {
    logger.error('Failed to initialize SearchService', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}

// Start SearchService initialization (runs in background)
initializeSearchService().catch((err) => {
  logger.error('SearchService initialization failed', err);
});

// API info endpoint
app.get('/api', (req, res) => {
  res.json({
    name: '3DN Memento REST API',
    version: '1.0.0',
    description: 'REST API for 3DN Memento Knowledge Graph',
    endpoints: {
      entities: '/api/v1/entities',
      relations: '/api/v1/relations',
      search: '/api/v1/search',
      analytics: '/api/v1/analytics',
      temporal: '/api/v1/temporal',
      expertise: '/api/v1/expertise-areas',
      admin: '/api/v1/admin'
    },
    authentication: 'X-API-Key header required',
    adminUI: '/admin',
    timestamp: new Date().toISOString()
  });
});

// Mount REST API routes with authentication
const apiV1 = express.Router();

// Apply API key authentication to all API routes
apiV1.use(authenticateApiKey);

// Apply request logging to API routes
apiV1.use(requestLogger);

// Entity routes
apiV1.use('/entities', createEntityRoutes(entityService));

// Relation routes  
apiV1.use('/relations', createRelationRoutes(relationService));

// Search routes
// Pass a getter function so routes can access the SearchService after async initialization
apiV1.use('/search', createSearchRoutes(entityService, storageProvider, () => searchService));

// Analytics routes
apiV1.use('/analytics', createAnalyticsRoutes(knowledgeGraphManager));

// Temporal routes
apiV1.use('/temporal', createTemporalRoutes(storageProvider));

// Expertise area routes
apiV1.use('/expertise-areas', createExpertiseRoutes(entityService));

// Admin routes (conditionally enabled)
if (process.env.ADMIN_ENABLED !== 'false') {
  try {
    const adminService = createAdminServiceFromEnv();
    const s3Service = createS3ServiceFromEnv();
    const processingService = createProcessingServiceFromEnv();
    apiV1.use('/admin', createAdminRoutes(adminService, s3Service, processingService));
    logger.info('Admin routes enabled at /api/v1/admin');
  } catch (error: any) {
    logger.warn('Admin routes not initialized', { error: error.message });
  }
}

// Mount API v1
app.use('/api/v1', apiV1);

// Dedicated tools endpoint for Flowise
app.get('/tools', authenticateApiKey, async (req, res): Promise<void> => {
  try {
    logger.debug('Received tools list request via GET /tools');
    const result = await handleListToolsRequest();
    logger.debug('Sending tools list via GET /tools', { toolCount: result.tools?.length });

    // Return just the tools array for Flowise compatibility
    res.json(result.tools || []);
  } catch (error) {
    logger.error('Error in GET /tools handler', error);
    res.status(500).json({
      error: 'Internal error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

// Memento-specific tools endpoint
app.get('/memento/tools', authenticateApiKey, async (req, res): Promise<void> => {
  try {
    logger.debug('Received tools list request via GET /memento/tools');
    const result = await handleListToolsRequest();
    logger.debug('Sending tools list via GET /memento/tools', { toolCount: result.tools?.length });

    // Return just the tools array for Flowise compatibility
    res.json(result.tools || []);
  } catch (error) {
    logger.error('Error in GET /memento/tools handler', error);
    res.status(500).json({
      error: 'Internal error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

// Handle both GET and POST for MCP endpoint to support different Flowise versions
app.all('/mcp', authenticateApiKey, async (req, res): Promise<void> => {
  try {
    logger.debug('Received MCP request', {
      method: req.method,
      body: req.body,
      query: req.query,
      headers: req.headers,
    });

    // Handle GET request - check if it's for SSE or tools list
    if (req.method === 'GET') {
      const acceptHeader = req.headers.accept;

      // If client specifically requests SSE, handle as SSE connection
      if (acceptHeader && acceptHeader.includes('text/event-stream')) {
        // Set SSE headers
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Cache-Control, X-API-Key',
        });

        logger.info('SSE connection established for MCP');

        // Send initial connection event
        res.write('data: {"type":"connection","status":"connected"}\n\n');

        // Keep connection alive with periodic pings
        const pingInterval = setInterval(() => {
          res.write('data: {"type":"ping","timestamp":"' + new Date().toISOString() + '"}\n\n');
        }, 30000);

        // Handle client disconnect
        req.on('close', () => {
          logger.info('SSE connection closed');
          clearInterval(pingInterval);
        });

        req.on('error', (error) => {
          logger.error('SSE connection error', error);
          clearInterval(pingInterval);
        });
        return;
      }

      // Otherwise, handle as regular GET request for tools list
      try {
        const result = await handleListToolsRequest();
        logger.debug('Sending tools list via GET', { toolCount: result.tools?.length });
        res.json(result);
        return;
      } catch (error) {
        logger.error('Error in GET tools/list handler', error);
        res.status(500).json({
          error: 'Internal error',
          message: error instanceof Error ? error.message : String(error),
        });
        return;
      }
    }

    // Validate JSON-RPC 2.0 format
    const { jsonrpc, id, method, params } = req.body;

    if (jsonrpc !== '2.0') {
      res.status(400).json({
        jsonrpc: '2.0',
        id: id || null,
        error: {
          code: -32600,
          message: 'Invalid Request',
          data: 'JSON-RPC version must be 2.0',
        },
      });
      return;
    }

    if (!method) {
      res.status(400).json({
        jsonrpc: '2.0',
        id: id || null,
        error: {
          code: -32600,
          message: 'Invalid Request',
          data: 'Method is required',
        },
      });
      return;
    }

    let result;

    // Route MCP protocol methods to appropriate handlers
    switch (method) {
      case 'tools/list':
        try {
          result = await handleListToolsRequest();
        } catch (error) {
          logger.error('Error in tools/list handler', error);
          res.status(500).json({
            jsonrpc: '2.0',
            id: id || null,
            error: {
              code: -32603,
              message: 'Internal error',
              data: error instanceof Error ? error.message : String(error),
            },
          });
          return;
        }
        break;

      case 'tools/call':
        try {
          // Create a request object that matches the expected format
          const toolRequest = {
            method: 'tools/call',
            params: params || {},
          };
          result = await handleCallToolRequest(toolRequest, knowledgeGraphManager);
        } catch (error) {
          logger.error('Error in tools/call handler', error);
          res.status(500).json({
            jsonrpc: '2.0',
            id: id || null,
            error: {
              code: -32603,
              message: 'Internal error',
              data: error instanceof Error ? error.message : String(error),
            },
          });
          return;
        }
        break;

      case 'initialize':
        // Handle MCP initialization - accept Flowise's protocol version
        result = {
          protocolVersion: '2025-06-18',
          capabilities: {
            tools: {
              listChanged: true,
            },
            resources: {},
            prompts: {},
            logging: {},
          },
          serverInfo: {
            name: '3dn-memento',
            version: '1.0.0',
            description: '3DN Memento: Your persistent knowledge graph memory system',
          },
        };
        break;

      case 'ping':
        // Handle ping requests
        result = { status: 'pong' };
        break;

      case 'resources/list':
        // Handle resources/list requests
        result = {
          resources: [],
          _meta: {
            message: 'This knowledge graph server focuses on tools rather than resources',
            availableTools: ['create_entities', 'search_nodes', 'semantic_search', 'read_graph', 'etc.'],
            documentation: 'Use tools/list to see all available knowledge graph operations'
          }
        };
        break;

      case 'resources/templates/list':
        // Handle resources/templates/list requests  
        result = {
          resourceTemplates: [],
          _meta: {
            message: 'This knowledge graph server focuses on tools rather than resource templates',
            availableTools: ['create_entities', 'search_nodes', 'semantic_search', 'read_graph', 'etc.'],
            documentation: 'Use tools/list to see all available knowledge graph operations'
          }
        };
        break;

      case 'notifications/initialized':
        // Handle Flowise initialization notification - no response needed
        logger.debug('Received notifications/initialized from Flowise');
        res.status(200).end();
        return;

      default:
        res.status(400).json({
          jsonrpc: '2.0',
          id: id || null,
          error: {
            code: -32601,
            message: 'Method not found',
            data: `Unknown method: ${method}`,
          },
        });
        return;
    }

    const response = {
      jsonrpc: '2.0',
      id: id,
      result: result,
    };

    logger.debug('Sending MCP response', { response });
    res.json(response);
  } catch (error) {
    logger.error('Error handling MCP request', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      requestBody: req.body,
    });

    res.status(500).json({
      jsonrpc: '2.0',
      id: req.body?.id || null,
      error: {
        code: -32603,
        message: 'Internal error',
        data: error instanceof Error ? error.message : String(error),
      },
    });
  }
});

// Memento-specific MCP endpoint - duplicate of /mcp but at /memento/mcp
app.all('/memento/mcp', authenticateApiKey, async (req, res): Promise<void> => {
  try {
    logger.debug('Received 3DN Memento request', {
      method: req.method,
      body: req.body,
      query: req.query,
      headers: req.headers,
      path: '/memento/mcp',
    });

    // Handle GET request - check if it's for SSE or tools list
    if (req.method === 'GET') {
      const acceptHeader = req.headers.accept;

      // If client specifically requests SSE, handle as SSE connection
      if (acceptHeader && acceptHeader.includes('text/event-stream')) {
        // Set SSE headers
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Cache-Control, X-API-Key',
        });

        logger.info('SSE connection established for 3DN Memento');

        // Send initial connection event
        res.write('data: {"type":"connection","status":"connected","path":"/memento/mcp"}\n\n');

        // Keep connection alive with periodic pings
        const pingInterval = setInterval(() => {
          res.write('data: {"type":"ping","timestamp":"' + new Date().toISOString() + '","path":"/memento/mcp"}\n\n');
        }, 30000);

        // Handle client disconnect
        req.on('close', () => {
          logger.info('SSE connection closed for 3DN Memento');
          clearInterval(pingInterval);
        });

        req.on('error', (error) => {
          logger.error('SSE connection error for 3DN Memento', error);
          clearInterval(pingInterval);
        });
        return;
      }

      // Otherwise, handle as regular GET request for tools list
      try {
        const result = await handleListToolsRequest();
        logger.debug('Sending tools list via GET /memento/mcp', { toolCount: result.tools?.length });
        res.json(result);
        return;
      } catch (error) {
        logger.error('Error in GET /memento/mcp tools/list handler', error);
        res.status(500).json({
          error: 'Internal error',
          message: error instanceof Error ? error.message : String(error),
        });
        return;
      }
    }

    // Validate JSON-RPC 2.0 format
    const { jsonrpc, id, method, params } = req.body;

    if (jsonrpc !== '2.0') {
      res.status(400).json({
        jsonrpc: '2.0',
        id: id || null,
        error: {
          code: -32600,
          message: 'Invalid Request',
          data: 'JSON-RPC version must be 2.0',
        },
      });
      return;
    }

    if (!method) {
      res.status(400).json({
        jsonrpc: '2.0',
        id: id || null,
        error: {
          code: -32600,
          message: 'Invalid Request',
          data: 'Method is required',
        },
      });
      return;
    }

    let result;

    // Route MCP protocol methods to appropriate handlers
    switch (method) {
      case 'tools/list':
        try {
          result = await handleListToolsRequest();
        } catch (error) {
          logger.error('Error in /memento/mcp tools/list handler', error);
          res.status(500).json({
            jsonrpc: '2.0',
            id: id || null,
            error: {
              code: -32603,
              message: 'Internal error',
              data: error instanceof Error ? error.message : String(error),
            },
          });
          return;
        }
        break;

      case 'tools/call':
        try {
          // Create a request object that matches the expected format
          const toolRequest = {
            method: 'tools/call',
            params: params || {},
          };
          result = await handleCallToolRequest(toolRequest, knowledgeGraphManager);
        } catch (error) {
          logger.error('Error in /memento/mcp tools/call handler', error);
          res.status(500).json({
            jsonrpc: '2.0',
            id: id || null,
            error: {
              code: -32603,
              message: 'Internal error',
              data: error instanceof Error ? error.message : String(error),
            },
          });
          return;
        }
        break;

      case 'initialize':
        // Handle MCP initialization - accept Flowise's protocol version
        result = {
          protocolVersion: '2025-06-18',
          capabilities: {
            tools: {
              listChanged: true,
            },
            resources: {},
            prompts: {},
            logging: {},
          },
          serverInfo: {
            name: '3dn-memento',
            version: '1.0.0',
            description: '3DN Memento: Your persistent knowledge graph memory system',
          },
        };
        break;

      case 'ping':
        // Handle ping requests
        result = { status: 'pong', path: '/memento/mcp' };
        break;

      case 'resources/list':
        // Handle resources/list requests
        result = {
          resources: [],
          _meta: {
            message: 'This knowledge graph server focuses on tools rather than resources',
            availableTools: ['create_entities', 'search_nodes', 'semantic_search', 'read_graph', 'etc.'],
            documentation: 'Use tools/list to see all available knowledge graph operations'
          }
        };
        break;

      case 'resources/templates/list':
        // Handle resources/templates/list requests  
        result = {
          resourceTemplates: [],
          _meta: {
            message: 'This knowledge graph server focuses on tools rather than resource templates',
            availableTools: ['create_entities', 'search_nodes', 'semantic_search', 'read_graph', 'etc.'],
            documentation: 'Use tools/list to see all available knowledge graph operations'
          }
        };
        break;

      case 'notifications/initialized':
        // Handle Flowise initialization notification - no response needed
        logger.debug('Received notifications/initialized from Flowise at /memento/mcp');
        res.status(200).end();
        return;

      default:
        res.status(400).json({
          jsonrpc: '2.0',
          id: id || null,
          error: {
            code: -32601,
            message: 'Method not found',
            data: `Unknown method: ${method}`,
          },
        });
        return;
    }

    const response = {
      jsonrpc: '2.0',
      id: id,
      result: result,
    };

    logger.debug('Sending 3DN Memento response', { response });
    res.json(response);
  } catch (error) {
    logger.error('Error handling 3DN Memento request', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      requestBody: req.body,
    });

    res.status(500).json({
      jsonrpc: '2.0',
      id: req.body?.id || null,
      error: {
        code: -32603,
        message: 'Internal error',
        data: error instanceof Error ? error.message : String(error),
      },
    });
  }
});

// API error handling middleware (must be after API routes)
app.use('/api', errorHandler);

// Handle 404s
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Not found',
    message: `Route ${req.method} ${req.originalUrl} not found`,
    availableEndpoints: [
      'GET /health',
      'GET /api',
      'GET /api/v1/search',
      'POST /api/v1/search/semantic',
      'GET /api/v1/entities/{name}',
      'POST /api/v1/entities',
      'GET /api/v1/relations',
      'POST /api/v1/relations',
      'GET /api/v1/analytics/statistics',
      'GET /mcp (with API key)',
      'POST /mcp (with API key)'
    ]
  });
});

// General error handling middleware
app.use((error: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Express error handler', {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    url: req.url,
    method: req.method,
  });

  res.status(500).json({
    error: 'Internal server error',
    message: error instanceof Error ? error.message : String(error),
  });
});

// Start server
export async function startHttpServer(): Promise<void> {
  try {
    app.listen(port, () => {
      logger.info(`MCP HTTP Server running on port ${port}`);
      logger.info(`Health check: http://localhost:${port}/health`);
      logger.info(`MCP endpoint: http://localhost:${port}/mcp`);
      logger.info(`API Key required: ${!!process.env.MEMENTO_API_KEY}`);
    });

    // Start the job processor
    if (embeddingJobManager && !process.env.DISABLE_JOB_PROCESSING) {
      const EMBEDDING_PROCESS_INTERVAL = 30000; // 30 seconds
      setTimeout(() => {
        logger.info('Starting embedding job processor');
        setInterval(async () => {
          try {
            await embeddingJobManager?.processJobs(10);
          } catch (error) {
            logger.error('Error in scheduled job processing', {
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }, EMBEDDING_PROCESS_INTERVAL);
      }, 5000); // Wait 5 seconds after startup
    }
  } catch (error) {
    logger.error('Failed to start HTTP server', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exit(1);
  }
}

// Global error handlers to prevent server crashes
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception - server continuing', {
    error: error.message,
    stack: error.stack
  });
  // Don't exit - try to keep the server running
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled promise rejection - server continuing', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined
  });
  // Don't exit - try to keep the server running
});

// Only run if not in test environment
if (!process.env.VITEST && !process.env.NODE_ENV?.includes('test')) {
  startHttpServer().catch((error) => {
    logger.error(`HTTP server startup failed: ${error}`);
    process.exit(1);
  });
}
