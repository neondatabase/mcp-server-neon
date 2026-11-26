/**
 * The pinned Postgres role end to end through the deployed route: a grant from
 * an OAuth token or from API-key URL params reaches the real tool handlers, and
 * the connection is resolved for that role. OAuth tokens are saved in the test
 * Postgres database. A loopback server answers the Neon API and the SQL
 * endpoint, records which role was requested, and collects the analytics the
 * server sends; Sentry sends to the e2e stand-in.
 */
import { neonConfig } from '@neondatabase/serverless';
import { flush, httpIntegration, init as initSentry } from '@sentry/node';
import { Effect } from 'effect';
import type { Token } from 'oauth2-server';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { GrantContext } from '../utils/grant-context';
import { FAKE_PASSWORD, fakeNeon } from './helpers/fake-neon';
import {
  collectKeepalives,
  segmentCollector,
  serveLoopback,
} from './helpers/loopback';
import {
  listedToolNames,
  mcpRequest,
  responseBody,
} from './helpers/mcp-request';

const PROJECT_ID = 'example-project-123';
const BRANCH_ID = 'br-example-123';
const DATABASE = 'app_db';
const OWNER = 'app_db_owner';
const PINNED = 'mcp_pinned_reader';
const PASSWORD = FAKE_PASSWORD;
const API_KEY = `napi-pinned-role-${crypto.randomUUID()}`;

const neonOptions = {
  projectId: PROJECT_ID,
  branchId: BRANCH_ID,
  database: DATABASE,
  owner: OWNER,
  rows: () => [{ session_user: PINNED }],
  api: (_method: string, path: string) => {
    if (path === '/auth') {
      return Response.json({ auth_method: 'api_key_user', account_id: 'u1' });
    }

    return path === '/users/me'
      ? Response.json({ id: 'user-1', name: 'User', email: 'u@example.com' })
      : undefined;
  },
};

let neon = fakeNeon(neonOptions);

const analytics = segmentCollector();

const upstream = await serveLoopback(async (request) =>
  analytics.isBatch(request) ? analytics.answer(request) : neon.answer(request),
);

const keepalives = collectKeepalives();

Object.assign(process.env, {
  NEON_API_HOST: `${upstream.origin}/api/v2`,
  ANALYTICS_HOST: upstream.origin,
  ANALYTICS_WRITE_KEY: 'pinned-role-route-test-key',
  SENTRY_DSN: '',
  E2E_SENTRY_PORT: '3130',
});

// Imported once the environment is set: lib/config reads it at import.
const { ensureTestOauthDatabase } =
  await import('./ensure-test-oauth-database');

await ensureTestOauthDatabase();

// Set once the real test database is provisioned: its reachability probe and
// schema setup go through the same driver.
neonConfig.fetchEndpoint = `${upstream.origin}/sql`;

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
const { logger } = await import('../utils/logger');

const logged: { readonly message: string }[] = [];

logger.on('data', (info: { readonly message: string }) => {
  logged.push(info);
});

const saveOAuthToken = async (scope: string, grant?: GrantContext) => {
  const token: Token = {
    accessToken: `oauth-pinned-role-${crypto.randomUUID()}`,
    scope,
    client: { id: 'client-1', client_name: 'Test Client', grants: ['*'] },
    user: { id: 'user-1', name: 'User', email: 'user@example.com' },
    grant,
  };

  await Effect.runPromise(
    OAuthStore.pipe(
      Effect.flatMap((store) =>
        store.saveTokenPair({
          token,
          refreshToken: `${token.accessToken}-refresh`,
        }),
      ),
      Effect.provide(OAuthStore.layer),
    ),
  );

  return token.accessToken;
};

const mcpCall = async (
  bearerToken: string,
  request: { readonly method: string; readonly params: z.core.util.JSONType },
  queryString = '',
) => {
  const res = await POST(mcpRequest({ ...request, bearerToken, queryString }));
  const raw = await res.text();

  await keepalives.settle();

  return { status: res.status, raw, body: responseBody(raw) };
};

const ToolCallBody = z.object({
  result: z
    .object({
      content: z.array(z.object({ text: z.string().optional() })),
      isError: z.boolean().optional(),
    })
    .optional(),
});

const runSql = async (
  bearerToken: string,
  args: Record<string, string>,
  queryString = '',
) => {
  const response = await mcpCall(
    bearerToken,
    {
      method: 'tools/call',
      params: {
        name: 'run_sql',
        arguments: { project_id: PROJECT_ID, ...args },
      },
    },
    queryString,
  );

  return { ...response, result: ToolCallBody.parse(response.body).result };
};

const listToolNames = async (bearerToken: string) => {
  const { body } = await mcpCall(bearerToken, {
    method: 'tools/list',
    params: {},
  });

  return listedToolNames(body);
};

const SentryItems = z.array(z.json());

/** Every event, Sentry item, and log line the server produced in this test. */
const everythingRecorded = async () => {
  await flush(5000);

  const sentry = await fetch(SENTRY_FIXTURE_ITEMS_URL);

  return JSON.stringify([
    analytics.delivered,
    SentryItems.parse(await sentry.json()),
    logged,
  ]);
};

const authRequests = () =>
  neon.api.filter((request) => request.path === '/auth');

describe('pinned role through the MCP route', () => {
  beforeEach(() => {
    neon = fakeNeon(neonOptions);
    analytics.delivered.length = 0;
    logged.length = 0;
  });

  describe('OAuth token grant', () => {
    it('runs SQL as the pinned role and leaks no credentials', async () => {
      const token = await saveOAuthToken('read', {
        projectId: null,
        scopes: null,
        roleName: PINNED,
      });

      const { status, raw, result } = await runSql(token, {
        sql: 'SELECT session_user, current_user',
      });

      expect(status).toBe(200);
      expect(result?.isError).not.toBe(true);
      expect(neon.requestedRoles()).toStrictEqual([PINNED]);
      expect(neon.ownerLookups()).toStrictEqual([]);
      // Read-only token: the pinned query is still in a read-only transaction.
      expect(neon.sql).toStrictEqual([
        expect.objectContaining({
          role: PINNED,
          transaction: true,
          readOnly: true,
        }),
      ]);
      expect(raw).not.toContain(PASSWORD);
      expect(raw).not.toMatch(/postgres(?:ql)?:\/\//u);
      expect(analytics.delivered).not.toStrictEqual([]);
      await expect(everythingRecorded()).resolves.not.toContain(PASSWORD);
    });

    it('ignores a roleName on the URL; the token grant decides', async () => {
      const token = await saveOAuthToken('read write', {
        projectId: null,
        scopes: null,
        roleName: PINNED,
      });

      await runSql(token, { sql: 'SELECT 1' }, `?roleName=${OWNER}`);

      expect(neon.requestedRoles()).toStrictEqual([PINNED]);
    });

    it('rejects a role_name argument that differs from the pin', async () => {
      const token = await saveOAuthToken('read write', {
        projectId: null,
        scopes: null,
        roleName: PINNED,
      });

      const { result, raw } = await runSql(token, {
        sql: 'SELECT 1',
        role_name: OWNER,
      });

      expect(result?.isError).toBe(true);
      expect(raw).toContain('pinned to Postgres role');
      expect(neon.connectionUriRequests()).toStrictEqual([]);
      expect(neon.sql).toStrictEqual([]);
    });

    it('does not list get_connection_string on a pinned token', async () => {
      const pinned = await listToolNames(
        await saveOAuthToken('read write', {
          projectId: null,
          scopes: null,
          roleName: PINNED,
        }),
      );

      expect(pinned).toContain('run_sql');
      expect(pinned).not.toContain('get_connection_string');

      const unpinned = await listToolNames(
        await saveOAuthToken('read write', { projectId: null, scopes: null }),
      );

      expect(unpinned).toContain('get_connection_string');
    });

    it('keeps the database owner for a legacy token without roleName', async () => {
      const token = await saveOAuthToken('read write');

      await runSql(token, { sql: 'SELECT 1' });

      expect(neon.requestedRoles()).toStrictEqual([OWNER]);
    });

    it('refuses a token whose stored roleName is invalid instead of falling back to the API-key path', async () => {
      const token = await saveOAuthToken('read write', {
        projectId: null,
        scopes: null,
        roleName: 'not a role',
      });

      const { status } = await runSql(token, { sql: 'SELECT 1' });

      expect(status).toBe(401);
      // No cache holds this bearer, so the API-key path would ask Neon.
      expect(authRequests()).toStrictEqual([]);
      expect(neon.connectionUriRequests()).toStrictEqual([]);
    });
  });

  describe('API-key URL params', () => {
    it('runs SQL as ?roleName and keeps ?readonly=true wrapping', async () => {
      const { raw } = await runSql(
        API_KEY,
        { sql: 'SELECT session_user' },
        `?readonly=true&roleName=${PINNED}`,
      );

      expect(neon.requestedRoles()).toStrictEqual([PINNED]);
      expect(neon.sql).toStrictEqual([
        expect.objectContaining({
          role: PINNED,
          transaction: true,
          readOnly: true,
        }),
      ]);
      expect(raw).not.toContain(PASSWORD);
      await expect(everythingRecorded()).resolves.not.toContain(PASSWORD);
    });

    it('uses the database owner without ?roleName', async () => {
      await runSql(API_KEY, { sql: 'SELECT 1' }, '?readonly=true');

      expect(neon.requestedRoles()).toStrictEqual([OWNER]);
    });

    it.each(['roleName=', 'roleName=a-b', 'roleName=a&roleName=b'])(
      'rejects a malformed pin (%s) before authenticating',
      async (query) => {
        // No earlier request verified this key, so authenticating it would ask Neon.
        const { status, body } = await mcpCall(
          `napi-unverified-${crypto.randomUUID()}`,
          {
            method: 'tools/call',
            params: {
              name: 'run_sql',
              arguments: { project_id: PROJECT_ID, sql: 'SELECT 1' },
            },
          },
          `?readonly=true&${query}`,
        );

        expect(status).toBe(400);
        expect(body).toStrictEqual(
          expect.objectContaining({ error: 'invalid_request' }),
        );
        expect(authRequests()).toStrictEqual([]);
        expect(neon.connectionUriRequests()).toStrictEqual([]);
      },
    );
  });
});
