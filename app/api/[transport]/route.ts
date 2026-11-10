import {
  CLIENT_INFO_META_KEY,
  fromJsonSchema,
  isInitializeRequest,
  localhostAllowedOrigins,
  McpServer,
  originValidationResponse,
} from '@modelcontextprotocol/server';
import type {
  AuthInfo,
  ServerContext as McpServerContext,
} from '@modelcontextprotocol/server';
import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import { captureException } from '@sentry/node';
import { NeonApiError } from '@neon/sdk';

import { NEON_HANDLERS } from '../../../mcp/tools/index';
import { createNeonClient } from '../../../mcp/server/api';
import pkg from '../../../package.json';
import { handleToolError } from '../../../mcp/server/errors';
import { createSdkErrorReporter } from '../../../mcp/server/sdk-errors';
import type { ToolHandlerExtraParams } from '../../../mcp/tools/types';
import { identifyClient } from '../../../mcp/utils/client-application';
import { isReadOnly } from '../../../mcp/utils/read-only';
import type { AuthContext } from '../../../mcp/types/auth';
import { logger } from '../../../mcp/utils/logger';
import { withSdkCompatRiskLog } from '../../../mcp/utils/sdk-compat-risks';
import { generateTraceId } from '../../../mcp/utils/trace';
import { waitUntil } from '@vercel/functions';
import { track, flushAnalytics } from '../../../mcp/analytics/analytics';
import { resolveAccountFromAuth } from '../../../mcp/server/account';
import { model } from '../../../mcp/oauth/model';
import { getApiKeys, type ApiKeyRecord } from '../../../mcp/oauth/kv-store';
import { agentSentryTags, setSentryTags } from '../../../mcp/sentry/utils';
import { tagRequestSession } from '../../../mcp/sentry/session';
import {
  recordToolError,
  startToolSpan,
  toolSpanClientAttributes,
} from '../../../mcp/sentry/tool-span';
import { flushAfterResponse } from '../../../mcp/sentry/flush';
import {
  MCP_SESSION_ID_HEADER,
  mintSessionId,
  readSessionId,
} from '../../../mcp/utils/mcp-session';
import type { ServerContext, AppContext } from '../../../mcp/types/context';
import {
  isDocsOnlyRequest,
  normalizeStoredGrant,
  parseRoleNameParam,
  resolveGrantFromSearchParams,
  resolveGrantFromToken,
  DEFAULT_GRANT,
  grantAnalyticsProperties,
  InvalidRoleNameError,
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
import { SERVER_HOST } from '../../../lib/config';
import { SERVER_INFO } from '../../../lib/server-metadata';
import { isWellFormedOrigin } from '../../../lib/origin';
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

const ACTIVE_TRANSPORT_PATHS = new Set<string>([
  ROUTE_PATHS.canonicalMcp,
  ROUTE_PATHS.legacyMcp,
]);

const JSON_RESPONSE_HEADERS = { 'Content-Type': 'application/json' } as const;

type JsonErrorDefinition = {
  status: number;
  error: string;
  code: string;
};

const HTTP_STATUS = {
  unauthorized: 401,
  serviceUnavailable: 503,
} as const;

function v2ToolConfig(tool: NeonTool) {
  const registration = toolRegistration(tool);
  return {
    ...registration,
    inputSchema: fromJsonSchema(toListedInputSchema(registration.inputSchema)),
  };
}

const PROTECTED_RESOURCE_METADATA_PATH =
  '/.well-known/oauth-protected-resource';

// Local development is the local-server case the spec's DNS-rebinding rule
// targets, so `next dev` only accepts its own and localhost origins.
const DEV_ALLOWED_ORIGIN_HOSTNAMES = [
  new URL(SERVER_HOST).hostname,
  ...localhostAllowedOrigins(),
].filter((hostname, index, hostnames) => hostnames.indexOf(hostname) === index);

function originRejection(req: Request): Response | undefined {
  if (process.env.NODE_ENV !== 'production') {
    return originValidationResponse(req, DEV_ALLOWED_ORIGIN_HOSTNAMES);
  }
  const origin = req.headers.get('origin');
  if (origin === null || isWellFormedOrigin(origin)) return undefined;
  return Response.json(
    {
      jsonrpc: '2.0',
      error: { code: -32000, message: `Invalid Origin: ${origin}` },
      id: null,
    },
    { status: 403 },
  );
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

const TOKEN_STORE_UNAVAILABLE_RESPONSE: JsonErrorDefinition = {
  status: HTTP_STATUS.serviceUnavailable,
  error: 'Token store unavailable',
  code: 'token_store_unavailable',
};

const TOKEN_STORE_RETRY_AFTER_SECONDS = '5';

// verifyToken can only return auth info or nothing, and mcp-handler turns
// nothing into a 401 that sends OAuth clients back through refresh. Requests
// that failed because the token store was down are marked here so
// handleRequest can answer 503 instead.
const tokenStoreUnavailableRequests = new WeakSet<Request>();

function tokenStoreUnavailableResponse(): Response {
  const response = jsonErrorResponse(TOKEN_STORE_UNAVAILABLE_RESPONSE);
  response.headers.set('Retry-After', TOKEN_STORE_RETRY_AFTER_SECONDS);
  return response;
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
            return await startToolSpan(
              { toolName: tool.name, ctx, traceId },
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
                  apiKey,
                  userAgent,
                } = await getAuthContext(ctx);

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
                setSentryTags(context, {
                  clientName: cName,
                  clientApplication: clientApp,
                });
                span.setAttributes(
                  toolSpanClientAttributes({
                    clientName: cName,
                    clientApplication: clientApp,
                  }),
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
                  signal: toolCallSignal(ctx),
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
                  recordToolError(span, error);
                  const errorResult = handleToolError(
                    error,
                    properties,
                    traceId,
                    { clientName: cName, clientApplication: clientApp },
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
        return await startToolSpan({ toolName, ctx, traceId }, async (span) => {
          span.setAttributes({
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
          try {
            return await handler({ params: { ...args } }, undefined, {
              readOnly: true,
              clientApplication: docsAgent.clientApplication,
              userAgent,
              signal: toolCallSignal(ctx),
            });
          } catch (error) {
            recordToolError(span, error);
            const errorResult = handleToolError(
              error,
              properties,
              traceId,
              docsAgent,
            );
            logger.warn('tool error response (docs-only):', {
              ...properties,
              isError: true,
              contentLength: errorResult.content?.length,
              firstContentType: errorResult.content?.[0]?.type,
            });
            return errorResult;
          }
        });
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

// Cache TTL for API key verification (5 minutes)
// Balances security (revoked keys stop working soon) with performance (reduce API calls)
const API_KEY_CACHE_TTL_MS = 5 * 60 * 1000;

// Helper: Fetch and cache API key details
// Resolves an API key's account, or reports `'oauth'` as soon as Neon says
// the bearer is an OAuth token, before account resolution can fail it.
const fetchAccountDetails = async (
  accessToken: string,
): Promise<ApiKeyRecord | 'oauth' | null> => {
  // 1. Check cache first
  try {
    const cached = await getApiKeys().get(accessToken);
    if (cached) {
      logger.info('API key cache hit', { accountId: cached.account.id });
      return cached.authMethod === 'oauth' ? 'oauth' : cached;
    }
  } catch (error) {
    logger.warn('API key cache read failed', { error });
  }

  // 2. Cache miss - verify with Neon API
  try {
    const neonClient = createNeonClient(accessToken);
    const { data: auth } = await neonClient.getAuthDetails();
    if (auth.auth_method === 'oauth') {
      return 'oauth';
    }

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
  let tokenLookupFailed = false;
  let token: Awaited<ReturnType<typeof model.getAccessToken>> | undefined;
  try {
    token = await model.getAccessToken(bearerToken);
  } catch (error) {
    tokenLookupFailed = true;
    logger.warn('OAuth token lookup failed, trying API key path', { error });
  }
  if (token) {
    // Expiration is checked by withMcpAuth using expiresAt field
    // which returns proper RFC-compliant 401 with WWW-Authenticate header

    logger.info('OAuth token found', { clientId: token.client.id });

    let tokenGrant: GrantContext;
    try {
      tokenGrant = resolveGrantFromToken(token as { grant?: GrantContext });
    } catch (error) {
      // A stored grant we cannot read must not fall through to the API-key
      // path, which would authenticate the same bearer without its grant.
      logger.error('OAuth token grant is invalid', {
        clientId: token.client.id,
        errorName: error instanceof Error ? error.name : 'unknown',
      });
      return undefined;
    }

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

  // ============================================
  // PATH 2: Not an OAuth token - try API key
  // (For direct API key usage)
  // ============================================
  logger.info('Trying API key verification path');

  const apiKeyRecord = await fetchAccountDetails(bearerToken);
  if (!apiKeyRecord) {
    return undefined;
  }

  // Our access tokens are Neon OAuth tokens, so they also pass the API-key
  // check. Their grant and scope live only in the token store; building them
  // from the URL here would drop what the user chose at consent.
  if (apiKeyRecord === 'oauth') {
    logger.warn('OAuth bearer reached the API key path; refusing URL grant', {
      tokenLookupFailed,
    });
    if (tokenLookupFailed) {
      tokenStoreUnavailableRequests.add(req);
    }
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
      ? normalizeStoredGrant(grantFromAuth)
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
function headMirrorResponse(): Response {
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

function jsonErrorResponse({
  status,
  error,
  code,
}: JsonErrorDefinition): Response {
  return new Response(JSON.stringify({ error, code }), {
    status,
    headers: JSON_RESPONSE_HEADERS,
  });
}

// Wrap with authentication. After auth is resolved, route to a context-scoped
// MCP handler whose registered tools match the token grant/read-only context.
const authHandler = withMcpAuth(
  async (req) =>
    withSdkCompatRiskLog(req, () =>
      withMcpSession(
        req,
        createContextualMcpHandler(getStaticToolContext(req)),
      ),
    ),
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
  async () => headMirrorResponse(),
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

function retiredTransportMessage(): string {
  const mcpUrl = new URL('/mcp', SERVER_HOST).href;
  return `HTTP+SSE was removed. Connect to ${mcpUrl} using Streamable HTTP. Stdio-only clients can bridge it with \`npx -y mcp-remote ${mcpUrl}\`. See https://neon.com/docs/ai/neon-mcp-server#retired-sse.`;
}

function retiredTransportResponse(method: string): Response {
  const body =
    method === 'HEAD'
      ? null
      : JSON.stringify({
          error: 'transport_gone',
          message: retiredTransportMessage(),
        });
  return new Response(body, {
    status: 410,
    headers: JSON_RESPONSE_HEADERS,
  });
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

// Normalize the public /mcp rewrite to its internal App Router path so OAuth
// resource metadata and transport handling use one canonical URL.
const handleRequest = async (req: Request): Promise<Response> => {
  const url = new URL(req.url);

  if (RETIRED_TRANSPORT_PATHS.has(url.pathname)) {
    return retiredTransportResponse(req.method);
  }

  if (!ACTIVE_TRANSPORT_PATHS.has(url.pathname)) {
    return new Response(null, { status: 404 });
  }

  const rejectedOrigin = originRejection(req);
  if (rejectedOrigin) {
    return rejectedOrigin;
  }

  // A malformed pinned role is rejected before auth rather than ignored, so a
  // typo in the connection URL cannot silently fall back to the owner role.
  try {
    parseRoleNameParam(url.searchParams);
  } catch (error) {
    if (error instanceof InvalidRoleNameError) {
      return new Response(
        JSON.stringify({
          error: 'invalid_request',
          error_description: error.message,
        }),
        { status: 400, headers: JSON_RESPONSE_HEADERS },
      );
    }
    throw error;
  }

  if (url.pathname === ROUTE_PATHS.legacyMcp) {
    url.pathname = ROUTE_PATHS.canonicalMcp;
  }

  const normalizedReq = new Request(url.toString(), {
    method: req.method,
    headers: req.headers,
    body: req.body,
    signal: req.signal,
    // @ts-expect-error duplex is required for streaming bodies
    duplex: 'half',
  });

  // HEAD is answered here rather than by either MCP handler, both of which leave
  // it unanswered until the function times out. Checked before the docs-only
  // bypass because that path skips auth entirely, which would otherwise let an
  // anonymous HEAD probe hang.
  if (normalizedReq.method === 'HEAD') {
    if (isDocsOnlyRequest(url.searchParams)) {
      return headMirrorResponse();
    }
    return Promise.resolve(headAuthHandler(normalizedReq)).then((resolved) =>
      stripBody(
        tokenStoreUnavailableRequests.has(normalizedReq)
          ? tokenStoreUnavailableResponse()
          : rewriteResourceMetadataHeader(resolved, req),
      ),
    );
  }

  // Strict docs-only mode: bypass OAuth entirely so docs tools are usable
  // without an account. Only triggers when the request is exactly
  // ?category=docs (no other categories, no projectId).
  if (isDocsOnlyRequest(url.searchParams)) {
    const response = await withSdkCompatRiskLog(normalizedReq, () =>
      withMcpSession(
        normalizedReq,
        createDocsOnlyMcpHandler(req.headers.get('user-agent') ?? undefined),
      ),
    );
    return flushAfterResponse(response);
  }

  const resolved = await authHandler(normalizedReq);
  const response = tokenStoreUnavailableRequests.has(normalizedReq)
    ? tokenStoreUnavailableResponse()
    : rewriteResourceMetadataHeader(resolved, req);
  return flushAfterResponse(response);
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
