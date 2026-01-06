// Initialize Sentry (must be first import)
import '../../../mcp-src/sentry/instrument';

import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { captureException, startSpan } from '@sentry/node';

import { NEON_RESOURCES } from '../../../mcp-src/resources';
import { NEON_PROMPTS, getPromptTemplate } from '../../../mcp-src/prompts';
import { NEON_HANDLERS, NEON_TOOLS } from '../../../mcp-src/tools/index';
import { createNeonClient } from '../../../mcp-src/server/api';
import pkg from '../../../package.json';
import { handleToolError } from '../../../mcp-src/server/errors';
import type { ToolHandlerExtraParams } from '../../../mcp-src/tools/types';
import { detectClientApplication } from '../../../mcp-src/utils/client-application';
import type { AuthContext } from '../../../mcp-src/types/auth';
import { logger } from '../../../mcp-src/utils/logger';
import { waitUntil } from '@vercel/functions';
import { track, flushAnalytics } from '../../../mcp-src/analytics/analytics';
import { setSentryTags } from '../../../mcp-src/sentry/utils';
import type { ServerContext, AppContext } from '../../../mcp-src/types/context';

type AuthenticatedExtra = {
  authInfo?: AuthInfo & {
    extra?: {
      apiKey?: string;
      account?: AuthContext['extra']['account'];
      readOnly?: boolean;
      client?: AuthContext['extra']['client'];
      transport?: AppContext['transport'];
    };
  };
  signal?: AbortSignal;
  sessionId?: string;
};

// Create the MCP handler with all tools, resources, and prompts
const handler = createMcpHandler(
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

      const properties = {
        clientName,
        clientApplication,
        readOnly: String(context.readOnly ?? false),
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
      });
    }

    // Helper function to get Neon client and context from auth info
    function getAuthContext(extra: AuthenticatedExtra) {
      const authInfo = extra.authInfo;
      if (!authInfo?.extra?.apiKey || !authInfo?.extra?.account) {
        throw new Error('Authentication required');
      }

      const apiKey = authInfo.extra.apiKey;
      const account = authInfo.extra.account;
      const readOnly = authInfo.extra.readOnly ?? false;
      const client = authInfo.extra.client;
      const transport = authInfo.extra.transport ?? 'sse';
      const neonClient = createNeonClient(apiKey);

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
      };
      lastKnownContext = context;

      return {
        apiKey,
        account,
        readOnly,
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
      const message = error instanceof Error ? error.message : 'Unknown error';
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

    // Register all tools
    NEON_TOOLS.forEach((tool) => {
      const toolHandler = NEON_HANDLERS[tool.name];
      if (!toolHandler) {
        throw new Error(`Handler for tool ${tool.name} not found`);
      }

      server.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: tool.inputSchema,
        },
        async (args: any, extra: any) => {
          const {
            account,
            readOnly,
            neonClient,
            clientApplication: clientApp,
            clientName: cName,
            client,
            context,
          } = getAuthContext(extra as AuthenticatedExtra);

          // Track server_init on first authenticated request (after client detection)
          trackServerInit(context);

          // Check read-only access
          if (readOnly && !tool.readOnlySafe) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: `Tool "${tool.name}" is not available in read-only mode`,
                },
              ],
            };
          }

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
                readOnly: String(readOnly),
                clientName: cName,
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
                // Wrap args in { params } structure expected by handlers
                return await (toolHandler as any)(
                  { params: args },
                  neonClient,
                  extraArgs,
                );
              } catch (error) {
                span.setStatus({ code: 2 });
                return handleToolError(error, properties);
              }
            },
          );
        },
      );
    });

    // Register all resources
    NEON_RESOURCES.forEach((resource) => {
      server.registerResource(
        resource.name,
        resource.uri,
        {
          description: resource.description,
          mimeType: resource.mimeType,
        },
        async (url: URL, extra: any) => {
          const properties = { resource_name: resource.name };
          logger.info('resource call:', properties);

          // Try to get auth context for tracking
          let context: ServerContext | undefined;
          let account: AuthContext['extra']['account'] | undefined;
          let client: AuthContext['extra']['client'] | undefined;

          try {
            const authContext = getAuthContext(extra as AuthenticatedExtra);
            context = authContext.context;
            account = authContext.account;
            client = authContext.client;

            // Track server_init on first authenticated request
            trackServerInit(context);

            setSentryTags(context);
            track({
              userId: account.id,
              event: 'resource_call',
              properties,
              context: { client, app: context.app },
            });
            waitUntil(flushAnalytics());
          } catch {
            // Resources can be called without auth in some cases
          }

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

    // Register all prompts
    NEON_PROMPTS.forEach((prompt) => {
      server.registerPrompt(
        prompt.name,
        {
          description: prompt.description,
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
          } = getAuthContext(extra as AuthenticatedExtra);

          // Track server_init on first authenticated request
          trackServerInit(context);

          const properties = { prompt_name: prompt.name, clientName: cName };
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
  },
);

// Token verification function for OAuth
const verifyToken = async (
  req: Request,
  bearerToken?: string,
): Promise<AuthInfo | undefined> => {
  // Debug logging for auth issues (using console.log for Vercel visibility)
  const authHeader = req.headers.get('Authorization');
  const userAgent = req.headers.get('User-Agent');
  const debugInfo = {
    hasBearerToken: !!bearerToken,
    bearerTokenLength: bearerToken?.length ?? 0,
    authHeader: authHeader ? `${authHeader.substring(0, 20)}...` : 'missing',
    userAgent,
  };
  console.log('[AUTH DEBUG] verifyToken called:', JSON.stringify(debugInfo));

  if (!bearerToken) return undefined;

  // The bearer token is the Neon API key
  // Verify it by making a test API call
  try {
    const neonClient = createNeonClient(bearerToken);
    const response = await neonClient.getCurrentUserInfo();

    if (response.status !== 200) {
      return undefined;
    }

    const userInfo = response.data;

    // Detect transport from URL pathname
    const url = new URL(req.url);
    const transport: AppContext['transport'] = url.pathname.includes('/mcp')
      ? 'stream'
      : 'sse';

    // Note: server_init is tracked on first tool/resource/prompt call
    // when we have proper client detection from MCP handshake

    return {
      token: bearerToken,
      scopes: ['read', 'write'],
      clientId: userInfo.id,
      extra: {
        account: {
          id: userInfo.id,
          name: userInfo.name ?? 'Unknown',
          email: userInfo.email,
        },
        apiKey: bearerToken,
        readOnly: false, // Could be determined from token scopes
        transport,
      },
    };
  } catch {
    return undefined;
  }
};

// Wrap with authentication
const authHandler = withMcpAuth(handler, verifyToken, {
  required: true,
  resourceMetadataPath: '/.well-known/oauth-protected-resource',
});

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
