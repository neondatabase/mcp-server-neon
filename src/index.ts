#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { NEON_HANDLERS, NEON_TOOLS, ToolHandler } from './tools.js';
import { NEON_RESOURCES } from './resources.js';
import { handleInit, parseArgs } from './initConfig.js';
import { createApiClient } from '@neondatabase/api-client';
import './polyfills.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'),
);

const commands = ['init', 'start'] as const;
const { command, neonApiKey, executablePath } = parseArgs();
if (!commands.includes(command as (typeof commands)[number])) {
  console.error(`Invalid command: ${command}`);
  process.exit(1);
}

if (command === 'init') {
  // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression, @typescript-eslint/await-thenable
  await handleInit({
    executablePath,
    neonApiKey,
  });
  process.exit(0);
}

// "start" command from here
// ----------------------------

export const neonClient = createApiClient({
  apiKey: neonApiKey,
  headers: {
    'User-Agent': `mcp-server-neon/${packageJson.version}`,
  },
});

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

// Register tools
NEON_TOOLS.forEach((tool) => {
  const handler = NEON_HANDLERS[tool.name];
  if (!handler) {
    throw new Error(`Handler for tool ${tool.name} not found`);
  }

  server.tool(
    tool.name,
    tool.description,
    { params: tool.inputSchema },
    handler as ToolHandler<typeof tool.name>,
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

/**
 * Start the server using stdio transport.
 * This allows the server to communicate via standard input/output streams.
 */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  console.error('Server error:', error);
  process.exit(1);
});
