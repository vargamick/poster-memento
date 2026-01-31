import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema, ListResourcesRequestSchema, ListResourceTemplatesRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { handleListToolsRequest } from './handlers/listToolsHandler.js';
import { handleCallToolRequest } from './handlers/callToolHandler.js';

/**
 * Sets up and configures the MCP server with the appropriate request handlers.
 *
 * @param knowledgeGraphManager The KnowledgeGraphManager instance to use for request handling
 * @returns The configured server instance
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function setupServer(knowledgeGraphManager: any): Server {
  // Create server instance
  const server = new Server(
    {
      name: '3dn-memento',
      version: '1.0.0',
      description: '3DN Memento: Your persistent knowledge graph memory system',
      publisher: 'gannonh',
    },
    {
      capabilities: {
        tools: {},
        resources: {}, // Add resources capability to support resources/list and resources/templates/list
        serverInfo: {}, // Add this capability to fix the error
        notifications: {}, // Add this capability for complete support
        logging: {}, // Add this capability for complete support
      },
    }
  );

  // Register request handlers
  server.setRequestHandler(ListToolsRequestSchema, async (_request) => {
    try {
      const result = await handleListToolsRequest();
      return result;
    } catch (error: unknown) {
      throw error;
    }
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const result = await handleCallToolRequest(request, knowledgeGraphManager);
      return result;
    } catch (error: unknown) {
      throw error;
    }
  });

  // Add resource handlers to prevent "Method not found" errors in MCP clients like Cline
  server.setRequestHandler(ListResourcesRequestSchema, async (_request) => {
    // This MCP server focuses on knowledge graph tools rather than resources
    return {
      resources: [],
      _meta: {
        message: 'This knowledge graph server focuses on tools rather than resources',
        availableTools: ['create_entities', 'search_nodes', 'semantic_search', 'read_graph', 'etc.'],
        documentation: 'Use tools/list to see all available knowledge graph operations'
      }
    };
  });

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async (_request) => {
    // This MCP server focuses on knowledge graph tools rather than resource templates
    return {
      resourceTemplates: [],
      _meta: {
        message: 'This knowledge graph server focuses on tools rather than resource templates',
        availableTools: ['create_entities', 'search_nodes', 'semantic_search', 'read_graph', 'etc.'],
        documentation: 'Use tools/list to see all available knowledge graph operations'
      }
    };
  });

  return server;
}
