#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { NEON_RESOURCES } from '../resources.js';
import { NEON_HANDLERS, NEON_TOOLS, ToolHandlerExtended } from '../tools.js';
import { logger } from '../utils/logger.js';
import { createNeonClient, getPackageJson } from './api.js';
import { track } from '../analytics/analytics.js';
import { ServerContext } from '../types/context.js';

export const createMcpServer = (context: ServerContext) => {
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

  const neonClient = createNeonClient(context.apiKey);

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
        track({
          userId: context.user.id,
          event: 'tool_call',
          properties: {
            tool: tool.name,
            args,
          },
          context: {
            client: context.client,
            app: context.app,
          },
        });
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
      async (url) => {
        track({
          userId: context.user.id,
          event: 'resource_call',
          properties: { resource: resource.name, url },
          context: { client: context.client, app: context.app },
        });
        return await resource.handler(url);
      },
    );
  });

  server.server.onerror = (error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Server error:', {
      message,
      error,
    });
    track({
      userId: context.user.id,
      event: 'server_error',
      properties: { message, error },
      context: {
        client: context.client,
        app: context.app,
      },
    });
  };

  return server;
};
