#!/usr/bin/env node
import express from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { logger } from '../utils/logger.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createHttpApiClient } from './http-api-client.js';
import { setupProxyServer } from '../server/setup-proxy.js';

/**
 * MCP Streaming Server with Official SDK Transports
 *
 * This server provides MCP access over HTTP using the official MCP SDK transports:
 * - Streamable HTTP (protocol 2025-03-26+) - /mcp endpoint
 * - SSE (protocol 2024-11-05) - /sse and /messages endpoints
 *
 * This is an alternative deployment option that doesn't require local STDIO setup.
 * MCP clients can connect directly to this server over HTTP.
 *
 * Architecture (Proxy Pattern):
 * MCP Client → HTTP/SSE → MCP Server (SDK) → HTTP API Server → Knowledge Graph Manager → Storage
 *
 * Authentication Flow:
 * 1. MCP Client provides API key in X-API-Key header
 * 2. MCP Streaming Server validates API key at HTTP layer
 * 3. MCP Streaming Server proxies tool calls to HTTP API with same API key
 * 4. HTTP API validates API key again and executes request
 *
 * Endpoints:
 * - /mcp - Streamable HTTP transport (GET/POST/DELETE)
 * - /sse - SSE transport endpoint (GET to establish stream)
 * - /messages - SSE transport messages (POST to send messages)
 * - /health - Health check
 */

// Types for transport management
interface TransportEntry {
  transport: SSEServerTransport | StreamableHTTPServerTransport;
  server: Server;
  createdAt: number;
}

// Transport storage by session ID
const transports = new Map<string, TransportEntry>();
const TRANSPORT_TIMEOUT = 30 * 60 * 1000; // 30 minutes

// Authentication middleware
const authenticateApiKey = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void => {
  const apiKey =
    req.headers['x-api-key'] ||
    req.headers['authorization']?.replace('Bearer ', '') ||
    req.query.key;

  const expectedKey = process.env.MEMENTO_API_KEY;

  if (!expectedKey) {
    res.status(500).json({
      error: 'Server not configured with API key (MEMENTO_API_KEY required)',
    });
    return;
  }

  if (!apiKey || apiKey !== expectedKey) {
    res.status(401).json({ error: 'Invalid or missing API key' });
    return;
  }

  next();
};

// Cleanup old transports
function cleanupTransports(): void {
  const now = Date.now();
  for (const [sessionId, entry] of transports.entries()) {
    if (now - entry.createdAt > TRANSPORT_TIMEOUT) {
      logger.info('Cleaning up expired transport', { sessionId });
      try {
        entry.transport.close();
      } catch (error) {
        logger.debug('Error closing transport during cleanup', { error });
      }
      transports.delete(sessionId);
    }
  }
}

// Initialize HTTP API client for proxying requests
const httpApiClient = createHttpApiClient();

// Function to create a new MCP server instance (using proxy pattern)
function createMCPServer(): Server {
  return setupProxyServer(httpApiClient);
}

// Create Express app
const app = express();
const port = parseInt(process.env.STREAMING_PORT || process.env.PORT || '3001', 10);

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

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    port: port,
    transport: 'MCP SDK (Streamable HTTP + SSE)',
    activeSessions: transports.size,
    env: process.env.NODE_ENV || 'development',
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: '3DN Memento Server with Official SDK Transports',
    status: 'running',
    transports: {
      'streamable-http': {
        endpoint: '/mcp',
        protocol: '2025-03-26',
        methods: ['GET', 'POST', 'DELETE'],
        description: 'Latest MCP protocol with resumability support',
      },
      sse: {
        endpoints: {
          stream: '/sse',
          messages: '/messages',
        },
        protocol: '2024-11-05',
        description: 'Legacy SSE transport for backwards compatibility',
      },
    },
    documentation: {
      'streamable-http-usage': [
        'POST /mcp with initialize request to start session',
        'GET /mcp with Mcp-Session-Id header to establish SSE stream',
        'POST /mcp with Mcp-Session-Id header to send messages',
        'DELETE /mcp with Mcp-Session-Id header to terminate session',
      ],
      'sse-usage': [
        'GET /sse to establish SSE stream and get sessionId',
        'POST /messages?sessionId=<id> to send messages',
      ],
    },
    authentication: 'X-API-Key header or ?key= query parameter required',
    timestamp: new Date().toISOString(),
  });
});

//=============================================================================
// STREAMABLE HTTP TRANSPORT (PROTOCOL VERSION 2025-03-26+)
//=============================================================================

app.all('/mcp', authenticateApiKey, async (req, res) => {
  logger.debug(`Received ${req.method} request to /mcp (Streamable HTTP)`);

  try {
    const sessionId = req.headers['mcp-session-id'] as string;
    let transportEntry: TransportEntry | undefined;

    // Check for existing session
    if (sessionId && transports.has(sessionId)) {
      transportEntry = transports.get(sessionId);

      // Verify transport type
      if (
        transportEntry &&
        !(transportEntry.transport instanceof StreamableHTTPServerTransport)
      ) {
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message:
              'Bad Request: Session exists but uses a different transport (SSE)',
          },
          id: null,
        });
        return;
      }
    } else if (
      !sessionId &&
      req.method === 'POST' &&
      isInitializeRequest(req.body)
    ) {
      // Create new Streamable HTTP transport
      logger.info('Creating new Streamable HTTP transport session');

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newSessionId: string) => {
          logger.info('Streamable HTTP session initialized', {
            sessionId: newSessionId,
          });
        },
      });

      const server = createMCPServer();

      // Set up close handler
      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid && transports.has(sid)) {
          logger.info('Transport closed, removing from sessions', {
            sessionId: sid,
          });
          transports.delete(sid);
        }
      };

      // Connect server to transport
      await server.connect(transport);

      // Store transport entry
      transportEntry = {
        transport,
        server,
        createdAt: Date.now(),
      };

      // The session ID will be available after handleRequest processes the initialize
      const tempSessionId = (transport as any)._sessionId || randomUUID();
      transports.set(tempSessionId, transportEntry);

      // Handle the request
      await transport.handleRequest(req, res, req.body);

      // Update with actual session ID if it changed
      if (transport.sessionId && transport.sessionId !== tempSessionId) {
        transports.delete(tempSessionId);
        transports.set(transport.sessionId, transportEntry);
      }

      return;
    } else {
      // Invalid request
      res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Bad Request: No valid session ID provided or not an initialize request',
        },
        id: null,
      });
      return;
    }

    // Handle request with existing transport
    if (transportEntry) {
      await (transportEntry.transport as StreamableHTTPServerTransport).handleRequest(
        req,
        res,
        req.body
      );
    } else {
      res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Session not found',
        },
        id: null,
      });
    }
  } catch (error) {
    logger.error('Error handling Streamable HTTP request', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error',
        },
        id: null,
      });
    }
  }
});

//=============================================================================
// SSE TRANSPORT (PROTOCOL VERSION 2024-11-05) - BACKWARDS COMPATIBILITY
//=============================================================================

app.get('/sse', async (req, res) => {
  logger.info('Received GET request to /sse (SSE transport)');

  // Special authentication for SSE - also check query params since Claude Desktop can't send headers on GET
  const apiKey =
    req.headers['x-api-key'] ||
    req.headers['authorization']?.replace('Bearer ', '') ||
    req.query.key;

  const expectedKey = process.env.MEMENTO_API_KEY;

  if (!expectedKey) {
    res.status(500).json({
      error: 'Server not configured with API key (MEMENTO_API_KEY required)',
    });
    return;
  }

  if (!apiKey || apiKey !== expectedKey) {
    res.status(401).json({ error: 'Invalid or missing API key' });
    return;
  }

  try {
    // Create SSE transport
    const transport = new SSEServerTransport('/messages', res);
    const sessionId = transport.sessionId;

    logger.info('SSE session established', { sessionId });

    // Create and connect MCP server
    const server = createMCPServer();

    // Store transport entry
    const transportEntry: TransportEntry = {
      transport,
      server,
      createdAt: Date.now(),
    };

    transports.set(sessionId, transportEntry);

    // Handle connection close
    res.on('close', () => {
      logger.info('SSE connection closed', { sessionId });
      transports.delete(sessionId);
    });

    // Connect server to transport (this also starts the transport)
    await server.connect(transport);
  } catch (error) {
    logger.error('Error establishing SSE connection', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    if (!res.headersSent) {
      res.status(500).json({
        error: 'Failed to establish SSE connection',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
});

app.post('/messages', authenticateApiKey, async (req, res) => {
  const sessionId = req.query.sessionId as string;

  logger.debug('Received POST to /messages', { sessionId });

  if (!sessionId) {
    res.status(400).json({ error: 'sessionId query parameter required' });
    return;
  }

  const transportEntry = transports.get(sessionId);

  if (!transportEntry) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  // Verify transport type
  if (!(transportEntry.transport instanceof SSEServerTransport)) {
    res.status(400).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message:
          'Bad Request: Session exists but uses a different transport (Streamable HTTP)',
      },
      id: null,
    });
    return;
  }

  try {
    await transportEntry.transport.handlePostMessage(req, res, req.body);
  } catch (error) {
    logger.error('Error handling POST message', {
      error: error instanceof Error ? error.message : String(error),
      sessionId,
    });

    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error',
        },
        id: null,
      });
    }
  }
});

// Handle 404s
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    message: `Route ${req.method} ${req.originalUrl} not found`,
    availableEndpoints: [
      'GET /health',
      'GET /',
      'GET /mcp (with Mcp-Session-Id)',
      'POST /mcp',
      'DELETE /mcp (with Mcp-Session-Id)',
      'GET /sse',
      'POST /messages?sessionId=<id>',
    ],
  });
});

// Error handling middleware
app.use(
  (
    error: any,
    req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
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
  }
);

// Start server
export async function startMCPStreamingServer(): Promise<void> {
  try {
    // Start transport cleanup interval
    setInterval(cleanupTransports, 5 * 60 * 1000); // Every 5 minutes

    app.listen(port, async () => {
      logger.info(`MCP Streaming Server (Proxy Mode) running on port ${port}`);
      logger.info(`Health check: http://localhost:${port}/health`);
      logger.info(`Streamable HTTP: http://localhost:${port}/mcp`);
      logger.info(`SSE endpoint: http://localhost:${port}/sse`);
      logger.info(`SSE messages: http://localhost:${port}/messages`);
      logger.info(`API Key required: ${!!process.env.MEMENTO_API_KEY}`);
      logger.info('');
      logger.info('Proxy Architecture:');
      logger.info(`  MCP Client → This Server (:${port}) → HTTP API (:${process.env.API_PORT || 3000})`);
      logger.info('');
      logger.info('Transport Options:');
      logger.info('  1. Streamable HTTP (2025-03-26+):');
      logger.info('     - Initialize: POST /mcp');
      logger.info('     - Stream: GET /mcp with Mcp-Session-Id');
      logger.info('     - Messages: POST /mcp with Mcp-Session-Id');
      logger.info('  2. SSE (2024-11-05):');
      logger.info('     - Stream: GET /sse');
      logger.info('     - Messages: POST /messages?sessionId=<id>');

      // Verify HTTP API is accessible
      const isHealthy = await httpApiClient.healthCheck();
      if (isHealthy) {
        logger.info('✓ HTTP API connection verified');
      } else {
        logger.warn('⚠ HTTP API health check failed - requests will fail until HTTP API is available');
      }
    });
  } catch (error) {
    logger.error('Failed to start MCP Streaming server', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Shutting down MCP Streaming server...');

  // Close all active transports
  for (const [sessionId, entry] of transports.entries()) {
    try {
      logger.info(`Closing transport for session ${sessionId}`);
      await entry.transport.close();
      transports.delete(sessionId);
    } catch (error) {
      logger.error(`Error closing transport for session ${sessionId}`, { error });
    }
  }

  logger.info('Server shutdown complete');
  process.exit(0);
});

// Only run if not in test environment
if (!process.env.VITEST && !process.env.NODE_ENV?.includes('test')) {
  startMCPStreamingServer().catch((error) => {
    logger.error(`MCP Streaming server startup failed: ${error}`);
    process.exit(1);
  });
}
