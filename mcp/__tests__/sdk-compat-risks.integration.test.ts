/**
 * The warnings logged for request shapes the next MCP SDK release rejects,
 * through the deployed route on its real services. The OAuth token is saved in
 * the test Postgres database; the log lines are read from the winston logger.
 */
import { Effect } from 'effect';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

// No assertion reads analytics; none is sent.
process.env.NEON_MCP_DISABLE_ANALYTICS = '1';

const { ensureTestOauthDatabase } =
  await import('./ensure-test-oauth-database');

await ensureTestOauthDatabase();

const { POST } = await import('../../app/api/[transport]/route');
const { OAuthStore } = await import('../oauth/oauth-store');
const { logger } = await import('../utils/logger');

const DOCS_URL = 'http://localhost/api/mcp?category=docs';
const AUTHENTICATED_URL = 'http://localhost/api/mcp';
const OAUTH_TOKEN = `oauth-compat-risk-${crypto.randomUUID()}`;
const USER_AGENT = 'compat-risk-test/1.0';

const MODERN_META = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientInfo': { name: 'compat-test', version: '1' },
  'io.modelcontextprotocol/clientCapabilities': {},
};

const post = async (
  body: z.core.util.JSONType,
  headers: Record<string, string> = {},
  url = DOCS_URL,
) => {
  const res = await POST(
    new Request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'User-Agent': USER_AGENT,
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  );

  await res.text();

  return res;
};

const toolsListBatch = (size: number) =>
  Array.from({ length: size }, (_, i) => ({
    jsonrpc: '2.0',
    id: i + 1,
    method: 'tools/list',
  }));

type LogLine = { readonly level: string; readonly message: string };

const logged: LogLine[] = [];

logger.on('data', (info: LogLine) => {
  logged.push(info);
});

const LoggedFields = z.object({
  batchSize: z.number().optional(),
  method: z.string().optional(),
  userAgent: z.string().optional(),
});

/** The fields of each warning logged with `message`. */
const warnedWith = (message: string) =>
  logged.flatMap((line) =>
    line.level === 'warn' && line.message === message
      ? [LoggedFields.parse(line)]
      : [],
  );

const saveOAuthToken = async () =>
  Effect.runPromise(
    OAuthStore.pipe(
      Effect.flatMap((store) =>
        store.saveTokenPair({
          token: {
            accessToken: OAUTH_TOKEN,
            scope: 'read write',
            client: {
              id: 'client-1',
              client_name: 'compat-test',
              grants: ['*'],
            },
            user: { id: 'user-1', name: 'User', email: 'user@example.com' },
          },
          refreshToken: `${OAUTH_TOKEN}-refresh`,
        }),
      ),
      Effect.provide(OAuthStore.layer),
    ),
  );

describe('logging requests that @modelcontextprotocol/server 2.2.0 rejects', () => {
  beforeEach(() => {
    logged.length = 0;
  });

  it('logs an authenticated batch of more than 100 messages', async () => {
    await saveOAuthToken();

    const res = await post(
      toolsListBatch(101),
      { Authorization: `Bearer ${OAUTH_TOKEN}` },
      AUTHENTICATED_URL,
    );

    expect(res.status).toBe(200);
    expect(warnedWith('MCP batch over 100 messages')).toHaveLength(1);
  });

  it('does not read the body of an unauthenticated request', async () => {
    const res = await post(toolsListBatch(101), {}, AUTHENTICATED_URL);

    expect(res.status).toBe(401);
    expect(warnedWith('MCP batch over 100 messages')).toStrictEqual([]);
  });

  it('logs a batch of more than 100 messages and still serves it', async () => {
    const res = await post(toolsListBatch(101));

    expect(res.status).toBe(200);
    expect(warnedWith('MCP batch over 100 messages')).toStrictEqual([
      { batchSize: 101, userAgent: USER_AGENT },
    ]);
  });

  it('does not log a batch of 100 messages', async () => {
    await post(toolsListBatch(100));

    expect(warnedWith('MCP batch over 100 messages')).toStrictEqual([]);
  });

  it('logs a 2026-07-28 request without MCP-Protocol-Version and still serves it', async () => {
    const res = await post(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: { _meta: MODERN_META },
      },
      { 'Mcp-Method': 'tools/list' },
    );

    expect(res.status).toBe(200);
    expect(
      warnedWith('MCP 2026-07-28 request without MCP-Protocol-Version'),
    ).toStrictEqual([{ method: 'tools/list', userAgent: USER_AGENT }]);
  });

  it('does not log a 2026-07-28 request that sends MCP-Protocol-Version', async () => {
    await post(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: { _meta: MODERN_META },
      },
      { 'Mcp-Method': 'tools/list', 'MCP-Protocol-Version': '2026-07-28' },
    );

    expect(
      warnedWith('MCP 2026-07-28 request without MCP-Protocol-Version'),
    ).toStrictEqual([]);
  });

  it.each([
    [
      'a request without jsonrpc',
      { id: 1, method: 'tools/list' },
      { 'Mcp-Method': 'tools/list' },
    ],
    [
      'an incomplete 2026-07-28 envelope',
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {
          _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' },
        },
      },
      { 'Mcp-Method': 'tools/list' },
    ],
    [
      'an Mcp-Method that disagrees with the body',
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: { _meta: MODERN_META },
      },
      { 'Mcp-Method': 'ping' },
    ],
  ])(
    'does not log %s, which 2.0.0 already rejects',
    async (_case, body, headers) => {
      const res = await post(body, headers);

      expect(res.status).toBe(400);
      expect(
        warnedWith('MCP 2026-07-28 request without MCP-Protocol-Version'),
      ).toStrictEqual([]);
    },
  );

  it.each([
    ['null elements', Array.from({ length: 101 }, () => null)],
    [
      '2026-07-28 messages',
      Array.from({ length: 101 }, (_, i) => ({
        jsonrpc: '2.0',
        id: i + 1,
        method: 'tools/list',
        params: { _meta: MODERN_META },
      })),
    ],
  ])(
    'does not log a 101-message batch of %s, which 2.0.0 already rejects',
    async (_case, body) => {
      const res = await post(body);

      expect(res.status).toBe(400);
      expect(warnedWith('MCP batch over 100 messages')).toStrictEqual([]);
    },
  );

  it('does not log a 2025-era request without MCP-Protocol-Version', async () => {
    await post({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'compat-test', version: '1' },
      },
    });

    expect(
      warnedWith('MCP 2026-07-28 request without MCP-Protocol-Version'),
    ).toStrictEqual([]);
  });
});
