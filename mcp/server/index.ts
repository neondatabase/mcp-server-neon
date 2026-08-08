#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type {
  ServerNotification,
  ServerRequest,
} from '@modelcontextprotocol/sdk/types.js';
import { invokeTool, toolRegistration } from '../tools/registration';
import { logger } from '../utils/logger';
import { generateTraceId } from '../utils/trace';
import { createNeonClient } from './api';
import { track } from '../analytics/analytics';
import { captureException, startSpan } from '@sentry/node';
import { ServerContext } from '../types/context';
import { setSentryTags } from '../sentry/utils';
import { ToolHandlerExtraParams } from '../tools/types';
import { handleToolError } from './errors';
import { detectClientApplication } from '../utils/client-application';
import { DEFAULT_GRANT } from '../utils/grant-context';
import {
  getAvailableTools,
  getAccessControlWarnings,
} from '../tools/grant-filter';
import pkg from '../../package.json';

export const createMcpServer = async (context: ServerContext) => {
  const server = new McpServer(
    {
      name: 'mcp-server-neon',
      version: pkg.version,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  const neonClient = createNeonClient(context.apiKey);

  // Compute client info once at server instantiation
  let clientName = context.userAgent ?? 'unknown';
  let clientApplication = detectClientApplication(clientName);

  const grant = { ...(context.grant ?? DEFAULT_GRANT) };

  // Track server initialization
  const trackServerInit = () => {
    track({
      userId: context.account.id,
      event: 'server_init',
      properties: {
        authMethod: context.authMethod,
        clientName,
        clientApplication,
        readOnly: String(context.readOnly ?? false),
        projectScoped: String(!!grant.projectId),
        customScopes: grant.scopes?.join(',') ?? 'all',
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
      grant,
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

  // Filter tools based on grant context (presets, scopes, project scoping)
  // and read-only mode (readonly query param / x-read-only header / OAuth scopes)
  const readOnly = context.readOnly ?? false;
  const availableTools = getAvailableTools(grant, readOnly);

  // Compute access control warnings once (appended to every tool response)
  const accessControlWarnings = getAccessControlWarnings(grant, readOnly);

  // Register tools. Registration and argument handling come from the shared
  // module so this server is wire-identical to the deployed route.
  availableTools.forEach((tool) => {
    server.registerTool(
      tool.name,
      toolRegistration(tool),
      async (
        args: unknown,
        extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
      ) => {
        const traceId = generateTraceId();
        return await startSpan(
          {
            name: 'tool_call',
            attributes: {
              tool_name: tool.name,
              trace_id: traceId,
            },
          },
          async (span) => {
            const properties = {
              authMethod: context.authMethod,
              tool_name: tool.name,
              readOnly: String(context.readOnly ?? false),
              projectScoped: String(!!grant.projectId),
              clientName,
              clientApplication,
              traceId,
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
              const result = await invokeTool(
                tool.name,
                args,
                grant,
                neonClient,
                extraArgs,
              );

              // Append access control warnings to tool response
              if (accessControlWarnings.length > 0) {
                result.content.push(
                  ...accessControlWarnings.map((w) => ({
                    type: 'text' as const,
                    text: w,
                  })),
                );
              }

              return result;
            } catch (error) {
              span.setStatus({
                code: 2,
              });
              return handleToolError(error, properties, traceId);
            }
          },
        );
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
      properties: { authMethod: context.authMethod, message, error, eventId },
      context: contexts,
    });
  };

  return server;
};
