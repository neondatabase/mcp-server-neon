/**
 * Secrets modes through the deployed route: each case is a stateless
 * `POST /mcp` against a local Neon API and the test OAuth database, with an API
 * key or a stored OAuth token, so the connection's `secrets`, `readonly`, and
 * `roleName` reach the real tool handlers and `@neon/tools`.
 */
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { ServerResponse } from 'node:http';
import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

const PROJECT_ID = 'proj-secrets-123';
const BRANCH_ID = 'br-secrets-123';
const ROLE_PASSWORD = 'FAKE_ROLE_PASSWORD_123';
const REALTIME_SECRET = 'nrt_live_1FAKE_REALTIME_SECRET';
const OAUTH_CLIENT_SECRET = 'FAKE_GOOGLE_CLIENT_SECRET';
const REDACTED = '***redacted***';

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

const BRANCH_PATH = `/projects/${PROJECT_ID}/branches/${BRANCH_ID}`;

const ROUTES = new Map<string, Json>([
  ['/auth', { auth_method: 'api_key_user', account_id: 'user_test_123' }],
  [
    '/users/me',
    { id: 'user_test_123', name: 'Test User', email: 'test@example.com' },
  ],
  [
    `${BRANCH_PATH}/roles`,
    {
      roles: [
        {
          branch_id: BRANCH_ID,
          name: 'neondb_owner',
          password: ROLE_PASSWORD,
          protected: false,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ],
    },
  ],
  [
    `${BRANCH_PATH}/realtime/secret`,
    { secret: REALTIME_SECRET, pending: false },
  ],
  [
    `${BRANCH_PATH}/auth/oauth_providers`,
    {
      providers: [
        {
          id: 'google',
          type: 'standard',
          client_id: 'fake-client-id',
          client_secret: OAUTH_CLIENT_SECRET,
        },
      ],
    },
  ],
]);

const json = (res: ServerResponse, status: number, body: Json) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const api = createServer((req, res) => {
  const [path = ''] = (req.url ?? '').replace(/^\/api\/v2/u, '').split('?');
  const route = ROUTES.get(path);

  if (route === undefined) {
    json(res, 404, { message: `no fake for ${path}` });

    return;
  }

  json(res, 200, route);
});

api.listen(0, '127.0.0.1');

await once(api, 'listening');

const { port } = z.object({ port: z.number() }).parse(api.address());

process.env.NEON_API_HOST = `http://127.0.0.1:${String(port)}/api/v2`;

process.env.ANALYTICS_WRITE_KEY = '';

process.env.SENTRY_DSN = '';

const { ensureTestOauthDatabase } =
  await import('./ensure-test-oauth-database');

await ensureTestOauthDatabase();

const { POST } = await import('../../app/api/[transport]/route');

const { SERVER_HOST } = await import('../../lib/config');

const { model } = await import('../oauth/model');

type Connection = {
  bearer: string;
  query: string;
  headers: Record<string, string>;
};

const connection = (
  query: string,
  headers: Record<string, string> = {},
): Connection => ({ bearer: 'test-api-key', query, headers });

const savedTokens: string[] = [];

/** Stores an OAuth token the way /api/token does and connects with it. */
const oauthConnection = async (
  grant: Record<string, Json>,
  query = '',
  headers: Record<string, string> = {},
): Promise<Connection> => {
  const accessToken = `secrets-route-${randomUUID()}`;

  await model.saveToken({
    accessToken,
    expires_at: Date.now() + 3_600_000,
    scope: 'read write',
    client: { id: 'secrets-route-client', grants: ['authorization_code'] },
    user: { id: 'user_test_123', name: 'Test User', email: 'test@example.com' },
    grant,
  });
  savedTokens.push(accessToken);

  return { bearer: accessToken, query, headers };
};

const META = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientInfo': {
    name: 'secrets-route',
    version: '1.0.0',
  },
  'io.modelcontextprotocol/clientCapabilities': {},
};

const post = async (
  { bearer, query, headers }: Connection,
  mcpHeaders: Record<string, string>,
  body: Record<string, Json>,
) =>
  POST(
    new Request(`${SERVER_HOST}/mcp${query}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${bearer}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...mcpHeaders,
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, ...body }),
    }),
  );

const listToolsRequest = async (target: Connection) =>
  post(
    target,
    { 'mcp-method': 'tools/list' },
    { method: 'tools/list', params: { _meta: META } },
  );

const callToolRequest = async (target: Connection, name: string) =>
  post(
    target,
    { 'mcp-method': 'tools/call', 'mcp-name': name },
    {
      method: 'tools/call',
      params: {
        name,
        arguments: { project_id: PROJECT_ID, branch_id: BRANCH_ID },
        _meta: META,
      },
    },
  );

// A stateless response is either JSON or a single SSE message.
const messageOf = async (response: Response) => {
  const body = await response.text();
  const sse = response.headers.get('content-type')?.includes('event-stream');

  const data =
    sse === true
      ? body
          .split('\n')
          .find((line) => line.startsWith('data: '))
          ?.slice('data: '.length)
      : body;

  return z.json().parse(JSON.parse(data ?? 'null'));
};

const ToolList = z.object({
  result: z.object({ tools: z.array(z.object({ name: z.string() })) }),
});

const ToolResult = z.object({
  result: z.object({
    content: z.array(z.object({ type: z.literal('text'), text: z.string() })),
  }),
});

const Roles = z.array(z.object({ name: z.string(), password: z.string() }));

const toolNames = async (target: Connection) => {
  const message = ToolList.parse(
    await messageOf(await listToolsRequest(target)),
  );

  return message.result.tools.map((tool) => tool.name);
};

const callContent = async (target: Connection, name: string) => {
  const message = ToolResult.parse(
    await messageOf(await callToolRequest(target, name)),
  );

  return message.result.content.map((item) => item.text);
};

const callText = async (target: Connection, name: string) => {
  const content = await callContent(target, name);

  return content.join('\n');
};

const rolePassword = async (target: Connection) => {
  const [text = 'null'] = await callContent(target, 'list_postgres_roles');

  return Roles.parse(JSON.parse(text)).map((role) => role.password);
};

const Providers = z.array(z.object({ client_secret: z.string() }));

const providerSecret = async (target: Connection) => {
  const [text = 'null'] = await callContent(
    target,
    'list_auth_oauth_providers',
  );

  return Providers.parse(JSON.parse(text)).map(
    (provider) => provider.client_secret,
  );
};

const SETUP = connection('');

const ALL = connection('?secrets=all');

const NONE_BY_PARAM = connection('?secrets=none');

const NONE_BY_HEADER = connection('', { 'x-neon-secrets': 'none' });

describe('secrets through the MCP route', () => {
  afterAll(async () => {
    await Promise.all(
      savedTokens.map(async (accessToken) =>
        model.deleteToken({
          accessToken,
          client: { id: 'secrets-route-client', grants: [] },
          user: {},
        }),
      ),
    );
    api.closeAllConnections();
    api.close();
  });

  it('shows setup credentials and hides stored secrets by default', async () => {
    await expect(rolePassword(SETUP)).resolves.toStrictEqual([ROLE_PASSWORD]);
    await expect(callText(SETUP, 'get_realtime_secret')).resolves.toContain(
      REALTIME_SECRET,
    );
    await expect(providerSecret(SETUP)).resolves.toStrictEqual([REDACTED]);

    const tools = await toolNames(SETUP);

    expect(tools).toContain('get_connection_string');
    expect(tools).toContain('get_realtime_secret');
    expect(tools).toContain('rotate_credential');
  });

  it('shows stored secrets with ?secrets=all', async () => {
    await expect(providerSecret(ALL)).resolves.toStrictEqual([
      OAUTH_CLIENT_SECRET,
    ]);
    await expect(rolePassword(ALL)).resolves.toStrictEqual([ROLE_PASSWORD]);
  });

  it.each([
    ['?secrets=none', NONE_BY_PARAM],
    ['the x-neon-secrets header', NONE_BY_HEADER],
  ])(
    'hides every secret with %s and withholds secret-only tools',
    async (_, target) => {
      await expect(rolePassword(target)).resolves.toStrictEqual([REDACTED]);
      await expect(providerSecret(target)).resolves.toStrictEqual([REDACTED]);

      const tools = await toolNames(target);

      expect(tools).toContain('list_postgres_roles');
      expect(tools).toContain('rotate_realtime_secret');
      expect(tools).not.toContain('get_connection_string');
      expect(tools).not.toContain('get_realtime_secret');
      expect(tools).not.toContain('rotate_credential');
    },
  );

  it('keeps the tighter mode when the header loosens the URL', async () => {
    const target = connection('?secrets=none', { 'x-neon-secrets': 'all' });

    await expect(rolePassword(target)).resolves.toStrictEqual([REDACTED]);
  });

  it('lets the header tighten ?secrets=all', async () => {
    const target = connection('?secrets=all', { 'x-neon-secrets': 'setup' });

    await expect(providerSecret(target)).resolves.toStrictEqual([REDACTED]);
  });

  it.each([
    connection('?secrets=yes'),
    connection('?secrets=all&secrets=none'),
    connection('', { 'x-neon-secrets': 'true' }),
  ])('rejects a secrets value it cannot read (%o)', async (target) => {
    const response = await listToolsRequest(target);

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toContain(
      'Invalid secrets: expected setup, all, or none',
    );
  });

  it('hides every secret on a read-only connection', async () => {
    await expect(
      rolePassword(connection('?readonly=true&secrets=all')),
    ).resolves.toStrictEqual([REDACTED]);
  });

  it('hides role reads on a pinned role and keeps the other secrets', async () => {
    const pinned = connection('?roleName=app_reader');

    await expect(rolePassword(pinned)).resolves.toStrictEqual([REDACTED]);
    await expect(callText(pinned, 'get_realtime_secret')).resolves.toContain(
      REALTIME_SECRET,
    );
    await expect(toolNames(pinned)).resolves.not.toContain(
      'get_connection_string',
    );
  });

  it('gives an OAuth token stored before secrets existed setup credentials', async () => {
    const legacy = await oauthConnection({ projectId: null, scopes: null });

    await expect(rolePassword(legacy)).resolves.toStrictEqual([ROLE_PASSWORD]);
    await expect(providerSecret(legacy)).resolves.toStrictEqual([REDACTED]);
  });

  it.each([
    ['all', [ROLE_PASSWORD], [OAUTH_CLIENT_SECRET]],
    ['none', [REDACTED], [REDACTED]],
  ])(
    'applies an OAuth grant that stored secrets: %s',
    async (secrets, passwords, providerSecrets) => {
      const target = await oauthConnection({
        projectId: null,
        scopes: null,
        secrets,
      });

      await expect(rolePassword(target)).resolves.toStrictEqual(passwords);
      await expect(providerSecret(target)).resolves.toStrictEqual(
        providerSecrets,
      );
    },
  );

  it('lets an OAuth request tighten its grant', async () => {
    const tightened = await oauthConnection(
      { projectId: null, scopes: null, secrets: 'all' },
      '?secrets=none',
    );

    await expect(rolePassword(tightened)).resolves.toStrictEqual([REDACTED]);
  });

  it('keeps an OAuth grant when the request asks for more', async () => {
    const setup = await oauthConnection(
      { projectId: null, scopes: null },
      '?secrets=all',
      { 'x-neon-secrets': 'all' },
    );

    await expect(providerSecret(setup)).resolves.toStrictEqual([REDACTED]);
  });

  it('refuses an OAuth token whose stored secrets it cannot read', async () => {
    const unreadable = await oauthConnection({
      projectId: null,
      scopes: null,
      secrets: 'yes',
    });

    const response = await listToolsRequest(unreadable);

    expect(response.status).toBe(401);
  });
});
