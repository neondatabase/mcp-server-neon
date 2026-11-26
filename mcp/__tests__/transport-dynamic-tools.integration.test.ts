/**
 * The tools, notices, and analytics a request gets from its grant, through the
 * deployed route on its real services. OAuth tokens are saved in the test
 * Postgres database. A loopback server answers the Neon API, the SQL endpoint,
 * and the docs pages, and collects the analytics the server sends; Sentry
 * sends to the e2e stand-in, and log lines are read from the winston logger.
 */
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { neonConfig } from '@neondatabase/serverless';
import { flush, httpIntegration, init as initSentry } from '@sentry/node';
import { Effect } from 'effect';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { GrantContext } from '../utils/grant-context';
import { fakeNeon } from './helpers/fake-neon';
import {
  collectKeepalives,
  segmentCollector,
  serveLoopback,
} from './helpers/loopback';
import { mcpRequest, responseBody } from './helpers/mcp-request';

const neonOptions = {
  projectId: 'proj_123',
  branchId: 'br-main-123',
  database: 'neondb',
  owner: 'neondb_owner',
  // The one API key these tests send is one Neon rejects.
  api: (_method: string, path: string) =>
    path === '/auth'
      ? Response.json({ message: 'authentication failed' }, { status: 401 })
      : undefined,
};

let neon = fakeNeon(neonOptions);

const analytics = segmentCollector();

const upstream = await serveLoopback(async (request) => {
  if (analytics.isBatch(request)) {
    return analytics.answer(request);
  }

  return new URL(request.url).pathname === '/docs/introduction.md'
    ? new Response('# Neon Docs')
    : neon.answer(request);
});

const keepalives = collectKeepalives();

Object.assign(process.env, {
  NEON_API_HOST: `${upstream.origin}/api/v2`,
  NEON_DOCS_BASE_URL: upstream.origin,
  ANALYTICS_HOST: upstream.origin,
  ANALYTICS_WRITE_KEY: 'transport-dynamic-tools-test-key',
  SENTRY_DSN: '',
  E2E_SENTRY_PORT: '3131',
});

neonConfig.fetchEndpoint = `${upstream.origin}/sql`;

// Imported once the environment is set: lib/config reads it at import.
const { ensureTestOauthDatabase } =
  await import('./ensure-test-oauth-database');

await ensureTestOauthDatabase();

const {
  SENTRY_FIXTURE_DSN,
  SENTRY_FIXTURE_ITEMS_URL,
  startSentryFixtureServer,
} = await import('../../e2e/sentry-fixture');

await startSentryFixtureServer();

// The loopback server runs in this process; tracing its requests would fill
// the transport buffer.
initSentry({
  dsn: SENTRY_FIXTURE_DSN,
  tracesSampleRate: 1,
  integrations: [httpIntegration({ ignoreIncomingRequests: () => true })],
});

const { POST } = await import('../../app/api/[transport]/route');
const { OAuthStore } = await import('../oauth/oauth-store');
const { getFilteredTools } = await import('../tools/grant-filter');
const { toListedTool } = await import('../tools/listed-schema');
const { logger } = await import('../utils/logger');
const { default: serverJson } = await import('../../server.json');

type LogLine = { readonly level: string; readonly message: string };

const logged: LogLine[] = [];

logger.on('data', (info: LogLine) => {
  logged.push(info);
});

const SdkRejection = z.object({
  status: z.number(),
  source: z.string(),
  errorName: z.string(),
});

/** The fields of each `MCP SDK rejected request` warning. */
const sdkRejections = () =>
  logged.flatMap((line) =>
    line.level === 'warn' && line.message === 'MCP SDK rejected request'
      ? [SdkRejection.parse(line)]
      : [],
  );

const SentryItems = z.array(z.object({ type: z.string() }).loose());

/** Everything the Sentry stand-in received so far. */
const sentryItems = async () => {
  await flush(5000);

  const response = await fetch(SENTRY_FIXTURE_ITEMS_URL);

  return SentryItems.parse(await response.json());
};

const sentryErrorEvents = async () => {
  const items = await sentryItems();

  return items.filter((item) => item.type === 'event');
};

type SavedToken = { readonly bearer: string; readonly userId: string };

const saveOAuthToken = async (input: {
  readonly scope: string;
  readonly grant?: GrantContext;
  readonly clientName?: string;
}): Promise<SavedToken> => {
  const bearer = `oauth-dynamic-tools-${crypto.randomUUID()}`;
  const userId = `user-${crypto.randomUUID()}`;

  await Effect.runPromise(
    OAuthStore.pipe(
      Effect.flatMap((store) =>
        store.saveTokenPair({
          token: {
            accessToken: bearer,
            scope: input.scope,
            client: {
              id: 'client-1',
              client_name: input.clientName ?? 'Cursor',
              grants: ['*'],
            },
            user: { id: userId, name: 'User', email: 'user@example.com' },
            grant: input.grant,
          },
          refreshToken: `${bearer}-refresh`,
        }),
      ),
      Effect.provide(OAuthStore.layer),
    ),
  );

  return { bearer, userId };
};

const mcpCall = async (input: {
  readonly bearerToken: string;
  readonly method: string;
  readonly id: number;
  readonly params?: z.core.util.JSONType;
  readonly queryString?: string;
  readonly userAgent?: string;
  readonly headers?: Record<string, string>;
}) => {
  const { userAgent, headers = {}, ...request } = input;

  const res = await POST(
    mcpRequest({
      ...request,
      headers:
        userAgent === undefined
          ? headers
          : { ...headers, 'User-Agent': userAgent },
    }),
  );

  const body = responseBody(await res.text());

  await keepalives.settle();

  return { status: res.status, body };
};

const anonymousDocsCall = async (input: {
  readonly method: string;
  readonly params: z.core.util.JSONType;
  readonly userAgent: string;
}) => {
  const res = await POST(
    mcpRequest({
      method: input.method,
      params: input.params,
      queryString: '?category=docs',
      headers: { 'User-Agent': input.userAgent },
    }),
  );

  await res.text();
  await keepalives.settle();

  return res.status;
};

const ListedTools = z.object({
  result: z.object({
    tools: z.array(
      z
        .object({
          name: z.string(),
          description: z.string().optional(),
          inputSchema: z
            .object({ properties: z.record(z.string(), z.json()).optional() })
            .loose(),
        })
        .loose(),
    ),
  }),
});

const listToolsForToken = async (bearerToken: string) => {
  await mcpCall({
    bearerToken,
    method: 'initialize',
    id: 1,
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' },
    },
  });

  const list = await mcpCall({
    bearerToken,
    method: 'tools/list',
    id: 2,
    params: {},
  });

  expect(list.status).toBe(200);
  expect(list.body).not.toHaveProperty('error');

  return ListedTools.parse(list.body).result.tools;
};

const runSqlCall = { name: 'run_sql', arguments: { sql: 'select 1' } };

// Each event is its own /v1/batch POST, and the POSTs of one request race.
const eventsFor = (userId: string) =>
  analytics.delivered
    .filter((event) => event.userId === userId)
    .toSorted((a, b) => (a.event ?? '').localeCompare(b.event ?? ''));

const InitializeResult = z.object({
  result: z
    .object({
      instructions: z.string().optional(),
      capabilities: z.json().optional(),
    })
    .loose(),
});

describe('transport dynamic tool composition', () => {
  beforeEach(() => {
    neon = fakeNeon(neonOptions);
    analytics.delivered.length = 0;
    logged.length = 0;
  });

  it('tracks server initialization and tool calls with the auth method', async () => {
    const { bearer, userId } = await saveOAuthToken({
      scope: 'read write',
      grant: { projectId: 'proj_analytics', scopes: null },
    });

    await listToolsForToken(bearer);
    await mcpCall({
      bearerToken: bearer,
      method: 'tools/call',
      id: 3,
      params: runSqlCall,
    });

    // Both are delivered by the time what the requests handed to waitUntil
    // settled.
    expect(eventsFor(userId)).toMatchObject([
      {
        event: 'server_init',
        properties: { authMethod: 'oauth', rolePinned: 'false' },
      },
      {
        event: 'tool_call',
        properties: { authMethod: 'oauth', rolePinned: 'false' },
      },
    ]);
  });

  it('tracks the OAuth project scope and selected categories on both events', async () => {
    const { bearer, userId } = await saveOAuthToken({
      scope: 'read write',
      grant: { projectId: 'proj_analytics', scopes: ['querying', 'branches'] },
    });

    await listToolsForToken(bearer);
    await mcpCall({
      bearerToken: bearer,
      method: 'tools/call',
      id: 3,
      params: runSqlCall,
    });

    const properties = {
      authMethod: 'oauth',
      projectScoped: 'true',
      customScopes: 'branches,querying',
    };

    expect(eventsFor(userId)).toMatchObject([
      { event: 'server_init', properties },
      { event: 'tool_call', properties },
    ]);
  });

  it('tracks whether a Postgres role is pinned without sending its name', async () => {
    const { bearer, userId } = await saveOAuthToken({
      scope: 'read write',
      grant: {
        projectId: 'proj_analytics',
        scopes: null,
        roleName: 'app_reader',
      },
    });

    await listToolsForToken(bearer);
    await mcpCall({
      bearerToken: bearer,
      method: 'tools/call',
      id: 3,
      params: runSqlCall,
    });

    expect(eventsFor(userId)).toMatchObject([
      { event: 'server_init', properties: { rolePinned: 'true' } },
      { event: 'tool_call', properties: { rolePinned: 'true' } },
    ]);
    expect(JSON.stringify(analytics.delivered)).not.toContain('app_reader');
  });

  it('returns access-control notices on initialize, not in tool descriptions', async () => {
    const { bearer } = await saveOAuthToken({
      scope: 'read',
      grant: { projectId: 'proj_instructions', scopes: null },
    });

    const init = await mcpCall({
      bearerToken: bearer,
      method: 'initialize',
      id: 1,
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      },
    });

    const { instructions } = InitializeResult.parse(init.body).result;

    expect(instructions).toContain('read-only permissions');
    expect(instructions).toContain('always pass it on an unscoped connection');
    expect(instructions).not.toContain('proj_instructions');

    const tools = await listToolsForToken(bearer);

    for (const tool of tools) {
      expect(JSON.stringify(tool)).not.toContain('read-only permissions');
    }
  });

  // Every streamable-HTTP request builds a fresh server instance, so the
  // `initialize` handshake and the `tools/call` land on different ones and
  // `clientInfo` is gone by the time anything is tracked. The User-Agent is
  // what actually identifies the client on this transport, which is how v0
  // ("v0bot") is attributed in production.
  it('attributes tool calls to the client application, not just server_init', async () => {
    const { bearer, userId } = await saveOAuthToken({
      scope: 'read write',
      grant: { projectId: 'proj_analytics', scopes: null },
    });

    await mcpCall({
      bearerToken: bearer,
      method: 'tools/call',
      id: 1,
      params: runSqlCall,
      userAgent: 'v0bot',
    });

    const properties = { clientName: 'v0bot', clientApplication: 'v0' };
    const context = { clientName: 'v0bot' };

    expect(eventsFor(userId)).toMatchObject([
      { event: 'server_init', properties, context },
      { event: 'tool_call', properties, context },
    ]);
  });

  it('attributes modern stateless calls from per-request metadata', async () => {
    const { bearer, userId } = await saveOAuthToken({
      scope: 'read write',
      grant: { projectId: 'proj_analytics', scopes: null },
    });

    await mcpCall({
      bearerToken: bearer,
      method: 'tools/call',
      id: 1,
      params: {
        ...runSqlCall,
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientInfo': {
            name: 'v0bot',
            version: '1.0.0',
          },
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
      headers: { 'Mcp-Method': 'tools/call', 'Mcp-Name': 'run_sql' },
    });

    const properties = { clientName: 'v0bot', clientApplication: 'v0' };

    expect(eventsFor(userId)).toMatchObject([
      { event: 'server_init', properties },
      { event: 'tool_call', properties },
    ]);
  });

  it('attributes a generic User-Agent from the OAuth client name', async () => {
    const { bearer, userId } = await saveOAuthToken({
      scope: 'read write',
      grant: { projectId: 'proj_analytics', scopes: null },
      clientName: 'Cline',
    });

    await mcpCall({
      bearerToken: bearer,
      method: 'tools/call',
      id: 1,
      params: runSqlCall,
      userAgent: 'node',
    });

    const properties = { clientName: 'node', clientApplication: 'cline' };

    expect(eventsFor(userId)).toMatchObject([
      {
        event: 'server_init',
        properties,
        context: { clientName: 'node', client: { name: 'Cline' } },
      },
      { event: 'tool_call', properties },
    ]);
  });

  it('keeps an unclassified OAuth name on client and the User-Agent on clientName', async () => {
    const { bearer, userId } = await saveOAuthToken({
      scope: 'read write',
      grant: { projectId: 'proj_analytics', scopes: null },
      clientName: 'Nous Research',
    });

    await mcpCall({
      bearerToken: bearer,
      method: 'tools/call',
      id: 1,
      params: runSqlCall,
      userAgent: 'node',
    });

    expect(eventsFor(userId)[0]).toMatchObject({
      event: 'server_init',
      properties: { clientName: 'node', clientApplication: 'unknown' },
      context: { clientName: 'node', client: { name: 'Nous Research' } },
    });
  });

  it('attributes the Claude connector User-Agent to claude-desktop', async () => {
    const { bearer, userId } = await saveOAuthToken({
      scope: 'read write',
      grant: { projectId: 'proj_analytics', scopes: null },
      clientName: 'Claude',
    });

    await mcpCall({
      bearerToken: bearer,
      method: 'tools/call',
      id: 1,
      params: runSqlCall,
      userAgent: 'Anthropic/ClaudeAI',
    });

    const properties = {
      clientName: 'Anthropic/ClaudeAI',
      clientApplication: 'claude-desktop',
    };

    expect(eventsFor(userId)).toMatchObject([
      {
        event: 'server_init',
        properties,
        context: {
          clientName: 'Anthropic/ClaudeAI',
          client: { name: 'Claude' },
        },
      },
      { event: 'tool_call', properties },
    ]);
  });

  it('attributes the Claude connector to claude-desktop when its clientInfo says claude-code', async () => {
    const { bearer, userId } = await saveOAuthToken({
      scope: 'read write',
      grant: { projectId: 'proj_analytics', scopes: null },
      clientName: 'Claude',
    });

    await mcpCall({
      bearerToken: bearer,
      method: 'tools/call',
      id: 1,
      params: {
        ...runSqlCall,
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientInfo': {
            name: 'claude-code',
            version: '2.1.300',
          },
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
      userAgent: 'Anthropic/ClaudeAI',
      headers: { 'Mcp-Method': 'tools/call', 'Mcp-Name': 'run_sql' },
    });

    const properties = {
      clientName: 'claude-code',
      clientApplication: 'claude-desktop',
    };

    expect(eventsFor(userId)).toMatchObject([
      { event: 'server_init', properties },
      { event: 'tool_call', properties },
    ]);
  });

  it('attributes Hermes Agent from the OAuth client name when the User-Agent is generic', async () => {
    const { bearer, userId } = await saveOAuthToken({
      scope: 'read write',
      grant: { projectId: 'proj_analytics', scopes: null },
      clientName: 'Hermes Agent',
    });

    await mcpCall({
      bearerToken: bearer,
      method: 'tools/call',
      id: 1,
      params: runSqlCall,
      userAgent: 'python-httpx',
    });

    const properties = {
      clientName: 'python-httpx',
      clientApplication: 'hermes-agent',
    };

    expect(eventsFor(userId)).toMatchObject([
      {
        event: 'server_init',
        properties,
        context: {
          clientName: 'python-httpx',
          client: { name: 'Hermes Agent' },
        },
      },
      { event: 'tool_call', properties },
    ]);
  });

  it('keeps a recognized User-Agent over the OAuth client name', async () => {
    const { bearer, userId } = await saveOAuthToken({
      scope: 'read write',
      grant: { projectId: 'proj_analytics', scopes: null },
      clientName: 'Cline',
    });

    await mcpCall({
      bearerToken: bearer,
      method: 'tools/call',
      id: 1,
      params: runSqlCall,
      userAgent: 'Cursor',
    });

    const properties = { clientName: 'Cursor', clientApplication: 'cursor' };

    expect(eventsFor(userId)).toMatchObject([
      { event: 'server_init', properties },
      { event: 'tool_call', properties },
    ]);
  });

  // ?category=docs bypasses OAuth, so it emits `tool_call` from its own handler
  // rather than the authenticated one and has to carry the column too.
  it('attributes anonymous docs-only tool calls to the client application', async () => {
    await anonymousDocsCall({
      method: 'tools/call',
      params: { name: 'get_doc', arguments: { slug: 'docs/introduction' } },
      userAgent: 'v0bot',
    });

    expect(
      analytics.delivered.filter((event) => event.event === 'tool_call'),
    ).toMatchObject([
      {
        properties: {
          docsOnly: 'true',
          clientName: 'anonymous-docs',
          clientApplication: 'v0',
        },
      },
    ]);
  });

  it('keeps same tool names and enforces projectId by selected variant', async () => {
    const unscoped = await saveOAuthToken({
      scope: 'read write',
      grant: { projectId: null, scopes: null },
    });

    const scoped = await saveOAuthToken({
      scope: 'read write',
      grant: { projectId: 'proj_123', scopes: null },
    });

    const unscopedTools = await listToolsForToken(unscoped.bearer);
    const scopedTools = await listToolsForToken(scoped.bearer);

    const unscopedNames = new Set(unscopedTools.map((t) => t.name));
    const scopedNames = new Set(scopedTools.map((t) => t.name));

    expect(unscopedNames.has('run_sql')).toBe(true);
    expect(scopedNames.has('run_sql')).toBe(true);
    expect(scopedNames.has('list_projects')).toBe(false);

    await mcpCall({
      bearerToken: unscoped.bearer,
      method: 'tools/call',
      id: 3,
      params: runSqlCall,
    });

    expect(neon.connectionUriRequests()).toStrictEqual([]);
    expect(neon.sql).toStrictEqual([]);

    await mcpCall({
      bearerToken: scoped.bearer,
      method: 'tools/call',
      id: 4,
      params: runSqlCall,
    });

    expect(neon.connectionUriRequests()).toMatchObject([
      { path: '/projects/proj_123/connection_uri' },
    ]);
    expect(neon.sql).toMatchObject([{ queries: ['select 1'] }]);
  });

  it('isolates cached handlers by auth context key', async () => {
    const fullAccess = await saveOAuthToken({ scope: 'read write' });
    const readOnly = await saveOAuthToken({ scope: 'read' });

    const fullAccessTools = await listToolsForToken(fullAccess.bearer);
    const readOnlyTools = await listToolsForToken(readOnly.bearer);

    const fullNames = new Set(fullAccessTools.map((t) => t.name));
    const readOnlyNames = new Set(readOnlyTools.map((t) => t.name));

    expect(fullNames.has('create_project')).toBe(true);
    expect(readOnlyNames.has('create_project')).toBe(false);
    expect(readOnlyNames.has('list_projects')).toBe(true);
  });

  it('withholds run_sql_transaction from an OAuth read token', async () => {
    const fullAccess = await saveOAuthToken({ scope: 'read write' });
    const readOnly = await saveOAuthToken({ scope: 'read' });

    const fullTools = await listToolsForToken(fullAccess.bearer);
    const readOnlyTools = await listToolsForToken(readOnly.bearer);

    const fullNames = new Set(fullTools.map((t) => t.name));
    const readOnlyNames = new Set(readOnlyTools.map((t) => t.name));

    expect(fullNames.has('run_sql_transaction')).toBe(true);
    expect(readOnlyNames.has('run_sql')).toBe(true);
    expect(readOnlyNames.has('run_sql_transaction')).toBe(false);

    const call = await mcpCall({
      bearerToken: readOnly.bearer,
      method: 'tools/call',
      id: 3,
      params: {
        name: 'run_sql_transaction',
        arguments: {
          project_id: 'proj_123',
          sql_statements: ['COMMIT', 'DROP TABLE t'],
        },
      },
    });

    expect(call.status).toBe(200);
    expect(call.body).toMatchObject({
      jsonrpc: '2.0',
      id: 3,
      error: {
        code: -32_602,
        message: 'Tool run_sql_transaction not found',
      },
    });
  });

  it('ignores runtime URL grant params for OAuth tokens', async () => {
    const { bearer } = await saveOAuthToken({
      scope: 'read write',
      grant: { projectId: null, scopes: null },
    });

    await mcpCall({
      bearerToken: bearer,
      method: 'initialize',
      id: 10,
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      },
      queryString: '?projectId=proj_123',
    });

    await mcpCall({
      bearerToken: bearer,
      method: 'tools/call',
      id: 11,
      params: runSqlCall,
      queryString: '?projectId=proj_123',
    });

    // If query params were merged at runtime, run_sql would receive injected project_id.
    // OAuth must only use the grant persisted from authorize/token flow.
    expect(neon.connectionUriRequests()).toStrictEqual([]);
    expect(neon.sql).toStrictEqual([]);
  });

  it('ignores runtime readonly query param for OAuth tokens', async () => {
    const { bearer } = await saveOAuthToken({ scope: 'read' });

    await mcpCall({
      bearerToken: bearer,
      method: 'initialize',
      id: 20,
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      },
      queryString: '?readonly=false',
    });

    const list = await mcpCall({
      bearerToken: bearer,
      method: 'tools/list',
      id: 21,
      params: {},
      queryString: '?readonly=false',
    });

    expect(list.status).toBe(200);
    expect(list.body).not.toHaveProperty('error');

    const toolNames = new Set(
      ListedTools.parse(list.body).result.tools.map((t) => t.name),
    );

    // If readonly query params overrode OAuth scopes, this would appear.
    expect(toolNames.has('create_project')).toBe(false);
  });

  it('lists default-grant tools with the SDK JSON Schema conversion', async () => {
    const { bearer } = await saveOAuthToken({
      scope: 'read write',
      grant: { projectId: null, scopes: null },
    });

    const tools = await listToolsForToken(bearer);

    expect(tools).toStrictEqual(
      getFilteredTools({ projectId: null, scopes: null }, false).map((tool) =>
        toListedTool(tool),
      ),
    );

    const inspect = tools.find((tool) => tool.name === 'inspect_database');

    expect(JSON.stringify(inspect?.inputSchema)).toContain('table-sizes');
    expect(JSON.stringify(inspect?.inputSchema)).toContain('stalled-queries');
    expect(JSON.stringify(inspect?.inputSchema)).toContain(
      'The diagnostic to run',
    );

    const branchIdNotes = tools.filter((tool) =>
      JSON.stringify(tool.inputSchema).includes('A br-... id, not a name.'),
    );

    expect(branchIdNotes.length).toBeGreaterThan(40);
  });

  it('emits resource_metadata for the exact requested resource path and query', async () => {
    // The token store has no record of this bearer, and Neon rejects it.
    const req = new Request('http://localhost:3100/mcp?readonly=true', {
      method: 'POST',
      headers: {
        host: 'localhost:3100',
        Authorization: 'Bearer invalid-token',
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 99,
        method: 'tools/list',
        params: {},
      }),
    });

    const res = await POST(req);

    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toContain(
      'resource_metadata="https://localhost:3100/.well-known/oauth-protected-resource/mcp?readonly=true"',
    );
  });

  it('reports the server.json title, description, website, and icons on initialize', async () => {
    const { bearer } = await saveOAuthToken({ scope: 'read write' });

    const init = await mcpCall({
      bearerToken: bearer,
      method: 'initialize',
      id: 1,
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      },
    });

    expect(init.body).toMatchObject({
      result: {
        serverInfo: {
          name: 'mcp-server-neon',
          version: serverJson.version,
          title: serverJson.title,
          description: serverJson.description,
          websiteUrl: serverJson.websiteUrl,
          icons: serverJson.icons,
        },
      },
    });
  });

  it('does not advertise listChanged on 2025-era initialize', async () => {
    const { bearer } = await saveOAuthToken({ scope: 'read write' });

    const init = await mcpCall({
      bearerToken: bearer,
      method: 'initialize',
      id: 1,
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      },
    });

    expect(init.body).toMatchObject({
      result: { protocolVersion: '2025-11-25' },
    });
    expect(InitializeResult.parse(init.body).result.capabilities).toStrictEqual(
      {
        tools: { listChanged: false },
        resources: { listChanged: false },
      },
    );
  });

  it('does not advertise listChanged to 2026-07-28 clients, which then open no listen stream', async () => {
    const { bearer } = await saveOAuthToken({ scope: 'read write' });

    const sentMethods: string[] = [];

    const transport = new StreamableHTTPClientTransport(
      new URL('http://localhost/api/mcp'),
      {
        requestInit: { headers: { Authorization: `Bearer ${bearer}` } },
        fetch: async (input, requestInit) => {
          const request = new Request(input, requestInit);

          sentMethods.push(request.headers.get('mcp-method') ?? request.method);

          return POST(request);
        },
      },
    );

    const client = new Client(
      { name: 'modern-test-client', version: '1.0.0' },
      {
        versionNegotiation: { mode: { pin: '2026-07-28' } },
        listChanged: {
          tools: { onChanged: () => undefined },
          resources: { onChanged: () => undefined },
        },
      },
    );

    try {
      await client.connect(transport);
      expect(transport.protocolVersion).toBe('2026-07-28');
      expect(sentMethods).toStrictEqual(['server/discover']);
      expect(client.getServerCapabilities()).toStrictEqual({
        tools: { listChanged: false },
        resources: { listChanged: false },
      });
    } finally {
      await client.close();
    }
  });

  it.each([
    { name: 'authenticated', queryString: '', authorized: true },
    { name: 'docs-only', queryString: '?category=docs', authorized: false },
  ])(
    'logs an SDK-rejected request on the $name handler without reporting it to Sentry',
    async ({ queryString, authorized }) => {
      const headers = new Headers({
        'Content-Type': 'text/plain',
        Accept: 'application/json, text/event-stream',
      });

      if (authorized) {
        const { bearer } = await saveOAuthToken({ scope: 'read write' });

        headers.set('Authorization', `Bearer ${bearer}`);
      }

      const reportedBefore = await sentryErrorEvents();

      const res = await POST(
        new Request(`http://localhost/api/mcp${queryString}`, {
          method: 'POST',
          headers,
          body: '{}',
        }),
      );

      await res.text();
      await keepalives.settle();

      expect(res.status).toBe(415);
      expect(sdkRejections()).toStrictEqual([
        { status: 415, source: 'request', errorName: 'Error' },
      ]);
      await expect(sentryErrorEvents()).resolves.toStrictEqual(reportedBefore);
    },
  );

  it('keeps request values out of the log when the SDK rejects a request', async () => {
    const secret = 'REJECTED_REQUEST_PASSWORD';
    const itemsBefore = await sentryItems();

    const res = await POST(
      mcpRequest({
        method: 'resources/read',
        params: {
          uri: `postgresql://user:${secret}@db.example/test`,
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
        queryString: '?category=docs',
        headers: { 'Mcp-Method': 'resources/read' },
      }),
    );

    await res.text();
    await keepalives.settle();

    expect(res.status).toBe(400);
    expect(sdkRejections()).toMatchObject([{ status: 400 }]);
    expect(JSON.stringify(logged)).not.toContain(secret);

    const itemsAfter = await sentryItems();

    expect(
      itemsAfter.slice(itemsBefore.length).filter((i) => i.type === 'event'),
    ).toStrictEqual([]);
    expect(JSON.stringify(itemsAfter)).not.toContain(secret);
  });

  it('?category=docs bypasses OAuth without an Authorization header', async () => {
    // Without the bypass this request would get a 401 with WWW-Authenticate set.
    const res = await POST(
      mcpRequest({
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'docs-only-integration', version: '1.0.0' },
        },
        queryString: '?category=docs',
      }),
    );

    expect(res.status).toBeLessThan(300);
    expect(res.headers.get('WWW-Authenticate')).toBeNull();
  });
});
