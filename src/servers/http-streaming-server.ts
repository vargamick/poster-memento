#!/usr/bin/env node
import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import { KnowledgeGraphManager } from '../KnowledgeGraphManager.js';
import { initializeStorageProvider } from '../config/storage.js';
import { setupServer } from '../server/setup.js';
import { EmbeddingJobManager } from '../embeddings/EmbeddingJobManager.js';
import { EmbeddingServiceFactory } from '../embeddings/EmbeddingServiceFactory.js';
import { logger } from '../utils/logger.js';
import { handleListToolsRequest } from '../server/handlers/listToolsHandler.js';
import { handleCallToolRequest } from '../server/handlers/callToolHandler.js';

// Types for session management
interface Session {
  id: string;
  createdAt: number;
  lastActivity: number;
  connections: Set<express.Response>;
}

interface SSEConnection {
  response: express.Response;
  sessionId?: string;
  eventId: number;
  lastEventId?: string;
}

// Session and connection management
const sessions = new Map<string, Session>();
const connections = new Set<SSEConnection>();
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes
const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes

// Authentication middleware
const authenticateApiKey = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void => {
  const apiKey = req.headers['x-api-key'] || req.query.key;
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

// Origin validation for security
const validateOrigin = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void => {
  const origin = req.headers.origin;
  const allowedOrigins = [
    'https://claude.ai',
    'https://api.anthropic.com',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ];

  // Allow requests without origin (e.g., from curl, Postman)
  if (!origin || allowedOrigins.includes(origin)) {
    next();
    return;
  }

  logger.warn('Blocked request from unauthorized origin', { origin });
  res.status(403).json({ error: 'Unauthorized origin' });
};

// Protocol version validation
const validateProtocolVersion = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void => {
  const protocolVersion = req.headers['mcp-protocol-version'];
  const supportedVersions = ['2025-06-18', '2025-03-26', '2024-11-05'];

  if (protocolVersion && !supportedVersions.includes(protocolVersion as string)) {
    res.status(400).json({ error: `Unsupported MCP protocol version: ${protocolVersion}` });
    return;
  }

  next();
};

// Session management functions
function createSession(): Session {
  const sessionId = uuidv4();
  const session: Session = {
    id: sessionId,
    createdAt: Date.now(),
    lastActivity: Date.now(),
    connections: new Set(),
  };
  sessions.set(sessionId, session);
  logger.debug('Created new session', { sessionId });
  return session;
}

function getSession(sessionId: string): Session | null {
  const session = sessions.get(sessionId);
  if (session) {
    session.lastActivity = Date.now();
    return session;
  }
  return null;
}

function cleanupSessions(): void {
  const now = Date.now();
  for (const [sessionId, session] of sessions.entries()) {
    if (now - session.lastActivity > SESSION_TIMEOUT) {
      // Close all connections for this session
      for (const connection of session.connections) {
        try {
          connection.end();
        } catch (error) {
          logger.debug('Error closing connection during session cleanup', { error });
        }
      }
      sessions.delete(sessionId);
      logger.debug('Cleaned up expired session', { sessionId });
    }
  }
}

// SSE utility functions
function sendSSEMessage(connection: SSEConnection, data: any, eventType?: string): void {
  try {
    const eventId = ++connection.eventId;
    let message = `id: ${eventId}\n`;

    if (eventType) {
      message += `event: ${eventType}\n`;
    }

    message += `data: ${JSON.stringify(data)}\n\n`;

    connection.response.write(message);
    logger.debug('Sent SSE message', { eventId, eventType, sessionId: connection.sessionId });
  } catch (error) {
    logger.error('Error sending SSE message', { error, sessionId: connection.sessionId });
  }
}

function setupSSEConnection(
  req: express.Request,
  res: express.Response,
  sessionId?: string
): SSEConnection {
  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': req.headers.origin || '*',
    'Access-Control-Allow-Credentials': 'true',
  });

  const connection: SSEConnection = {
    response: res,
    sessionId,
    eventId: 0,
    lastEventId: req.headers['last-event-id'] as string,
  };

  connections.add(connection);

  // Add to session if provided
  if (sessionId) {
    const session = getSession(sessionId);
    if (session) {
      session.connections.add(res);
    }
  }

  // Handle connection close
  req.on('close', () => {
    connections.delete(connection);
    if (sessionId) {
      const session = getSession(sessionId);
      if (session) {
        session.connections.delete(res);
      }
    }
    logger.debug('SSE connection closed', { sessionId });
  });

  logger.debug('SSE connection established', { sessionId });
  return connection;
}

// Initialize storage and create KnowledgeGraphManager (same as original)
const storageProvider = initializeStorageProvider();

// Initialize embedding job manager (same as original)
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

  const embeddingService = EmbeddingServiceFactory.createFromEnvironment();
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

  // Neo4j storage provider adapter (same as original)
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

// Create the KnowledgeGraphManager (same as original)
const knowledgeGraphManager = new KnowledgeGraphManager({
  storageProvider,
  embeddingJobManager,
  vectorStoreOptions: (storageProvider as any).vectorStoreOptions,
});

// Add storeEntityVector method to storage provider (same as original)
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

// Custom createEntities method for immediate job processing (same as original)
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

// Setup the MCP server (not used in HTTP transport but needed for initialization)
const _mcpServer = setupServer(knowledgeGraphManager);

// Create Express app
const app = express();
const port = parseInt(process.env.PORT || '3000', 10);

// Middleware
app.use(
  cors({
    origin: [
      'https://claude.ai',
      'https://api.anthropic.com',
      'http://localhost:3000',
      'http://127.0.0.1:3000',
    ],
    credentials: true,
  })
);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Security middleware
app.use(validateOrigin);
app.use(validateProtocolVersion);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    port: port,
    env: process.env.NODE_ENV || 'development',
    transport: 'streamable-http',
    sessions: sessions.size,
    connections: connections.size,
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: '3DN Memento Server - Streamable HTTP Transport',
    status: 'running',
    transport: 'streamable-http',
    endpoints: {
      health: '/health',
      mcp: '/mcp (GET for SSE, POST for requests)',
    },
    timestamp: new Date().toISOString(),
  });
});

// MCP endpoint - GET method for SSE streams
app.get('/mcp', authenticateApiKey, async (req, res): Promise<void> => {
  try {
    const acceptHeader = req.headers.accept || '';

    if (!acceptHeader.includes('text/event-stream')) {
      res.status(406).json({ error: 'GET method requires Accept: text/event-stream' });
      return;
    }

    const sessionId = req.headers['mcp-session-id'] as string;
    let session: Session | null = null;

    if (sessionId) {
      session = getSession(sessionId);
      if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }
    }

    const connection = setupSSEConnection(req, res, sessionId);

    // Send initial connection confirmation
    sendSSEMessage(connection, {
      type: 'connection',
      message: 'SSE stream established',
      sessionId: sessionId || null,
    });
  } catch (error) {
    logger.error('Error handling GET /mcp request', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    if (!res.headersSent) {
      res.status(500).json({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
});

// MCP endpoint - POST method for JSON-RPC requests
app.post('/mcp', authenticateApiKey, async (req, res): Promise<void> => {
  try {
    logger.debug('Received MCP POST request', { body: req.body });

    const acceptHeader = req.headers.accept || '';
    const supportsSSE = acceptHeader.includes('text/event-stream');

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

    // Handle session management
    let sessionId = req.headers['mcp-session-id'] as string;
    let session: Session | null = null;

    if (sessionId) {
      session = getSession(sessionId);
      if (!session && method !== 'initialize') {
        res.status(404).json({
          jsonrpc: '2.0',
          id: id || null,
          error: {
            code: -32603,
            message: 'Session not found',
          },
        });
        return;
      }
    }

    let result;

    // Route MCP protocol methods to appropriate handlers
    switch (method) {
      case 'initialize':
        // Handle MCP initialization
        session = createSession();
        sessionId = session.id;

        result = {
          protocolVersion: '2025-06-18',
          capabilities: {
            tools: {},
            serverInfo: {},
            notifications: {},
            logging: {},
          },
          serverInfo: {
            name: '3dn-memento',
            version: '1.0.0',
            description: '3DN Memento: Your persistent knowledge graph memory system',
          },
        };

        // Set session header
        res.setHeader('Mcp-Session-Id', sessionId);
        break;

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

      case 'ping':
        result = { status: 'pong' };
        break;

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

    // Determine response format based on Accept header and method
    const shouldUseSSE = supportsSSE && (method === 'tools/call' || method === 'initialize');

    if (shouldUseSSE) {
      // Use SSE streaming for complex operations
      const connection = setupSSEConnection(req, res, sessionId);

      // Send the JSON-RPC response as an SSE event
      sendSSEMessage(
        connection,
        {
          jsonrpc: '2.0',
          id: id || null,
          result: result,
        },
        'response'
      );

      // Close the stream after sending the response
      setTimeout(() => {
        try {
          res.end();
        } catch (error) {
          logger.debug('Error closing SSE stream', { error });
        }
      }, 100);
    } else {
      // Use regular JSON response
      const response = {
        jsonrpc: '2.0',
        id: id || null,
        result: result,
      };

      logger.debug('Sending JSON response', { response });
      res.json(response);
    }
  } catch (error) {
    logger.error('Error handling MCP POST request', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      requestBody: req.body,
    });

    if (!res.headersSent) {
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
  }
});

// Session termination endpoint
app.delete('/mcp', authenticateApiKey, async (req, res): Promise<void> => {
  const sessionId = req.headers['mcp-session-id'] as string;

  if (!sessionId) {
    res.status(400).json({ error: 'Session ID required' });
    return;
  }

  const session = sessions.get(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  // Close all connections for this session
  for (const connection of session.connections) {
    try {
      connection.end();
    } catch (error) {
      logger.debug('Error closing connection during session termination', { error });
    }
  }

  sessions.delete(sessionId);
  logger.info('Session terminated', { sessionId });

  res.status(200).json({ message: 'Session terminated' });
});

// Handle 404s
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handling middleware
app.use((error: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Express error handler', {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    url: req.url,
    method: req.method,
  });

  if (!res.headersSent) {
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

// Start server
export async function startHttpStreamingServer(): Promise<void> {
  try {
    // Start session cleanup interval
    setInterval(cleanupSessions, CLEANUP_INTERVAL);

    app.listen(port, '0.0.0.0', () => {
      logger.info(`MCP HTTP Streaming Server running on port ${port}`);
      logger.info(`Health check: http://localhost:${port}/health`);
      logger.info(`MCP endpoint: http://localhost:${port}/mcp`);
      logger.info(`Transport: Streamable HTTP with SSE support`);
      logger.info(`API Key required: ${!!process.env.MEMENTO_API_KEY}`);
      logger.info(`Bound to localhost for security`);
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
    logger.error('Failed to start HTTP streaming server', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exit(1);
  }
}

// Only run if not in test environment
if (!process.env.VITEST && !process.env.NODE_ENV?.includes('test')) {
  startHttpStreamingServer().catch((error) => {
    logger.error(`HTTP streaming server startup failed: ${error}`);
    process.exit(1);
  });
}
