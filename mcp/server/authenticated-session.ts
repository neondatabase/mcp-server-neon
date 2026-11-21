import type {
  CallToolResult,
  ServerContext as McpServerContext,
} from '@modelcontextprotocol/server';
import { Effect, Predicate } from 'effect';
import { Analytics } from '../analytics/analytics-service';
import { appendAccessWarnings } from '../tools/access-warnings';
import { getAccessControlWarnings } from '../tools/grant-filter';
import type { AuthenticatedAuthInfo } from '../transport/oauth-token';
import type { ServerContext } from '../types/context';
import { identifyClient } from '../utils/client-application';
import type { IdentifiedClient } from '../utils/client-application';
import {
  DEFAULT_GRANT,
  grantAnalyticsProperties,
  normalizeStoredGrant,
} from '../utils/grant-context';
import { appContext, requestClientName } from './mcp-request';

/** Who the client is, as far as this request has learned. */
export type ClientIdentity = { identified: IdentifiedClient };

/** What one MCP server instance remembers between its callbacks. */
export type ServerState = {
  trackedServerInit: boolean;
  /** For `onerror`, which has no request of its own. */
  lastKnownContext: ServerContext | undefined;
};

/** One request's MCP server, as its callbacks see it. */
export type AuthenticatedServer = {
  readonly authInfo: AuthenticatedAuthInfo;
  readonly client: ClientIdentity;
  readonly state: ServerState;
};

export const newClientIdentity = (): ClientIdentity => ({
  identified: identifyClient(),
});

/** The grant and read-only mode the server's tool list is built for. */
export const toolListContext = (authInfo: AuthenticatedAuthInfo) => {
  const stored = authInfo.extra?.grant;

  // Backward compatibility: older tokens may not have persisted grant context.
  // Remove this DEFAULT_GRANT fallback once all active tokens are guaranteed
  // to include grant.
  const grant =
    Predicate.hasProperty(stored, 'projectId') &&
    Predicate.hasProperty(stored, 'scopes')
      ? normalizeStoredGrant(stored)
      : DEFAULT_GRANT;

  return { grant, readOnly: authInfo.extra?.readOnly === true };
};

const clientNameFor = (
  ctx: McpServerContext,
  { identified }: ClientIdentity,
  userAgent: string | undefined,
) =>
  requestClientName(ctx) ??
  (identified.clientName === 'unknown' ? userAgent : identified.clientName);

/**
 * The caller of one tool call. Updates the client identity from the request's
 * metadata and remembers the context for `onerror`.
 */
export const authenticatedCall = (
  { authInfo, client, state }: AuthenticatedServer,
  ctx: McpServerContext,
) => {
  const { extra } = authInfo;

  if (
    extra?.apiKey === undefined ||
    extra.apiKey === '' ||
    extra.authMethod === undefined ||
    extra.account === undefined
  ) {
    throw new Error('Authentication required');
  }

  client.identified = identifyClient(
    clientNameFor(ctx, client, extra.userAgent),
    extra.client?.name,
  );

  const grant = extra.grant ?? DEFAULT_GRANT;
  const readOnly = extra.readOnly ?? false;

  const context: ServerContext = {
    apiKey: extra.apiKey,
    authMethod: extra.authMethod,
    account: extra.account,
    app: appContext(extra.transport),
    readOnly,
    client: extra.client,
    grant: { ...grant },
  };

  state.lastKnownContext = context;

  return {
    context,
    grant: context.grant ?? DEFAULT_GRANT,
    readOnly,
    agent: client.identified,
    userAgent: extra.userAgent,
  };
};

type AuthenticatedCall = ReturnType<typeof authenticatedCall>;

/** The `tool_call` event properties, which are also the tool call's log fields. */
export const toolCallProperties = (
  toolName: string,
  { context, grant, readOnly, agent }: AuthenticatedCall,
  traceId: string,
) => ({
  authMethod: context.authMethod,
  toolName,
  tool_name: toolName,
  readOnly: String(readOnly),
  ...grantAnalyticsProperties(grant),
  clientName: agent.clientName,
  clientApplication: agent.clientApplication,
  traceId,
});

export const withAccessWarnings = (
  result: CallToolResult,
  { grant, readOnly }: AuthenticatedCall,
): void => {
  appendAccessWarnings(result, getAccessControlWarnings(grant, readOnly));
};

/** The Sentry and analytics contexts of a failure outside any tool call. */
export const errorContexts = ({ lastKnownContext }: ServerState) => ({
  app: lastKnownContext?.app ?? appContext(),
  client: lastKnownContext?.client,
});

/** `server_init`, once per server, on its first authenticated tool call. */
export const trackServerInit = (
  { context, agent: { clientName, clientApplication } }: AuthenticatedCall,
  state: ServerState,
) =>
  Effect.gen(function* () {
    if (state.trackedServerInit) {
      return;
    }

    state.trackedServerInit = true;

    const grant = context.grant ?? DEFAULT_GRANT;
    const analytics = yield* Analytics;

    yield* analytics.track({
      userId: context.account.id,
      event: 'server_init',
      properties: {
        authMethod: context.authMethod,
        clientName,
        clientApplication,
        readOnly: String(context.readOnly ?? false),
        ...grantAnalyticsProperties(grant),
      },
      context: { client: context.client, app: context.app, clientName },
    });
    yield* Effect.logInfo('Server initialized:').pipe(
      Effect.annotateLogs({
        clientName,
        clientApplication,
        readOnly: context.readOnly,
        grant,
      }),
    );
  });
