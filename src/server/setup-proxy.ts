import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { HttpApiClient } from '../servers/http-api-client.js';
import { logger } from '../utils/logger.js';

/**
 * Sets up an MCP server that proxies all requests to the HTTP API server.
 *
 * This approach ensures that:
 * 1. All authentication happens at the HTTP API layer
 * 2. No code duplication between HTTP API and MCP streaming
 * 3. Consistent behavior across both interfaces
 *
 * Architecture:
 * MCP Client → MCP Streaming Server (this) → HTTP API Server → KnowledgeGraphManager
 *
 * @param httpApiClient The HTTP API client to use for proxying requests
 * @returns The configured server instance
 */
export function setupProxyServer(httpApiClient: HttpApiClient): Server {
  // Create server instance
  const server = new Server(
    {
      name: '3dn-memento-streaming',
      version: '1.0.0',
      description: '3DN Memento Streaming: HTTP/SSE proxy to Memento knowledge graph API',
      publisher: 'gannonh',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        serverInfo: {},
        notifications: {},
        logging: {},
      },
    }
  );

  // Register tools/list handler - proxy to HTTP API
  server.setRequestHandler(ListToolsRequestSchema, async (_request) => {
    try {
      logger.debug('Proxying tools/list request to HTTP API');
      const result = await httpApiClient.listTools();
      return result;
    } catch (error: unknown) {
      logger.error('Error proxying tools/list', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  });

  // Register tools/call handler - proxy to HTTP API
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const { name, arguments: args } = request.params;

      logger.debug('Proxying tools/call request to HTTP API', {
        toolName: name,
        args,
      });

      const result = await httpApiClient.callTool(name, args || {});
      return result;
    } catch (error: unknown) {
      logger.error('Error proxying tools/call', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  });

  // Add resource handlers
  server.setRequestHandler(ListResourcesRequestSchema, async (_request) => {
    return {
      resources: [],
      _meta: {
        message: 'This knowledge graph server focuses on tools rather than resources',
        availableTools: [
          'create_entities',
          'search_nodes',
          'semantic_search',
          'read_graph',
          'etc.',
        ],
        documentation: 'Use tools/list to see all available knowledge graph operations',
      },
    };
  });

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async (_request) => {
    return {
      resourceTemplates: [],
      _meta: {
        message: 'This knowledge graph server focuses on tools rather than resource templates',
        availableTools: [
          'create_entities',
          'search_nodes',
          'semantic_search',
          'read_graph',
          'etc.',
        ],
        documentation: 'Use tools/list to see all available knowledge graph operations',
      },
    };
  });

  return server;
}
