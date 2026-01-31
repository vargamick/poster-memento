/**
 * HTTP API Client for MCP Streaming Server
 *
 * This client wraps calls to the HTTP API server running on localhost:3000,
 * forwarding the authenticated API key to ensure proper authorization.
 *
 * Architecture:
 * MCP Client → MCP Streaming (validates key) → HTTP API (validates key) → KnowledgeGraphManager
 */

import { logger } from '../utils/logger.js';

export class HttpApiClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl?: string, apiKey?: string) {
    // Default to localhost:3000 (the HTTP API server running in same container)
    this.baseUrl = baseUrl || `http://localhost:${process.env.API_PORT || '3000'}`;
    this.apiKey = apiKey || process.env.MEMENTO_API_KEY || '';

    if (!this.apiKey) {
      logger.warn('HttpApiClient initialized without API key');
    }
  }

  /**
   * Call an MCP tool via the HTTP API's /mcp endpoint
   */
  async callTool(toolName: string, args: Record<string, unknown>): Promise<any> {
    const url = `${this.baseUrl}/mcp?key=${encodeURIComponent(this.apiKey)}`;

    logger.debug(`Calling HTTP API tool: ${toolName}`, { url, args });

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'tools/call',
          params: {
            name: toolName,
            arguments: args,
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('HTTP API call failed', {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
        });
        throw new Error(`HTTP API error (${response.status}): ${errorText}`);
      }

      const data: any = await response.json();

      // Handle JSON-RPC error responses
      if (data.error) {
        logger.error('JSON-RPC error from HTTP API', { error: data.error });
        throw new Error(data.error.message || JSON.stringify(data.error));
      }

      return data.result;
    } catch (error) {
      logger.error('Error calling HTTP API', {
        toolName,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * List available tools from the HTTP API
   */
  async listTools(): Promise<any> {
    const url = `${this.baseUrl}/mcp?key=${encodeURIComponent(this.apiKey)}`;

    logger.debug('Listing tools from HTTP API', { url });

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'tools/list',
          params: {},
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP API error (${response.status}): ${errorText}`);
      }

      const data: any = await response.json();

      if (data.error) {
        throw new Error(data.error.message || JSON.stringify(data.error));
      }

      return data.result;
    } catch (error) {
      logger.error('Error listing tools from HTTP API', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Check if the HTTP API is available
   */
  async healthCheck(): Promise<boolean> {
    const url = `${this.baseUrl}/health`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'X-API-Key': this.apiKey,
        },
      });

      return response.ok;
    } catch (error) {
      logger.error('HTTP API health check failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }
}

/**
 * Create an HttpApiClient instance with the current environment configuration
 */
export function createHttpApiClient(): HttpApiClient {
  return new HttpApiClient();
}
