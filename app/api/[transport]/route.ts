import {
  CLIENT_INFO_META_KEY,
  fromJsonSchema,
  isInitializeRequest,
  McpServer,
} from '@modelcontextprotocol/server';
import type { ServerContext as McpServerContext } from '@modelcontextprotocol/server';
import { createMcpHandler } from 'mcp-handler';
import { captureException } from '@sentry/node';

import { NEON_HANDLERS } from '../../../mcp/tools/index';
import { createNeonClient } from '../../../mcp/server/api';
import pkg from '../../../package.json';
import { renderToolCall, runToolCallback } from '../../../mcp/server/tool-call';
import { createSdkErrorReporter } from '../../../mcp/server/sdk-errors';
import type { ToolHandlerExtraParams } from '../../../mcp/tools/types';
import { identifyClient } from '../../../mcp/utils/client-application';
import { logger } from '../../../mcp/utils/logger';
import { withSdkCompatRiskLog } from '../../../mcp/utils/sdk-compat-risks';
import { generateTraceId } from '../../../mcp/utils/trace';
import { waitUntil } from '@vercel/functions';
import { Effect, Layer } from 'effect';
import { track, flushAnalytics } from '../../../mcp/analytics/analytics';
import { agentSentryTags, setSentryTags } from '../../../mcp/sentry/utils';
import { tagRequestSession } from '../../../mcp/sentry/session';
import {
  toolSpanClientAttributes,
  withToolSpan,
} from '../../../mcp/sentry/tool-span';
import {
  MCP_SESSION_ID_HEADER,
  mintSessionId,
  readSessionId,
} from '../../../mcp/utils/mcp-session';
import type { ServerContext, AppContext } from '../../../mcp/types/context';
import {
  normalizeStoredGrant,
  DEFAULT_GRANT,
  grantAnalyticsProperties,
  type GrantContext,
} from '../../../mcp/utils/grant-context';
import {
  getAvailableTools,
  getAccessControlWarnings,
  formatAccessControlInstructions,
  isDocsOnlyTool,
} from '../../../mcp/tools/grant-filter';
import {
  invokeTool,
  NO_LIST_CHANGED,
  toolRegistration,
} from '../../../mcp/tools/registration';
import { toListedInputSchema } from '../../../mcp/tools/listed-schema';
import { NEON_TOOLS } from '../../../mcp/tools/definitions';
import type { NeonTool } from '../../../mcp/tools/tool-definition';
import { assert } from '../../../lib/assert';
import { SERVER_INFO } from '../../../lib/server-metadata';
import { webHandlerFor } from '../../../lib/http/app';
import { McpHandlers, McpRoutes } from '../../../lib/http/routes/mcp';
import type { AuthenticatedAuthInfo } from '../../../mcp/transport/oauth-token';

function v2ToolConfig(tool: NeonTool) {
  const registration = toolRegistration(tool);
  return {
    ...registration,
    inputSchema: fromJsonSchema(toListedInputSchema(registration.inputSchema)),
  };
}

// A stateless client cancels by closing the HTTP request; an MCP
// `notifications/cancelled` aborts `mcpReq.signal`. Either stops the upstream
// Neon API call.
function toolCallSignal(ctx: McpServerContext): AbortSignal {
  const httpSignal = ctx.http?.req?.signal;
  return httpSignal
    ? AbortSignal.any([ctx.mcpReq.signal, httpSignal])
    : ctx.mcpReq.signal;
}

function getRequestClientName(ctx: McpServerContext): string | undefined {
  const envelope: unknown = ctx.mcpReq.envelope;
  if (!envelope || typeof envelope !== 'object') return undefined;
  if (!(CLIENT_INFO_META_KEY in envelope)) return undefined;

  const clientInfo = envelope[CLIENT_INFO_META_KEY];
  if (!clientInfo || typeof clientInfo !== 'object') return undefined;
  if (!('name' in clientInfo) || typeof clientInfo.name !== 'string') {
    return undefined;
  }
  return clientInfo.name;
}

type StaticToolContext = {
  grant: GrantContext;
  readOnly: boolean;
};

function createContextualMcpHandler(staticToolContext: StaticToolContext) {
  let { clientName, clientApplication } = identifyClient();
  const sdkErrors = createSdkErrorReporter(() =>
    agentSentryTags({ clientName, clientApplication }),
  );

  const handler = createMcpHandler(
    (server: McpServer) => {
      // Request-scoped mutable state (isolated per server instance)
      let hasTrackedServerInit = false;
      let lastKnownContext: ServerContext | undefined;

      // Default app context for analytics/Sentry (used in onerror fallback)
      const defaultAppContext: AppContext = {
        name: 'mcp-server-neon',
        transport: 'stream',
        environment: (process.env.NODE_ENV ??
          'production') as AppContext['environment'],
        version: pkg.version,
      };

      // Track server initialization (called after client detection with proper context)
      function trackServerInit(context: ServerContext) {
        if (hasTrackedServerInit) return;
        hasTrackedServerInit = true;

        const grant = context.grant ?? DEFAULT_GRANT;
        const properties = {
          authMethod: context.authMethod,
          clientName,
          clientApplication,
          readOnly: String(context.readOnly ?? false),
          ...grantAnalyticsProperties(grant),
        };

        track({
          userId: context.account.id,
          event: 'server_init',
          properties,
          context: {
            client: context.client,
            app: context.app,
            clientName,
          },
        });
        logger.info('Server initialized:', {
          clientName,
          clientApplication,
          readOnly: context.readOnly,
          grant,
        });
      }

      // Helper function to get Neon client and context from auth info
      async function getAuthContext(ctx: McpServerContext) {
        const authInfo = ctx.http?.authInfo as
          | AuthenticatedAuthInfo
          | undefined;
        if (
          !authInfo?.extra?.apiKey ||
          !authInfo?.extra?.authMethod ||
          !authInfo?.extra?.account
        ) {
          throw new Error('Authentication required');
        }

        const apiKey = authInfo.extra.apiKey;
        const authMethod = authInfo.extra.authMethod;
        const account = authInfo.extra.account;
        const readOnly = authInfo.extra.readOnly ?? false;
        const grant = { ...(authInfo.extra.grant ?? DEFAULT_GRANT) };
        const client = authInfo.extra.client;
        const transport = authInfo.extra.transport ?? 'stream';
        const neonClient = createNeonClient(apiKey);

        const requestClientName = getRequestClientName(ctx);
        const primary =
          requestClientName ??
          (clientName !== 'unknown' ? clientName : authInfo.extra.userAgent);
        ({ clientName, clientApplication } = identifyClient(
          primary,
          authInfo.extra.client?.name,
        ));

        // Create dynamic appContext with actual transport
        const dynamicAppContext: AppContext = {
          name: 'mcp-server-neon',
          transport,
          environment: (process.env.NODE_ENV ??
            'production') as AppContext['environment'],
          version: pkg.version,
        };

        // Build and store context for potential use in onerror
        const context: ServerContext = {
          apiKey,
          authMethod,
          account,
          app: dynamicAppContext,
          readOnly,
          client,
          grant,
        };
        lastKnownContext = context;

        return {
          apiKey,
          authMethod,
          account,
          readOnly,
          grant,
          neonClient,
          clientApplication,
          clientName,
          client,
          context,
          userAgent: authInfo.extra.userAgent,
        };
      }

      // Set up lifecycle hooks for client detection and error handling
      server.server.oninitialized = () => {
        const clientInfo = server.server.getClientVersion();
        logger.info('MCP oninitialized:', {
          clientInfo,
          hasName: !!clientInfo?.name,
          currentClientName: clientName,
        });
        // Prefer MCP clientInfo over HTTP User-Agent (more reliable)
        // This ensures we get the real client name even when using mcp-remote,
        // which forwards the original client name (e.g., "Cursor (via mcp-remote 0.1.31)")
        if (clientInfo?.name) {
          ({ clientName, clientApplication } = identifyClient(
            clientInfo.name,
            lastKnownContext?.client?.name,
          ));
        }
        // Note: server_init is tracked on first authenticated request
        // because we don't have account info here yet
      };

      server.server.onerror = (error: unknown) => {
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        logger.error('Server error:', {
          message,
          error,
        });

        // Use last known context if available, otherwise use defaults
        const userId = lastKnownContext?.account?.id ?? 'unknown';
        const contexts = {
          app: lastKnownContext?.app ?? defaultAppContext,
          client: lastKnownContext?.client,
        };

        const eventId = captureException(error, {
          user: lastKnownContext?.account
            ? { id: lastKnownContext.account.id }
            : undefined,
          contexts,
          tags: agentSentryTags({ clientName, clientApplication }),
        });

        track({
          userId,
          event: 'server_error',
          properties: {
            authMethod: lastKnownContext?.authMethod ?? 'unknown',
            message,
            error,
            eventId,
          },
          context: contexts,
        });
        waitUntil(flushAnalytics());
      };

      const composedTools = getAvailableTools(
        staticToolContext.grant,
        staticToolContext.readOnly,
      );

      // Register tools for this specific auth context.
      composedTools.forEach((tool) => {
        assert(
          NEON_HANDLERS[tool.name],
          `Handler for tool ${tool.name} not found`,
        );

        server.registerTool(
          tool.name,
          v2ToolConfig(tool),
          async (args: unknown, ctx: McpServerContext) => {
            const traceId = generateTraceId();
            return runToolCallback(
              Effect.gen(function* () {
                const {
                  account,
                  authMethod,
                  readOnly,
                  grant,
                  neonClient,
                  clientApplication: clientApp,
                  clientName: cName,
                  client,
                  context,
                  apiKey,
                  userAgent,
                } = yield* Effect.promise(async () => getAuthContext(ctx));
                const agent = {
                  clientName: cName,
                  clientApplication: clientApp,
                };

                // Track server_init on first authenticated request (after client detection)
                trackServerInit(context);

                const properties = {
                  authMethod,
                  toolName: tool.name,
                  tool_name: tool.name,
                  readOnly: String(readOnly),
                  ...grantAnalyticsProperties(grant),
                  clientName: cName,
                  clientApplication: clientApp,
                  traceId,
                };

                logger.info('tool call:', properties);
                setSentryTags(context, agent);
                yield* Effect.annotateCurrentSpan(
                  toolSpanClientAttributes(agent),
                );

                track({
                  userId: account.id,
                  event: 'tool_call',
                  properties,
                  context: {
                    client,
                    app: context.app,
                    clientName: cName,
                  },
                });
                waitUntil(flushAnalytics());

                const extraArgs: ToolHandlerExtraParams = {
                  account,
                  readOnly,
                  clientApplication: clientApp,
                  apiKey,
                  userAgent,
                };

                const outcome = yield* renderToolCall(
                  invokeTool(tool.name, args, grant, neonClient, extraArgs),
                  { properties, traceId, agent },
                );
                const { result } = outcome;
                if (result.isError) {
                  logger.warn('tool error response:', {
                    ...properties,
                    isError: true,
                    contentLength: result.content?.length,
                    firstContentType: result.content?.[0]?.type,
                  });
                }

                // Append access control warnings to tool response
                const accessControlWarnings = getAccessControlWarnings(
                  grant,
                  readOnly,
                );
                if (
                  outcome.kind === 'success' &&
                  accessControlWarnings.length > 0 &&
                  result.content
                ) {
                  result.content.push(
                    ...accessControlWarnings.map((w: string) => ({
                      type: 'text' as const,
                      text: w,
                    })),
                  );
                }

                return outcome;
              }).pipe(withToolSpan({ toolName: tool.name, ctx, traceId })),
              toolCallSignal(ctx),
            );
          },
        );
      });
    },
    {
      serverInfo: SERVER_INFO,
      capabilities: {
        tools: NO_LIST_CHANGED,
        resources: NO_LIST_CHANGED,
      },
      instructions: formatAccessControlInstructions(
        staticToolContext.grant,
        staticToolContext.readOnly,
      ),
      verboseLogs: process.env.NODE_ENV !== 'production',
      onEvent: (event) => {
        switch (event.type) {
          case 'REQUEST_COMPLETED':
            if (event.status === 'error') {
              logger.warn('MCP request failed', {
                method: event.method,
                duration: event.duration,
              });
            }
            break;

          case 'ERROR':
            const isConnectionError =
              typeof event.error === 'string'
                ? event.error.includes('No connection established')
                : event.error?.message?.includes('No connection established');

            if (isConnectionError) {
              logger.warn('MCP connection lost', {
                source: event.source,
                severity: event.severity,
                context: event.context,
              });
            } else {
              sdkErrors.onError(event);
            }
            break;
        }
      },
    },
  );

  return (req: Request) => sdkErrors.settleAfter(handler(req));
}

// The docs-only handler bypasses OAuth entirely. It only registers the
// `docs` category tools plus send_feedback and list_incidents. None of them
// touch the Neon API: they call neon.com, the feedback service, or
// neonstatus.com, and run with no credential. We deliberately avoid going
// through `getAvailableTools` / `grant-filter` here so the "always available"
// search/fetch tools (which require Neon API auth) are not surfaced
// anonymously.
const DOCS_ONLY_TOOLS = NEON_TOOLS.filter(isDocsOnlyTool);

const ANONYMOUS_DOCS_USER_ID = 'anonymous-docs';

const docsOnlyAppContext: AppContext = {
  name: 'mcp-server-neon',
  transport: 'stream',
  environment: (process.env.NODE_ENV ??
    'production') as AppContext['environment'],
  version: pkg.version,
};

function createDocsOnlyMcpHandler(userAgent: string | undefined) {
  const docsAgent = {
    clientName: 'anonymous-docs',
    clientApplication: identifyClient(userAgent).clientApplication,
  };

  const sdkErrors = createSdkErrorReporter(() => agentSentryTags(docsAgent));

  const handler = createMcpHandler(
    (server: McpServer) => {
      async function runDocsTool(
        tool: NeonTool,
        args: unknown,
        ctx: McpServerContext,
      ) {
        const toolName = tool.name;
        const traceId = generateTraceId();
        return runToolCallback(
          Effect.gen(function* () {
            yield* Effect.annotateCurrentSpan({
              ...toolSpanClientAttributes(docsAgent),
              docs_only: true,
            });
            const properties = {
              authMethod: 'anonymous',
              toolName: toolName,
              tool_name: toolName,
              readOnly: 'true',
              projectScoped: 'false',
              customScopes: 'docs',
              rolePinned: 'false',
              clientName: docsAgent.clientName,
              clientApplication: docsAgent.clientApplication,
              traceId,
              docsOnly: 'true',
            };

            logger.info('tool call (docs-only):', properties);

            track({
              anonymousId: ANONYMOUS_DOCS_USER_ID,
              event: 'tool_call',
              properties,
              context: { app: docsOnlyAppContext },
            });
            waitUntil(flushAnalytics());

            const handler = NEON_HANDLERS[toolName];
            assert(handler, `Handler for tool ${toolName} not found`);
            assert(
              typeof args === 'object' && args !== null,
              `${toolName} arguments were not validated`,
            );
            const outcome = yield* renderToolCall(
              handler({ params: { ...args } }, undefined, {
                readOnly: true,
                clientApplication: docsAgent.clientApplication,
                userAgent,
              }),
              { properties, traceId, agent: docsAgent },
            );
            if (outcome.kind !== 'success') {
              logger.warn('tool error response (docs-only):', {
                ...properties,
                isError: true,
                contentLength: outcome.result.content?.length,
                firstContentType: outcome.result.content?.[0]?.type,
              });
            }
            return outcome;
          }).pipe(withToolSpan({ toolName, ctx, traceId })),
          toolCallSignal(ctx),
        );
      }

      for (const tool of DOCS_ONLY_TOOLS) {
        server.registerTool(
          tool.name,
          v2ToolConfig(tool),
          async (args: unknown, ctx: McpServerContext) =>
            runDocsTool(tool, args, ctx),
        );
      }
    },
    {
      serverInfo: SERVER_INFO,
      capabilities: {
        tools: NO_LIST_CHANGED,
      },
      verboseLogs: process.env.NODE_ENV !== 'production',
      onEvent: (event) => {
        switch (event.type) {
          case 'REQUEST_COMPLETED':
            if (event.status === 'error') {
              logger.warn('MCP docs-only request failed', {
                method: event.method,
                duration: event.duration,
              });
            }
            break;
          case 'ERROR':
            sdkErrors.onError(event);
            break;
        }
      },
    },
  );

  return (req: Request) => sdkErrors.settleAfter(handler(req));
}

function getStaticToolContext(req: Request): StaticToolContext {
  const authInfo = req.auth;
  const authExtra = authInfo?.extra;
  const grantFromAuth = authExtra?.grant as Partial<GrantContext> | undefined;
  // Backward compatibility: older tokens may not have persisted grant context.
  // Remove this DEFAULT_GRANT fallback once all active tokens are guaranteed to include grant.
  // Then replace with assert(grantFromAuth, 'grantFromAuth is required');
  const grant: GrantContext =
    grantFromAuth &&
    typeof grantFromAuth === 'object' &&
    'projectId' in grantFromAuth &&
    'scopes' in grantFromAuth
      ? normalizeStoredGrant(grantFromAuth)
      : DEFAULT_GRANT;

  return {
    grant,
    readOnly: authExtra?.readOnly === true,
  };
}

function parseJsonBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // Not JSON: the MCP SDK answers it with a parse error.
    return undefined;
  }
}

type McpSession = {
  id?: string;
  /** Set when this response must hand the client its new session id. */
  minted?: string;
};

/**
 * The session id the client sent, or a new one when this is a 2025-era
 * `initialize` without one. Only a request without an id has its body read,
 * from a clone, to recognise `initialize`.
 */
async function resolveMcpSession(req: Request): Promise<McpSession> {
  const sent = readSessionId(req.headers);
  if (sent || req.method !== 'POST') return { id: sent };
  if (!isInitializeRequest(parseJsonBody(await req.clone().text()))) return {};
  const id = mintSessionId();
  return { id, minted: id };
}

/**
 * Tags the request's telemetry with its session and hands a new session id
 * back on the `initialize` response. On the authenticated route this runs
 * after the token check, so a rejected request's body is never read here.
 */
async function withMcpSession(
  req: Request,
  serve: (req: Request) => Promise<Response>,
): Promise<Response> {
  const session = await resolveMcpSession(req);
  if (session.id) tagRequestSession(session.id);
  const response = await serve(req);
  if (!session.minted || !response.ok) return response;
  const headers = new Headers(response.headers);
  headers.set(MCP_SESSION_ID_HEADER, session.minted);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// The MCP handlers stay here; the Effect route in lib/http/routes/mcp.ts
// authenticates the request and hands it to one of them.
const handlers = Layer.succeed(McpHandlers)({
  serveDocsOnly: async (req) =>
    withSdkCompatRiskLog(req, async () =>
      withMcpSession(
        req,
        createDocsOnlyMcpHandler(req.headers.get('user-agent') ?? undefined),
      ),
    ),
  serveAuthenticated: async (req) =>
    withSdkCompatRiskLog(req, async () =>
      withMcpSession(
        req,
        createContextualMcpHandler(getStaticToolContext(req)),
      ),
    ),
});

const transport = webHandlerFor(Layer.merge(McpRoutes, handlers));

const handleRequest = async (request: Request): Promise<Response> =>
  transport.handler(request);

// HEAD is exported explicitly. Next.js would otherwise route it to the GET export,
// which is the same function, but relying on that implicit mapping hides the fact
// that HEAD needs its own branch to avoid the mcp-handler timeout.
export {
  handleRequest as GET,
  handleRequest as POST,
  handleRequest as DELETE,
  handleRequest as HEAD,
};
