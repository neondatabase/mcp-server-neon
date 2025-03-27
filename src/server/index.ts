#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createApiClient } from '@neondatabase/api-client';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { NEON_RESOURCES } from '../resources.js';
import { NEON_HANDLERS, NEON_TOOLS, ToolHandlerExtended } from '../tools.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../..', 'package.json'), 'utf8'),
);

export const createMcpServer = (apiKey: string) => {
  const server = new McpServer(
    {
      name: 'mcp-server-neon',
      version: packageJson.version,
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    },
  );

  const neonClient = createApiClient({
    apiKey,
    headers: {
      'User-Agent': `mcp-server-neon/${packageJson.version}`,
    },
  });

  // Register tools
  NEON_TOOLS.forEach((tool) => {
    const handler = NEON_HANDLERS[tool.name];
    if (!handler) {
      throw new Error(`Handler for tool ${tool.name} not found`);
    }

    const toolHandler = handler as ToolHandlerExtended<typeof tool.name>;

    server.tool(
      tool.name,
      tool.description,
      { params: tool.inputSchema },
      async ({ params }, extra) => {
        return await toolHandler({ params }, neonClient, extra);
      },
    );
  });

  // Register resources
  NEON_RESOURCES.forEach((resource) => {
    server.resource(
      resource.name,
      resource.uri,
      {
        description: resource.description,
        mimeType: resource.mimeType,
      },
      resource.handler,
    );
  });

  return server;
};
