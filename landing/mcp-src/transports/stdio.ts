#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
/**
 * Start the server using stdio transport.
 * This allows the server to communicate via standard input/output streams.
 */
export const startStdio = async (server: McpServer) => {
  const transport = new StdioServerTransport();
  await server.connect(transport);
};
