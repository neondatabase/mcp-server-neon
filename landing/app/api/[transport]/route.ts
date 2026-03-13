// Initialize Sentry (must be first import)
import '../../../mcp-src/sentry/instrument';

import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { normalizeObjectSchema } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import { toJsonSchemaCompat } from '@modelcontextprotocol/sdk/server/zod-json-schema-compat.js';
import { captureException, startSpan } from '@sentry/node';

import {
  getAvailablePrompts,
  getPromptTemplate,
} from '../../../mcp-src/prompts';
import { NEON_HANDLERS } from '../../../mcp-src/tools/index';
import { createNeonClient } from '../../../mcp-src/server/api';
import pkg from '../../../package.json';
import { handleToolError } from '../../../mcp-src/server/errors';
import type { ToolHandlerExtraParams } from '../../../mcp-src/tools/types';
import { detectClientApplication } from '../../../mcp-src/utils/client-application';
import { isReadOnly } from '../../../mcp-src/utils/read-only';
import type { AuthContext } from '../../../mcp-src/types/auth';
import { logger } from '../../../mcp-src/utils/logger';
import { generateTraceId } from '../../../mcp-src/utils/trace';
import { waitUntil } from '@vercel/functions';
import { track, flushAnalytics } from '../../../mcp-src/analytics/analytics';
import { resolveAccountFromAuth } from '../../../mcp-src/server/account';
import { model } from '../../../mcp-src/oauth/model';
import { getApiKeys, type ApiKeyRecord } from '../../../mcp-src/oauth/kv-store';
import { setSentryTags } from '../../../mcp-src/sentry/utils';
import type { ServerContext, AppContext } from '../../../mcp-src/types/context';
import {
  resolveGrantFromHeaders,
  resolveGrantFromToken,
  DEFAULT_GRANT,
  type GrantContext,
} from '../../../mcp-src/utils/grant-context';
import {
  getAvailableTools,
  getAccessControlWarnings,
  injectProjectId,
} from '../../../mcp-src/tools/grant-filter';
import { assert } from '../../../lib/assert';

type AuthenticatedExtra = {
  authInfo?: AuthInfo & {
    extra?: {
      apiKey?: string;
      account?: AuthContext['extra']['account'];
      readOnly?: boolean;
      grant?: GrantContext;
      client?: AuthContext['extra']['client'];
      transport?: AppContext['transport'];
      userAgent?: string;
    };
  };
  signal?: AbortSignal;
  sessionId?: string;
};

type StaticToolContext = {
  grant: GrantContext;
  readOnly: boolean;
};

function createContextualMcpHandler(staticToolContext: StaticToolContext) {
  return createMcpHandler(
    (server: McpServer) => {
      // Request-scoped mutable state (isolated per server instance)
      let clientName = 'unknown';
      let clientApplication = detectClientApplication(clientName);
      let hasTrackedServerInit = false;
      let lastKnownContext: ServerContext | undefined;

      // Default app context for analytics/Sentry (used in onerror fallback)
      const defaultAppContext: AppContext = {
        name: 'mcp-server-neon',
        transport: 'sse',
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
          clientName,
          clientApplication,
          readOnly: String(context.readOnly ?? false),
          projectScoped: String(!!grant.projectId),
          customScopes: grant.scopes?.join(',') ?? 'all',
        };

        track({
          userId: context.account.id,
          event: 'server_init',
          properties,
          context: {
            client: context.client,
            app: context.app,
          },
        });
        waitUntil(flushAnalytics());
        logger.info('Server initialized:', {
          clientName,
          clientApplication,
          readOnly: context.readOnly,
          grant,
        });
      }

      // Helper function to get Neon client and context from auth info
      async function getAuthContext(extra: AuthenticatedExtra) {
        const authInfo = extra.authInfo;
        if (!authInfo?.extra?.apiKey || !authInfo?.extra?.account) {
          throw new Error('Authentication required');
        }

        const apiKey = authInfo.extra.apiKey;
        const account = authInfo.extra.account;
        const readOnly = authInfo.extra.readOnly ?? false;
        const grant = { ...(authInfo.extra.grant ?? DEFAULT_GRANT) };
        const client = authInfo.extra.client;
        const transport = authInfo.extra.transport ?? 'sse';
        const neonClient = createNeonClient(apiKey);

        // Use User-Agent as clientName fallback if MCP handshake hasn't provided it yet
        if (clientName === 'unknown' && authInfo.extra.userAgent) {
          clientName = authInfo.extra.userAgent;
          clientApplication = detectClientApplication(clientName);
        }

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
          account,
          app: dynamicAppContext,
          readOnly,
          client,
          grant,
        };
        lastKnownContext = context;

        return {
          apiKey,
          account,
          readOnly,
          grant,
          neonClient,
          clientApplication,
          clientName,
          client,
          context,
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
          clientName = clientInfo.name;
          clientApplication = detectClientApplication(clientName);
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
        });

        track({
          userId,
          event: 'server_error',
          properties: { message, error, eventId },
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
        const toolHandler = NEON_HANDLERS[tool.name];
        assert(toolHandler, `Handler for tool ${tool.name} not found`);

        server.registerTool(
          tool.name,
          {
            description: tool.description,
            // NOTE: This intentionally stays strongly typed (no cast). If this starts failing
            // after an SDK upgrade, treat it as a schema-type compatibility regression between
            // MCP SDK zod-compat types and our tool schema definitions.
            inputSchema: tool.inputSchema,
          },
          async (args: any, extra: any) => {
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
                const {
                  account,
                  readOnly,
                  grant,
                  neonClient,
                  clientApplication: clientApp,
                  clientName: cName,
                  client,
                  context,
                } = await getAuthContext(extra as AuthenticatedExtra);

                // Track server_init on first authenticated request (after client detection)
                trackServerInit(context);

                const properties = {
                  tool_name: tool.name,
                  readOnly: String(readOnly),
                  projectScoped: String(!!grant.projectId),
                  clientName: cName,
                  traceId,
                };

                logger.info('tool call:', properties);
                setSentryTags(context);

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
                  ...extra,
                  account,
                  readOnly,
                  clientApplication: clientApp,
                };

                try {
                  // Inject projectId if in project-scoped mode
                  const effectiveArgs = injectProjectId(
                    (args ?? {}) as Record<string, unknown>,
                    grant,
                  );

                  // Wrap args in { params } structure expected by handlers
                  const result = await (toolHandler as any)(
                    { params: effectiveArgs },
                    neonClient,
                    extraArgs,
                  );
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
                  if (accessControlWarnings.length > 0 && result.content) {
                    result.content.push(
                      ...accessControlWarnings.map((w: string) => ({
                        type: 'text' as const,
                        text: w,
                      })),
                    );
                  }

                  return result;
                } catch (error) {
                  span.setStatus({ code: 2 });
                  const errorResult = handleToolError(
                    error,
                    properties,
                    traceId,
                  );
                  logger.warn('tool error response:', {
                    ...properties,
                    isError: true,
                    contentLength: errorResult.content?.length,
                    firstContentType: errorResult.content?.[0]?.type,
                  });
                  return errorResult;
                }
              },
            );
          },
        );
      });

      // Register prompts for this specific auth context.
      const composedPrompts = getAvailablePrompts(staticToolContext.grant);
      composedPrompts.forEach((prompt) => {
        server.registerPrompt(
          prompt.name,
          {
            description: prompt.description,
            // Same compatibility guardrail as tool registration above.
            argsSchema: prompt.argsSchema,
          },
          async (args: any, extra: any) => {
            const {
              account,
              readOnly,
              clientApplication: clientApp,
              clientName: cName,
              client,
              context,
            } = await getAuthContext(extra as AuthenticatedExtra);

            // Track server_init on first authenticated request
            trackServerInit(context);

            const traceId = generateTraceId();
            const properties = {
              prompt_name: prompt.name,
              clientName: cName,
              traceId,
            };
            logger.info('prompt call:', properties);
            setSentryTags(context);

            track({
              userId: account.id,
              event: 'prompt_call',
              properties,
              context: { client, app: context.app },
            });
            waitUntil(flushAnalytics());

            try {
              const extraArgs: ToolHandlerExtraParams = {
                ...extra,
                account,
                readOnly,
                clientApplication: clientApp,
              };
              const template = await getPromptTemplate(
                prompt.name,
                extraArgs,
                args,
              );
              return {
                messages: [
                  {
                    role: 'user' as const,
                    content: {
                      type: 'text' as const,
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

      // Override tools/list to return the same context-scoped surface that was
      // registered for this handler instance.
      server.server.setRequestHandler(ListToolsRequestSchema, async () => {
        // Avoid relying on MCP SDK private fields (`_registeredTools`), which can
        // change across SDK versions and break request handling. Build the list from
        // our canonical tool definitions and convert schemas explicitly.
        const tools = composedTools.map((tool) => {
          const normalizedSchema = normalizeObjectSchema(tool.inputSchema);
          const inputSchema = normalizedSchema
            ? toJsonSchemaCompat(normalizedSchema, {
                strictUnions: true,
                pipeStrategy: 'input',
              })
            : { type: 'object' as const };

          return {
            name: tool.name,
            title: tool.annotations?.title,
            description: tool.description,
            inputSchema,
            annotations: tool.annotations,
          };
        });

        return { tools };
      });
    },
    {
      serverInfo: {
        name: 'mcp-server-neon',
        version: pkg.version,
      },
      capabilities: {
        tools: {},
        resources: {},
        prompts: {
          listChanged: true,
        },
      },
    },
    {
      redisUrl: process.env.KV_URL || process.env.REDIS_URL,
      basePath: '/api',
      maxDuration: 800, // Fluid Compute - up to 800s for SSE connections
      verboseLogs: process.env.NODE_ENV !== 'production',
      onEvent: (event) => {
        switch (event.type) {
          case 'SESSION_STARTED':
            logger.info('MCP session started', {
              sessionId: event.sessionId,
              transport: event.transport,
              clientInfo: event.clientInfo,
            });
            break;

          case 'SESSION_ENDED':
            logger.info('MCP session ended', {
              sessionId: event.sessionId,
              transport: event.transport,
            });
            break;

          case 'REQUEST_COMPLETED':
            if (event.status === 'error') {
              logger.warn('MCP request failed', {
                sessionId: event.sessionId,
                requestId: event.requestId,
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
                sessionId: event.sessionId,
                source: event.source,
                severity: event.severity,
                context: event.context,
              });
            } else if (event.severity === 'fatal') {
              logger.error('MCP fatal error', {
                sessionId: event.sessionId,
                error: event.error,
                source: event.source,
                context: event.context,
              });
              captureException(
                event.error instanceof Error
                  ? event.error
                  : new Error(String(event.error)),
              );
            }
            break;
        }
      },
    },
  );
}

// Cache TTL for API key verification (5 minutes)
// Balances security (revoked keys stop working soon) with performance (reduce API calls)
const API_KEY_CACHE_TTL_MS = 5 * 60 * 1000;

// Helper: Fetch and cache API key details
const fetchAccountDetails = async (
  accessToken: string,
): Promise<ApiKeyRecord | null> => {
  // 1. Check cache first
  try {
    const cached = await getApiKeys().get(accessToken);
    if (cached) {
      logger.info('API key cache hit', { accountId: cached.account.id });
      return cached;
    }
  } catch (error) {
    logger.warn('API key cache read failed', { error });
  }

  // 2. Cache miss - verify with Neon API
  try {
    const neonClient = createNeonClient(accessToken);
    const { data: auth } = await neonClient.getAuthDetails();

    // Use shared account resolution with identify on cache miss
    const account = await resolveAccountFromAuth(auth, neonClient, {
      context: { authMethod: auth.auth_method },
    });

    const record: ApiKeyRecord = {
      apiKey: accessToken,
      authMethod: auth.auth_method,
      account,
    };

    // 4. Save to cache with TTL (non-blocking)
    waitUntil(
      getApiKeys()
        .set(accessToken, record, API_KEY_CACHE_TTL_MS)
        .catch((err) => {
          logger.warn('API key cache write failed', { err });
        }),
    );

    logger.info('API key cache miss, verified and cached', {
      accountId: account.id,
    });
    return record;
  } catch (error) {
    const axiosError = error as {
      response?: { status?: number; data?: unknown };
      message?: string;
    };
    logger.error('API key verification failed', {
      message: axiosError.message,
      status: axiosError.response?.status,
      data: axiosError.response?.data,
    });
    return null;
  }
};

// Token verification function with two paths (OAuth tokens + API keys)
const verifyToken = async (
  req: Request,
  bearerToken?: string,
): Promise<AuthInfo | undefined> => {
  const userAgent = req.headers.get('user-agent') || undefined;
  const neonReadOnlyHeader = req.headers.get('x-neon-read-only');
  const readOnlyHeader = req.headers.get('x-read-only');

  logger.info('verifyToken called', {
    hasBearerToken: !!bearerToken,
    bearerTokenLength: bearerToken?.length ?? 0,
    tokenPrefix: bearerToken?.substring(0, 10) ?? 'none',
    userAgent,
  });

  if (!bearerToken) {
    return undefined;
  }

  // Detect transport from URL pathname
  const url = new URL(req.url);
  const transport: AppContext['transport'] = url.pathname.includes('/mcp')
    ? 'stream'
    : 'sse';

  // Parse grant context from X-Neon-* headers (used only for API key path;
  // OAuth tokens use their stored grant from the consent flow instead)
  const grant = resolveGrantFromHeaders(req.headers);

  // ============================================
  // PATH 1: Check OAuth tokens table FIRST
  // (For users who authenticated via OAuth flow)
  // ============================================
  try {
    const token = await model.getAccessToken(bearerToken);
    if (token) {
      // Expiration is checked by withMcpAuth using expiresAt field
      // which returns proper RFC-compliant 401 with WWW-Authenticate header

      logger.info('OAuth token found', { clientId: token.client.id });

      // OAuth tokens always use the stored grant from the consent flow.
      // Headers are fully ignored — grant is immutable until re-authentication.
      const effectiveGrant = resolveGrantFromToken(
        token as { grant?: GrantContext },
      );

      // Read-only is determined only by stored OAuth scope (no headers)
      const readOnly = isReadOnly({
        scope: token.scope,
      });

      // Return auth from stored token (0 API calls!)
      return {
        token: token.accessToken,
        scopes: Array.isArray(token.scope)
          ? token.scope
          : (token.scope?.split(' ') ?? ['read', 'write']),
        clientId: token.client.id,
        expiresAt: token.expires_at
          ? Math.floor(token.expires_at / 1000)
          : undefined,
        extra: {
          account: {
            id: token.user.id,
            name: token.user.name,
            email: token.user.email,
            isOrg: token.user.isOrg ?? false,
          },
          apiKey: bearerToken,
          readOnly,
          grant: effectiveGrant,
          client: {
            id: token.client.id,
            name: token.client.client_name,
          },
          transport,
          userAgent,
        },
      };
    }
  } catch (error) {
    logger.warn('OAuth token lookup failed, trying API key path', { error });
  }

  // ============================================
  // PATH 2: Not an OAuth token - try API key
  // (For direct API key usage)
  // ============================================
  logger.info('Trying API key verification path', {
    tokenPrefix: bearerToken.substring(0, 10),
  });

  const apiKeyRecord = await fetchAccountDetails(bearerToken);
  if (!apiKeyRecord) {
    return undefined;
  }

  // Determine read-only mode from headers.
  const readOnly = isReadOnly({
    neonHeaderValue: neonReadOnlyHeader,
    headerValue: readOnlyHeader,
  });

  return {
    token: bearerToken,
    scopes: ['*'], // API keys get all scopes
    clientId: 'api-key', // Literal string
    extra: {
      account: apiKeyRecord.account,
      apiKey: bearerToken,
      readOnly,
      grant,
      transport,
      userAgent,
    },
  };
};

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
      ? {
          projectId: grantFromAuth.projectId ?? null,
          scopes: grantFromAuth.scopes ?? null,
        }
      : DEFAULT_GRANT;

  return {
    grant,
    readOnly: authExtra?.readOnly === true,
  };
}

// Wrap with authentication. After auth is resolved, route to a context-scoped
// MCP handler whose registered tools match the token grant/read-only context.
const authHandler = withMcpAuth(
  (req) => createContextualMcpHandler(getStaticToolContext(req))(req),
  verifyToken,
  {
    required: true,
    resourceMetadataPath: '/.well-known/oauth-protected-resource',
  },
);

// Normalize legacy paths (/mcp, /sse) to canonical /api/* paths
// for mcp-handler's exact pathname matching.
//
// Next.js rewrites preserve the original client URL in request.url,
// but mcp-handler expects /api/mcp or /api/sse. Without this normalization,
// requests to /mcp would get 404 after OAuth (before auth, withMcpAuth
// returns 401 before pathname matching happens).
const handleRequest = (req: Request) => {
  const url = new URL(req.url);

  if (url.pathname === '/mcp') {
    url.pathname = '/api/mcp';
  } else if (url.pathname === '/sse') {
    url.pathname = '/api/sse';
  }

  const normalizedReq = new Request(url.toString(), {
    method: req.method,
    headers: req.headers,
    body: req.body,
    // @ts-expect-error duplex is required for streaming bodies
    duplex: 'half',
  });

  return authHandler(normalizedReq);
};

export { handleRequest as GET, handleRequest as POST, handleRequest as DELETE };
