#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NEON_RESOURCES } from "../resources";
import { NEON_PROMPTS, getPromptTemplate } from "../prompts";
import { NEON_HANDLERS, ToolHandlerExtended } from "../tools/index";
import { logger } from "../utils/logger";
import { generateTraceId } from "../utils/trace";
import { createNeonClient } from "./api";
import { track } from "../analytics/analytics";
import { captureException, startSpan } from "@sentry/node";
import { ServerContext } from "../types/context";
import { setSentryTags } from "../sentry/utils";
import { ToolHandlerExtraParams } from "../tools/types";
import { handleToolError } from "./errors";
import { detectClientApplication } from "../utils/client-application";
import { DEFAULT_GRANT } from "../utils/grant-context";
import {
  getAvailableTools,
  getAccessControlWarnings,
  injectProjectId,
} from "../tools/grant-filter";
import {
  enforceProtectedBranches,
  GrantViolationError,
} from "../tools/grant-enforcement";
import pkg from "../../package.json";

export const createMcpServer = async (context: ServerContext) => {
  const server = new McpServer(
    {
      name: "mcp-server-neon",
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
  let clientName = context.userAgent ?? "unknown";
  let clientApplication = detectClientApplication(clientName);

  const grant = { ...(context.grant ?? DEFAULT_GRANT) };

  // Validate project ID against the Neon API if one was provided
  if (grant.projectId) {
    try {
      await neonClient.getProject(grant.projectId);
    } catch {
      logger.warn(
        `Project ID "${grant.projectId}" could not be verified — falling back to unscoped access.`,
      );
      grant.projectId = null;
    }
  }

  // Track server initialization
  const trackServerInit = () => {
    track({
      userId: context.account.id,
      event: "server_init",
      properties: {
        clientName,
        clientApplication,
        readOnly: String(context.readOnly ?? false),
        preset: grant.preset,
        projectScoped: String(!!grant.projectId),
        protectedBranches: grant.protectedBranches?.join(",") ?? "none",
        customScopes: grant.scopes?.join(",") ?? "all",
      },
      context: {
        client: context.client,
        app: context.app,
      },
    });
    logger.info("Server initialized:", {
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
  // and read-only mode (for backwards compatibility with X-Neon-Read-Only header / OAuth scopes)
  const readOnly = context.readOnly ?? false;
  const availableTools = getAvailableTools(grant, readOnly);

  // Compute access control warnings once (appended to every tool response)
  const accessControlWarnings = getAccessControlWarnings(grant, readOnly);

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
      tool.annotations,
      async (args, extra) => {
        const traceId = generateTraceId();
        return await startSpan(
          {
            name: "tool_call",
            attributes: {
              tool_name: tool.name,
              trace_id: traceId,
            },
          },
          async (span) => {
            const properties = {
              tool_name: tool.name,
              readOnly: String(context.readOnly ?? false),
              preset: grant.preset,
              projectScoped: String(!!grant.projectId),
              clientName,
              traceId,
            };
            logger.info("tool call:", properties);
            setSentryTags(context);
            track({
              userId: context.account.id,
              event: "tool_call",
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
              // Inject projectId if in project-scoped mode
              const effectiveArgs = injectProjectId(
                args as Record<string, unknown>,
                grant,
              );

              // Enforce protected branch restrictions
              enforceProtectedBranches(grant, tool.name, effectiveArgs);

              const result = await toolHandler(
                effectiveArgs as typeof args,
                neonClient,
                extraArgs,
              );

              // Append access control warnings to tool response
              if (accessControlWarnings.length > 0) {
                result.content.push(
                  ...accessControlWarnings.map((w) => ({
                    type: "text" as const,
                    text: w,
                  })),
                );
              }

              return result;
            } catch (error) {
              if (error instanceof GrantViolationError) {
                return {
                  content: [
                    {
                      type: "text" as const,
                      text: error.message,
                    },
                  ],
                  isError: true,
                };
              }
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
        const traceId = generateTraceId();
        const properties = { resource_name: resource.name, traceId };
        logger.info("resource call:", properties);
        setSentryTags(context);
        track({
          userId: context.account.id,
          event: "resource_call",
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
        const traceId = generateTraceId();
        const properties = { prompt_name: prompt.name, clientName, traceId };
        logger.info("prompt call:", properties);
        setSentryTags(context);
        track({
          userId: context.account.id,
          event: "prompt_call",
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
                role: "user",
                content: {
                  type: "text",
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
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Server error:", {
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
      event: "server_error",
      properties: { message, error, eventId },
      context: contexts,
    });
  };

  return server;
};
