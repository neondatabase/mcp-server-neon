#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { NEON_RESOURCES } from '../resources';
import { NEON_PROMPTS, getPromptTemplate } from '../prompts';
import { NEON_HANDLERS, NEON_TOOLS, ToolHandlerExtended } from '../tools/index';
import { logger } from '../utils/logger';
import { createNeonClient } from './api';
import { track } from '../analytics/analytics';
import { captureException, startSpan } from '@sentry/node';
import { ServerContext } from '../types/context';
import { setSentryTags } from '../sentry/utils';
import { ToolHandlerExtraParams } from '../tools/types';
import { handleToolError } from './errors';
import { detectClientApplication } from '../utils/client-application';
import pkg from '../../package.json';

export const createMcpServer = (context: ServerContext) => {
  const server = new McpServer(
    {
      name: 'mcp-server-neon',
      version: pkg.version,
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {
          listChanged: true,
        },
      },
    },
  );

  const neonClient = createNeonClient(context.apiKey);

  // Compute client info once at server instantiation
  let clientName = context.userAgent ?? 'unknown';
  let clientApplication = detectClientApplication(clientName);

  // Track server initialization
  const trackServerInit = () => {
    track({
      userId: context.account.id,
      event: 'server_init',
      properties: {
        clientName,
        clientApplication,
        readOnly: String(context.readOnly ?? false),
        branch: 'vercel-migration', // TODO: remove after testing
      },
      context: {
        client: context.client,
        app: context.app,
      },
    });
    logger.info('Server initialized:', {
      clientName,
      clientApplication,
      readOnly: context.readOnly,
    });
  };

  // Always use MCP handshake clientInfo (more reliable than HTTP User-Agent)
  // This ensures we get the real client name even when using mcp-remote,
  // which forwards the original client name (e.g., "Cursor (via mcp-remote 0.1.31)")
  server.server.oninitialized = () => {
    const clientInfo = server.server.getClientVersion();
    // Prefer MCP clientInfo over HTTP User-Agent
    if (clientInfo?.name) {
      clientName = clientInfo.name;
      clientApplication = detectClientApplication(clientName);
    }
    trackServerInit();
  };

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
            const properties = {
              tool_name: tool.name,
              readOnly: String(context.readOnly ?? false),
              clientName,
              branch: 'vercel-migration', // TODO: remove after testing
            };
            logger.info('tool call:', properties);
            setSentryTags(context);
            track({
              userId: context.account.id,
              event: 'tool_call',
              properties,
              context: {
                client: context.client,
                app: context.app,
                clientName,
              },
            });

            const extraArgs: ToolHandlerExtraParams = {
              ...extra,
              account: context.account,
              readOnly: context.readOnly,
              clientApplication,
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
        const properties = { resource_name: resource.name, branch: 'vercel-migration' };
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

  // Register prompts
  NEON_PROMPTS.forEach((prompt) => {
    server.prompt(
      prompt.name,
      prompt.description,
      prompt.argsSchema,
      async (args, extra) => {
        const properties = { prompt_name: prompt.name, clientName, branch: 'vercel-migration' };
        logger.info('prompt call:', properties);
        setSentryTags(context);
        track({
          userId: context.account.id,
          event: 'prompt_call',
          properties,
          context: { client: context.client, app: context.app },
        });
        try {
          const extraArgs: ToolHandlerExtraParams = {
            ...extra,
            account: context.account,
            readOnly: context.readOnly,
            clientApplication,
          };
          const template = await getPromptTemplate(
            prompt.name,
            extraArgs,
            args as Record<string, string>,
          );
          return {
            messages: [
              {
                role: 'user',
                content: {
                  type: 'text',
                  text: template,
                },
              },
            ],
          };
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
      properties: { message, error, eventId, branch: 'vercel-migration' },
      context: contexts,
    });
  };

  return server;
};
