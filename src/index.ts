#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { log } from 'console';
import { NEON_HANDLERS, NEON_TOOLS } from './tools.js';
import { IsNeonToolName } from './utils.js';

const server = new Server(
  {
    name: 'mcp-server-neon',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// Handle list tools request
server.setRequestHandler(ListToolsRequestSchema, async () => {
  log('Received list tools request');
  return { tools: NEON_TOOLS };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const toolName = request.params.name;
  log('Received tool call:', toolName);

  try {
    if (IsNeonToolName(toolName)) {
      return await NEON_HANDLERS[toolName](request);
    }

    throw new Error(`Unknown tool: ${toolName}`);
  } catch (error) {
    log('Error handling tool call:', error);
    return {
      toolResult: {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      },
    };
  }
});

/**
 * Start the server using stdio transport.
 * This allows the server to communicate via standard input/output streams.
 */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
