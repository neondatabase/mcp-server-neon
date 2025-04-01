#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { NEON_RESOURCES } from '../resources.js';
import { NEON_HANDLERS, NEON_TOOLS, ToolHandlerExtended } from '../tools.js';
import { logger } from '../utils/logger.js';
import { createNeonClient, getPackageJson } from './api.js';

export const createMcpServer = (apiKey: string) => {
  const server = new McpServer(
    {
      name: 'mcp-server-neon',
      version: getPackageJson().version,
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    },
  );

  const neonClient = createNeonClient(apiKey);

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
      // In case of no input parameters, the tool is invoked with an empty`{}`
      // however zod expects `{params: {}}`
      // To workaround this, we use `optional()`
      { params: tool.inputSchema.optional() },
      async (args, extra) => {
        logger.info('tool call:', { tool: tool.name, args });
        // @ts-expect-error: Ignore zod optional
        return await toolHandler(args, neonClient, extra);
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

  // server.server.setRequestHandler(CallToolRequestSchema, async (request) => {
  //   const { name, arguments: args } = request.params;
  //   console.log(chalk.green('Tool called:'), name, args);
  //   return {
  //     text: 'Hello, world!',
  //     result: 'success',
  //   };
  // });
  server.server.onerror = (error) => {
    logger.error('Server error:', { error });
  };

  return server;
};
