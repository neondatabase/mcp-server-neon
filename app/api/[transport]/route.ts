// Initialize Sentry (must be first import)
import '../../../mcp/sentry/instrument';
import {
  localhostAllowedOrigins,
  McpServer,
  originValidationResponse,
} from '@modelcontextprotocol/server';
import type {
  AuthInfo,
  ServerContext as McpServerContext,
} from '@modelcontextprotocol/server';
import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import { captureException, startSpan } from '@sentry/node';
import { NeonApiError } from '@neon/sdk';

import { NEON_HANDLERS } from '../../../mcp/tools/index';
import {
  getDocResource,
  listDocsResources,
} from '../../../mcp/tools/handlers/docs';
import { createNeonClient } from '../../../mcp/server/api';
import pkg from '../../../package.json';
import { handleToolError } from '../../../mcp/server/errors';
import type { ToolHandlerExtraParams } from '../../../mcp/tools/types';
import { detectClientApplication } from '../../../mcp/utils/client-application';
import { isReadOnly } from '../../../mcp/utils/read-only';
import type { AuthContext } from '../../../mcp/types/auth';
import { logger } from '../../../mcp/utils/logger';
import { generateTraceId } from '../../../mcp/utils/trace';
import { waitUntil } from '@vercel/functions';
import { track, flushAnalytics } from '../../../mcp/analytics/analytics';
import { resolveAccountFromAuth } from '../../../mcp/server/account';
import { model } from '../../../mcp/oauth/model';
import { getApiKeys, type ApiKeyRecord } from '../../../mcp/oauth/kv-store';
import { setSentryTags } from '../../../mcp/sentry/utils';
import type { ServerContext, AppContext } from '../../../mcp/types/context';
import {
  isDocsOnlyRequest,
  resolveGrantFromSearchParams,
  resolveGrantFromToken,
  DEFAULT_GRANT,
  type GrantContext,
} from '../../../mcp/utils/grant-context';
import {
  getAvailableTools,
  getAccessControlWarnings,
} from '../../../mcp/tools/grant-filter';
import { invokeTool, toolRegistration } from '../../../mcp/tools/registration';
import { NEON_TOOLS } from '../../../mcp/tools/definitions';
import { assert } from '../../../lib/assert';
import { SERVER_HOST } from '../../../lib/config';
import { buildResourceMetadataUrlForResourceRequest } from '../../../lib/oauth/protected-resource-metadata';

const ROUTE_PATHS = {
  canonicalMcp: '/api/mcp',
  canonicalSse: '/api/sse',
  canonicalMessage: '/api/message',
  legacyMcp: '/mcp',
  legacySse: '/sse',
  legacyMessage: '/message',
} as const;

const RETIRED_TRANSPORT_PATHS = new Set<string>([
  ROUTE_PATHS.canonicalSse,
  ROUTE_PATHS.canonicalMessage,
  ROUTE_PATHS.legacySse,
  ROUTE_PATHS.legacyMessage,
]);

const JSON_RESPONSE_HEADERS = { 'Content-Type': 'application/json' } as const;

const HTTP_STATUS = {
  unauthorized: 401,
  forbidden: 403,
} as const;

const PROTECTED_RESOURCE_METADATA_PATH =
  '/.well-known/oauth-protected-resource';

const MCP_ALLOWED_ORIGIN_HOSTNAMES = [
  new URL(SERVER_HOST).hostname,
  ...(process.env.NODE_ENV === 'production' ? [] : localhostAllowedOrigins()),
].filter((hostname, index, hostnames) => hostnames.indexOf(hostname) === index);

type AuthenticatedAuthInfo = AuthInfo & {
  extra?: {
    apiKey?: string;
    authMethod?: AuthContext['extra']['authMethod'];
    account?: AuthContext['extra']['account'];
    readOnly?: boolean;
    grant?: GrantContext;
    client?: AuthContext['extra']['client'];
    transport?: AppContext['transport'];
    userAgent?: string;
  };
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
          toolRegistration(tool),
          async (args: unknown, ctx: McpServerContext) => {
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
                  authMethod,
                  readOnly,
                  grant,
                  neonClient,
                  clientApplication: clientApp,
                  clientName: cName,
                  client,
                  context,
                } = await getAuthContext(ctx);

                // Track server_init on first authenticated request (after client detection)
                trackServerInit(context);

                const properties = {
                  authMethod,
                  tool_name: tool.name,
                  readOnly: String(readOnly),
                  projectScoped: String(!!grant.projectId),
                  clientName: cName,
                  clientApplication: clientApp,
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
                  account,
                  readOnly,
                  clientApplication: clientApp,
                };

                try {
                  const result = await invokeTool(
                    tool.name,
                    args,
                    grant,
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
    },
    {
      serverInfo: {
        name: 'mcp-server-neon',
        version: pkg.version,
      },
      capabilities: {
        tools: {},
        resources: {},
      },
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
            } else if (event.severity === 'fatal') {
              logger.error('MCP fatal error', {
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

// The docs-only handler bypasses OAuth entirely. It only registers tools
// scoped to the `docs` category, which currently fetch from neon.com via
// global fetch and never touch the Neon API client. We deliberately avoid
// going through `getAvailableTools` / `grant-filter` here so the
// "always available" search/fetch tools (which require Neon API auth) are
// not surfaced anonymously.
const DOCS_ONLY_TOOLS = NEON_TOOLS.filter((tool) => tool.scope === 'docs');
function getDocsOnlyToolDefinition(
  name: 'list_docs_resources' | 'get_doc_resource',
) {
  const tool = DOCS_ONLY_TOOLS.find((tool) => tool.name === name);
  assert(tool, `${name} tool definition not found`);
  return tool;
}

const listDocsResourcesTool = getDocsOnlyToolDefinition('list_docs_resources');
const getDocResourceTool = getDocsOnlyToolDefinition('get_doc_resource');

const ANONYMOUS_DOCS_USER_ID = 'anonymous-docs';

const docsOnlyAppContext: AppContext = {
  name: 'mcp-server-neon',
  transport: 'stream',
  environment: (process.env.NODE_ENV ??
    'production') as AppContext['environment'],
  version: pkg.version,
};

function createDocsOnlyMcpHandler(userAgent: string | undefined) {
  return createMcpHandler(
    (server: McpServer) => {
      async function runDocsTool(
        toolName: 'list_docs_resources' | 'get_doc_resource',
        userAgent: string | undefined,
        call: () => Promise<string>,
      ) {
        const traceId = generateTraceId();
        return await startSpan(
          {
            name: 'tool_call',
            attributes: {
              tool_name: toolName,
              trace_id: traceId,
              docs_only: true,
            },
          },
          async (span) => {
            const properties = {
              authMethod: 'anonymous',
              tool_name: toolName,
              readOnly: 'true',
              projectScoped: 'false',
              clientName: 'anonymous-docs',
              clientApplication: detectClientApplication(userAgent),
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

            try {
              const text = await call();
              return {
                content: [
                  {
                    type: 'text' as const,
                    text,
                  },
                ],
              };
            } catch (error) {
              span.setStatus({ code: 2 });
              const errorResult = handleToolError(error, properties, traceId);
              logger.warn('tool error response (docs-only):', {
                ...properties,
                isError: true,
                contentLength: errorResult.content?.length,
                firstContentType: errorResult.content?.[0]?.type,
              });
              return errorResult;
            }
          },
        );
      }

      server.registerTool(
        listDocsResourcesTool.name,
        toolRegistration(listDocsResourcesTool),
        async () =>
          runDocsTool(listDocsResourcesTool.name, userAgent, () =>
            listDocsResources(),
          ),
      );

      server.registerTool(
        getDocResourceTool.name,
        toolRegistration(getDocResourceTool),
        async (args: { slug: string }) =>
          runDocsTool(getDocResourceTool.name, userAgent, () =>
            getDocResource({ slug: args.slug }),
          ),
      );
    },
    {
      serverInfo: {
        name: 'mcp-server-neon',
        version: pkg.version,
      },
      capabilities: {
        tools: {},
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
            if (event.severity === 'fatal') {
              logger.error('MCP docs-only fatal error', {
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
    logger.error('API key verification failed', {
      message: error instanceof Error ? error.message : String(error),
      status: error instanceof NeonApiError ? error.status : undefined,
      data: error instanceof NeonApiError ? error.body : undefined,
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

  // Parse request-level grant and read-only controls.
  const url = new URL(req.url);
  const searchParams = url.searchParams;
  const readOnlyQueryParam = searchParams.get('readonly');

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

      const tokenGrant = resolveGrantFromToken(
        token as { grant?: GrantContext },
      );

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
          authMethod: 'oauth',
          account: {
            id: token.user.id,
            name: token.user.name,
            email: token.user.email,
            isOrg: token.user.isOrg ?? false,
          },
          apiKey: bearerToken,
          readOnly,
          grant: tokenGrant,
          client: {
            id: token.client.id,
            name: token.client.client_name,
          },
          transport: 'stream',
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

  const readOnly = isReadOnly({
    queryParamValue: readOnlyQueryParam,
    headerValue: readOnlyHeader,
  });
  const urlGrant = resolveGrantFromSearchParams(searchParams);

  return {
    token: bearerToken,
    scopes: ['*'], // API keys get all scopes
    clientId: 'api-key', // Literal string
    extra: {
      authMethod: apiKeyRecord.authMethod,
      account: apiKeyRecord.account,
      apiKey: bearerToken,
      readOnly,
      grant: urlGrant,
      transport: 'stream',
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

/**
 * What GET answers for this endpoint, minus the body.
 *
 * HEAD must not be forwarded to mcp-handler: its streamable-HTTP branch writes a
 * response only for GET, DELETE, and POST, so a HEAD falls through every branch
 * and the response promise never settles. The invocation then runs to the Fluid
 * Compute ceiling and Vercel answers 504 — 800 seconds of compute per probe, and
 * uptime checkers send them on a schedule.
 *
 * Mirroring GET keeps HEAD useful: probes learn the endpoint is alive, and the
 * status matches what a GET would have returned.
 */
function headMirrorResponse(pathname: string): Response {
  void pathname;
  // The streamable-HTTP transport is POST-only; GET is 405 (mcp-handler).
  return new Response(null, {
    status: 405,
    headers: { ...JSON_RESPONSE_HEADERS, Allow: 'POST' },
  });
}

/** Drop the body while preserving status and headers, as HEAD requires. */
function stripBody(response: Response): Response {
  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

// Wrap with authentication. After auth is resolved, route to a context-scoped
// MCP handler whose registered tools match the token grant/read-only context.
const authHandler = withMcpAuth(
  async (req) => createContextualMcpHandler(getStaticToolContext(req))(req),
  verifyToken,
  {
    required: true,
    resourceMetadataPath: PROTECTED_RESOURCE_METADATA_PATH,
  },
);

// HEAD goes through the same auth pipeline as GET, so an unauthenticated probe
// still receives the 401 + WWW-Authenticate that MCP clients rely on for OAuth
// discovery. Only the handler differs: it answers directly instead of handing the
// request to mcp-handler, which would never respond to a HEAD.
const headAuthHandler = withMcpAuth(
  async (req) => headMirrorResponse(new URL(req.url).pathname),
  verifyToken,
  {
    required: true,
    resourceMetadataPath: PROTECTED_RESOURCE_METADATA_PATH,
  },
);

function rewriteResourceMetadataHeader(
  response: Response,
  request: Request,
): Response {
  if (response.status !== HTTP_STATUS.unauthorized) {
    return response;
  }

  const wwwAuthenticate = response.headers.get('WWW-Authenticate');
  if (!wwwAuthenticate) {
    return response;
  }

  const resourceMetadataUrl =
    buildResourceMetadataUrlForResourceRequest(request);

  const updatedHeader = /resource_metadata="[^"]*"/.test(wwwAuthenticate)
    ? wwwAuthenticate.replace(
        /resource_metadata="[^"]*"/,
        `resource_metadata="${resourceMetadataUrl}"`,
      )
    : `${wwwAuthenticate}, resource_metadata="${resourceMetadataUrl}"`;

  if (updatedHeader === wwwAuthenticate) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set('WWW-Authenticate', updatedHeader);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function retiredTransportResponse(method: string): Response {
  const body =
    method === 'HEAD'
      ? null
      : JSON.stringify({
          error: 'transport_gone',
          message:
            'HTTP+SSE was removed. Connect to /mcp using Streamable HTTP.',
        });
  return new Response(body, {
    status: 410,
    headers: JSON_RESPONSE_HEADERS,
  });
}

// Normalize the public /mcp rewrite to its internal App Router path so OAuth
// resource metadata and transport handling use one canonical URL.
const handleRequest = (req: Request) => {
  const url = new URL(req.url);

  if (RETIRED_TRANSPORT_PATHS.has(url.pathname)) {
    return retiredTransportResponse(req.method);
  }

  const originRejection = originValidationResponse(
    req,
    MCP_ALLOWED_ORIGIN_HOSTNAMES,
  );
  if (originRejection) {
    return originRejection;
  }

  if (url.pathname === ROUTE_PATHS.legacyMcp) {
    url.pathname = ROUTE_PATHS.canonicalMcp;
  }

  const normalizedReq = new Request(url.toString(), {
    method: req.method,
    headers: req.headers,
    body: req.body,
    // @ts-expect-error duplex is required for streaming bodies
    duplex: 'half',
  });

  // HEAD is answered here rather than by either MCP handler, both of which leave
  // it unanswered until the function times out. Checked before the docs-only
  // bypass because that path skips auth entirely, which would otherwise let an
  // anonymous HEAD probe hang.
  if (normalizedReq.method === 'HEAD') {
    if (isDocsOnlyRequest(url.searchParams)) {
      return headMirrorResponse(url.pathname);
    }
    return Promise.resolve(headAuthHandler(normalizedReq)).then((resolved) =>
      stripBody(rewriteResourceMetadataHeader(resolved, req)),
    );
  }

  // Strict docs-only mode: bypass OAuth entirely so docs tools are usable
  // without an account. Only triggers when the request is exactly
  // ?category=docs (no other categories, no projectId).
  if (isDocsOnlyRequest(url.searchParams)) {
    return createDocsOnlyMcpHandler(req.headers.get('user-agent') ?? undefined)(
      normalizedReq,
    );
  }

  const response = authHandler(normalizedReq);
  if (response instanceof Promise) {
    return response.then((resolved) =>
      rewriteResourceMetadataHeader(resolved, req),
    );
  }
  return rewriteResourceMetadataHeader(response, req);
};

// HEAD is exported explicitly. Next.js would otherwise route it to the GET export,
// which is the same function, but relying on that implicit mapping hides the fact
// that HEAD needs its own branch to avoid the mcp-handler timeout.
export {
  handleRequest as GET,
  handleRequest as POST,
  handleRequest as DELETE,
  handleRequest as HEAD,
};
