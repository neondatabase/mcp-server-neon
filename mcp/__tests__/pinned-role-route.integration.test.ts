/**
 * The pinned Postgres role end to end through the deployed route: a grant from
 * an OAuth token or from API-key URL params reaches the real tool handlers, and
 * the connection is resolved for that role. The Neon API client and the
 * Postgres driver are fakes that record which role was requested.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GrantContext } from '../utils/grant-context';

process.env.ANALYTICS_WRITE_KEY = '';
process.env.SENTRY_DSN = '';

const PROJECT_ID = 'example-project-123';
const BRANCH_ID = 'br-example-123';
const DATABASE = 'app_db';
const OWNER = 'app_db_owner';
const PINNED = 'mcp_pinned_reader';
const PASSWORD = 'FAKE_TEST_PASSWORD_123';
const API_KEY = 'fake-api-key-for-tests';

const mocks = vi.hoisted(() => {
  const querySpy = vi.fn(async () => [{ session_user: 'mcp_pinned_reader' }]);
  const transactionSpy = vi.fn<
    (queries: unknown[], options?: { readOnly?: boolean }) => Promise<unknown>
  >(async (queries) =>
    queries.map(() => [{ session_user: 'mcp_pinned_reader' }]),
  );
  return {
    querySpy,
    transactionSpy,
    neonSpy: vi.fn((uri: string) => ({
      uri,
      query: querySpy,
      transaction: transactionSpy,
    })),
    getConnectionUri: vi.fn(),
    getProjectBranchDatabase: vi.fn(),
    getAuthDetails: vi.fn(),
    apiKeysGet: vi.fn(),
    trackSpy: vi.fn(),
    captureExceptionSpy: vi.fn(),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      silent: false,
    },
  };
});

vi.mock('@neondatabase/serverless', async () => {
  const actual = await vi.importActual<
    typeof import('@neondatabase/serverless')
  >('@neondatabase/serverless');
  return { ...actual, neon: mocks.neonSpy };
});

vi.mock('../server/api', () => ({
  createNeonClient: () => ({
    listProjectBranches: async () => ({
      data: { branches: [{ id: BRANCH_ID, default: true }] },
    }),
    listProjectBranchDatabases: async () => ({
      data: { databases: [{ name: DATABASE, owner_name: OWNER }] },
    }),
    getProjectBranchDatabase: mocks.getProjectBranchDatabase,
    getConnectionUri: mocks.getConnectionUri,
    getAuthDetails: mocks.getAuthDetails,
  }),
}));

vi.mock('../oauth/model', () => ({
  model: { getAccessToken: vi.fn() },
}));

vi.mock('../oauth/kv-store', async () => {
  const actual =
    await vi.importActual<typeof import('../oauth/kv-store')>(
      '../oauth/kv-store',
    );
  return {
    ...actual,
    getApiKeys: () => ({
      get: mocks.apiKeysGet,
      set: vi.fn().mockResolvedValue(undefined),
    }),
  };
});

vi.mock('../analytics/analytics', () => ({
  track: mocks.trackSpy,
  flushAnalytics: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@sentry/node', async () => {
  const actual =
    await vi.importActual<typeof import('@sentry/node')>('@sentry/node');
  return { ...actual, captureException: mocks.captureExceptionSpy };
});

vi.mock('../utils/logger', () => ({ logger: mocks.logger }));

const { model } = await import('../oauth/model');
const { POST } = await import('../../app/api/[transport]/route');

function oauthToken(accessToken: string, scope: string, grant?: GrantContext) {
  return {
    accessToken,
    scope,
    client: { id: 'client-1', client_name: 'Test Client', grants: ['*'] },
    user: { id: 'user-1', name: 'User', email: 'user@example.com' },
    grant,
  } as unknown as Awaited<ReturnType<typeof model.getAccessToken>>;
}

async function mcpCall(
  bearerToken: string,
  method: string,
  params: unknown,
  queryString = '',
) {
  const res = await POST(
    new Request(`http://localhost/api/mcp${queryString}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }),
  );
  const raw = await res.text();
  const dataLine = raw
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .at(-1);
  let body: unknown = raw;
  try {
    body = JSON.parse(dataLine ? dataLine.slice('data: '.length) : raw);
  } catch {
    // keep raw
  }
  return { status: res.status, raw, body };
}

type ToolCallBody = {
  result?: { content: Array<{ text?: string }>; isError?: boolean };
  error?: unknown;
};

async function runSql(
  bearerToken: string,
  args: Record<string, unknown>,
  queryString = '',
) {
  const response = await mcpCall(
    bearerToken,
    'tools/call',
    { name: 'run_sql', arguments: { project_id: PROJECT_ID, ...args } },
    queryString,
  );
  return { ...response, body: response.body as ToolCallBody };
}

async function listToolNames(bearerToken: string, queryString = '') {
  const response = await mcpCall(bearerToken, 'tools/list', {}, queryString);
  const body = response.body as { result: { tools: Array<{ name: string }> } };
  return body.result.tools.map((tool) => tool.name);
}

function requestedRoles(): string[] {
  return mocks.getConnectionUri.mock.calls.map(
    (call) => (call[0] as { role_name: string }).role_name,
  );
}

function everythingRecorded(): string {
  return JSON.stringify([
    mocks.trackSpy.mock.calls,
    mocks.captureExceptionSpy.mock.calls,
    Object.values(mocks.logger).map((spy) =>
      typeof spy === 'function' ? spy.mock.calls : [],
    ),
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getConnectionUri.mockImplementation(
    async ({ role_name }: { role_name: string }) => ({
      data: {
        uri: `postgresql://${role_name}:${PASSWORD}@ep-example-123.example.test/${DATABASE}`,
      },
    }),
  );
  mocks.getProjectBranchDatabase.mockResolvedValue({
    data: { database: { name: DATABASE, owner_name: OWNER } },
  });
  mocks.apiKeysGet.mockResolvedValue({
    apiKey: API_KEY,
    authMethod: 'api_key_user',
    account: { id: 'user-1', name: 'User' },
  });
});

describe('pinned role through the MCP route', () => {
  describe('OAuth token grant', () => {
    it('runs SQL as the pinned role and leaks no credentials', async () => {
      vi.mocked(model.getAccessToken).mockResolvedValue(
        oauthToken('oauth-pinned', 'read', {
          projectId: null,
          scopes: null,
          roleName: PINNED,
        }),
      );

      const { status, raw, body } = await runSql('oauth-pinned', {
        sql: 'SELECT session_user, current_user',
      });

      expect(status).toBe(200);
      expect(body.result?.isError).toBeFalsy();
      expect(requestedRoles()).toEqual([PINNED]);
      expect(mocks.getProjectBranchDatabase).not.toHaveBeenCalled();
      // Read-only token: the pinned query is still in a read-only transaction.
      expect(mocks.transactionSpy).toHaveBeenCalledWith(expect.any(Array), {
        readOnly: true,
      });
      expect(raw).not.toContain(PASSWORD);
      expect(raw).not.toMatch(/postgres(ql)?:\/\//);
      expect(everythingRecorded()).not.toContain(PASSWORD);
    });

    it('ignores a roleName on the URL; the token grant decides', async () => {
      vi.mocked(model.getAccessToken).mockResolvedValue(
        oauthToken('oauth-pinned', 'read write', {
          projectId: null,
          scopes: null,
          roleName: PINNED,
        }),
      );

      await runSql('oauth-pinned', { sql: 'SELECT 1' }, `?roleName=${OWNER}`);

      expect(requestedRoles()).toEqual([PINNED]);
    });

    it('rejects a role_name argument that differs from the pin', async () => {
      vi.mocked(model.getAccessToken).mockResolvedValue(
        oauthToken('oauth-pinned', 'read write', {
          projectId: null,
          scopes: null,
          roleName: PINNED,
        }),
      );

      const { body, raw } = await runSql('oauth-pinned', {
        sql: 'SELECT 1',
        role_name: OWNER,
      });

      expect(body.result?.isError).toBe(true);
      expect(raw).toContain('pinned to Postgres role');
      expect(mocks.getConnectionUri).not.toHaveBeenCalled();
      expect(mocks.neonSpy).not.toHaveBeenCalled();
    });

    it('does not list get_connection_string on a pinned token', async () => {
      vi.mocked(model.getAccessToken).mockResolvedValue(
        oauthToken('oauth-pinned', 'read write', {
          projectId: null,
          scopes: null,
          roleName: PINNED,
        }),
      );
      const pinned = await listToolNames('oauth-pinned');
      expect(pinned).toContain('run_sql');
      expect(pinned).not.toContain('get_connection_string');

      vi.mocked(model.getAccessToken).mockResolvedValue(
        oauthToken('oauth-unpinned', 'read write', {
          projectId: null,
          scopes: null,
        }),
      );
      expect(await listToolNames('oauth-unpinned')).toContain(
        'get_connection_string',
      );
    });

    it('keeps the database owner for a legacy token without roleName', async () => {
      vi.mocked(model.getAccessToken).mockResolvedValue(
        oauthToken('oauth-legacy', 'read write'),
      );

      await runSql('oauth-legacy', { sql: 'SELECT 1' });

      expect(requestedRoles()).toEqual([OWNER]);
    });

    it('refuses a token whose stored roleName is invalid instead of falling back to the API-key path', async () => {
      vi.mocked(model.getAccessToken).mockResolvedValue(
        oauthToken('oauth-corrupt', 'read write', {
          projectId: null,
          scopes: null,
          roleName: 'not a role',
        }),
      );

      const { status } = await runSql('oauth-corrupt', { sql: 'SELECT 1' });

      expect(status).toBe(401);
      expect(mocks.apiKeysGet).not.toHaveBeenCalled();
      expect(mocks.getAuthDetails).not.toHaveBeenCalled();
      expect(mocks.getConnectionUri).not.toHaveBeenCalled();
    });
  });

  describe('API-key URL params', () => {
    beforeEach(() => {
      vi.mocked(model.getAccessToken).mockResolvedValue(undefined);
    });

    it('runs SQL as ?roleName and keeps ?readonly=true wrapping', async () => {
      const { raw } = await runSql(
        API_KEY,
        { sql: 'SELECT session_user' },
        `?readonly=true&roleName=${PINNED}`,
      );

      expect(requestedRoles()).toEqual([PINNED]);
      expect(mocks.transactionSpy).toHaveBeenCalledWith(expect.any(Array), {
        readOnly: true,
      });
      expect(raw).not.toContain(PASSWORD);
      expect(everythingRecorded()).not.toContain(PASSWORD);
    });

    it('uses the database owner without ?roleName', async () => {
      await runSql(API_KEY, { sql: 'SELECT 1' }, '?readonly=true');
      expect(requestedRoles()).toEqual([OWNER]);
    });

    it.each(['roleName=', 'roleName=a-b', 'roleName=a&roleName=b'])(
      'rejects a malformed pin (%s) before authenticating',
      async (query) => {
        const { status, body } = await runSql(
          API_KEY,
          { sql: 'SELECT 1' },
          `?readonly=true&${query}`,
        );

        expect(status).toBe(400);
        expect(body).toEqual(
          expect.objectContaining({ error: 'invalid_request' }),
        );
        expect(mocks.apiKeysGet).not.toHaveBeenCalled();
        expect(mocks.getConnectionUri).not.toHaveBeenCalled();
      },
    );
  });
});
