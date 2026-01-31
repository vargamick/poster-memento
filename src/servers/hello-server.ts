#!/usr/bin/env node

// Minimal Hello World server to test deployment
import http from 'http';
const port = parseInt(process.env.PORT || '3000', 10);

const server = http.createServer((req, res) => {
  const url = req.url;
  const method = req.method;

  console.log(`${new Date().toISOString()} ${method} ${url}`);

  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
  res.setHeader('Content-Type', 'application/json');

  if (method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (url === '/health') {
    res.writeHead(200);
    res.end(
      JSON.stringify({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        port: port,
        message: 'Hello World MCP Server is running!',
      })
    );
  } else if (url === '/') {
    res.writeHead(200);
    res.end(
      JSON.stringify({
        message: 'Hello World MCP Server',
        status: 'running',
        timestamp: new Date().toISOString(),
        port: port,
        endpoints: {
          health: '/health',
          test: '/test',
        },
      })
    );
  } else if (url === '/test') {
    res.writeHead(200);
    res.end(
      JSON.stringify({
        message: 'Test endpoint working!',
        timestamp: new Date().toISOString(),
        environment: {
          NODE_ENV: process.env.NODE_ENV || 'undefined',
          PORT: process.env.PORT || 'undefined',
          MEMENTO_API_KEY: process.env.MEMENTO_API_KEY ? 'SET' : 'NOT SET',
          NEO4J_URI: process.env.NEO4J_URI || 'undefined',
        },
      })
    );
  } else {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Hello World MCP Server running on port ${port}`);
  console.log(`Health check: http://localhost:${port}/health`);
  console.log(`Test endpoint: http://localhost:${port}/test`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

console.log('Server startup complete');
