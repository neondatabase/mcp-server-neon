#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { NEON_RESOURCES } from '../resources.js';
import {
  NEON_HANDLERS,
  NEON_TOOLS,
  ToolHandlerExtended,
} from '../tools/index.js';
import { logger } from '../utils/logger.js';
import { createNeonClient, getPackageJson } from './api.js';
import { track } from '../analytics/analytics.js';
import { captureException, startSpan } from '@sentry/node';
import { ServerContext } from '../types/context.js';
import { setSentryTags } from '../sentry/utils.js';
import { ToolHandlerExtraParams } from '../tools/types.js';
import { handleToolError } from './errors.js';

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

  // Filter tools based on read-only mode
  const availableTools = context.readOnly
    ? NEON_TOOLS.filter((tool) => tool.readOnlySafe)
    : NEON_TOOLS;

  // Register tools
  availableTools.forEach((tool) => {
    const handler = NEON_HANDLERS[tool.name];
    if (!handler) {
      throw new Error(`Handler for tool ${tool.name} not found`);
    }

    const toolHandler = handler as ToolHandlerExtended<typeof tool.name>;

    server.tool(
      tool.name,
      tool.description,
      { params: tool.inputSchema },
      async (args, extra) => {
        return await startSpan(
          {
            name: 'tool_call',
            attributes: {
              tool_name: tool.name,
            },
          },
          async (span) => {
            const properties = { tool_name: tool.name };
            logger.info('tool call:', properties);
            setSentryTags(context);
            track({
              userId: context.account.id,
              event: 'tool_call',
              properties,
              context: { client: context.client, app: context.app },
            });
            const extraArgs: ToolHandlerExtraParams = {
              ...extra,
              account: context.account,
              readOnly: context.readOnly,
            };
            try {
              return await toolHandler(args, neonClient, extraArgs);
            } catch (error) {
              span.setStatus({
                code: 2,
              });
              return handleToolError(error, properties);
            }
          },
        );
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
        const properties = { resource_name: resource.name };
        logger.info('resource call:', properties);
        setSentryTags(context);
        track({
          userId: context.account.id,
          event: 'resource_call',
          properties,
          context: { client: context.client, app: context.app },
        });
        try {
          return await resource.handler(url);
        } catch (error) {
          captureException(error, {
            extra: properties,
          });
          throw error;
        }
      },
    );
  });

  server.server.onerror = (error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Server error:', {
      message,
      error,
    });
    const contexts = { app: context.app, client: context.client };
    const eventId = captureException(error, {
      user: { id: context.account.id },
      contexts: contexts,
    });
    track({
      userId: context.account.id,
      event: 'server_error',
      properties: { message, error, eventId },
      context: contexts,
    });
  };

  return server;
};
