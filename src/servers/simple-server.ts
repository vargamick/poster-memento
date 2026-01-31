#!/usr/bin/env node
import express from 'express';
import cors from 'cors';
import { logger } from '../utils/logger.js';

const app = express();
const port = parseInt(process.env.PORT || '3000', 10);

// Middleware
app.use(cors());
app.use(express.json());

// Simple authentication middleware
const authenticateApiKey = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void => {
  const apiKey = req.headers['x-api-key'] || req.query.key;
  // Support MEMENTO_API_KEY
  const expectedKey = process.env.MEMENTO_API_KEY;

  if (!expectedKey) {
    res.status(500).json({ error: 'Server not configured with API key' });
    return;
  }

  if (!apiKey || apiKey !== expectedKey) {
    res.status(401).json({ error: 'Invalid or missing API key' });
    return;
  }

  next();
};

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    port: port,
    env: process.env.NODE_ENV || 'development',
    envVars: {
      MEMENTO_API_KEY: !!process.env.MEMENTO_API_KEY,
      NEO4J_URI: !!process.env.NEO4J_URI,
      NEO4J_USERNAME: !!process.env.NEO4J_USERNAME,
      NEO4J_PASSWORD: !!process.env.NEO4J_PASSWORD,
      MEMORY_STORAGE_TYPE: process.env.MEMORY_STORAGE_TYPE,
    },
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: '3DN Memento Server (Simple Test Version)',
    status: 'running',
    endpoints: {
      health: '/health',
      mcp: '/mcp (POST with API key)',
    },
    timestamp: new Date().toISOString(),
  });
});

// Simple MCP endpoint
app.post('/mcp', authenticateApiKey, async (req, res) => {
  try {
    logger.info('Received MCP request', { body: req.body });

    // Simple MCP response
    const response = {
      jsonrpc: '2.0',
      id: req.body.id,
      result: {
        message: 'MCP server is running but not fully initialized',
        method: req.body.method,
        timestamp: new Date().toISOString(),
      },
    };

    res.json(response);
  } catch (error) {
    logger.error('Error handling MCP request', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      jsonrpc: '2.0',
      id: req.body.id,
      error: {
        code: -32603,
        message: 'Internal error',
        data: error instanceof Error ? error.message : String(error),
      },
    });
  }
});

// Handle 404s
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
app.listen(port, '0.0.0.0', () => {
  logger.info(`Simple MCP Server running on port ${port}`);
  logger.info(`Health check: http://localhost:${port}/health`);
  logger.info(`MCP endpoint: http://localhost:${port}/mcp`);
  logger.info(`Environment variables check:`);
  logger.info(`- MEMENTO_API_KEY: ${!!process.env.MEMENTO_API_KEY}`);
  logger.info(`- NEO4J_URI: ${process.env.NEO4J_URI || 'not set'}`);
  logger.info(`- NEO4J_USERNAME: ${process.env.NEO4J_USERNAME || 'not set'}`);
  logger.info(`- NEO4J_PASSWORD: ${!!process.env.NEO4J_PASSWORD}`);
  logger.info(`- MEMORY_STORAGE_TYPE: ${process.env.MEMORY_STORAGE_TYPE || 'not set'}`);
});

export default app;
