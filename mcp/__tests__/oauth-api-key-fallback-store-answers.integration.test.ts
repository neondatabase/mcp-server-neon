/**
 * An OAuth bearer or API key on the MCP transport while the token store
 * answers: the real store and API-key cache in the test Postgres database, a
 * loopback Neon API that verifies each bearer, and a Segment collector.
 * `oauth-api-key-fallback.integration.test.ts` covers the store being down.
 */
import { Effect } from 'effect';
import type { GrantContext } from '../utils/grant-context';
import { describe, expect, it } from 'vitest';
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
import { neonAuthStandIn } from './helpers/neon-auth';

const neon = neonAuthStandIn();
const analytics = segmentCollector();

const upstream = await serveLoopback(async (request) =>
  analytics.isBatch(request) ? analytics.answer(request) : neon.answer(request),
);

const keepalives = collectKeepalives();

Object.assign(process.env, {
  NEON_API_HOST: `${upstream.origin}/api/v2`,
  ANALYTICS_HOST: upstream.origin,
  ANALYTICS_WRITE_KEY: 'api-key-fallback-test-key',
  SENTRY_DSN: '',
});

// Imported once the environment is set: lib/config reads it at import.
const { ensureTestOauthDatabase } =
  await import('./ensure-test-oauth-database');

await ensureTestOauthDatabase();

const { POST, HEAD } = await import('../../app/api/[transport]/route');
const { OAuthStore } = await import('../oauth/oauth-store');

const uniqueId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

const saveOAuthToken = async (scope: string, grant: GrantContext) => {
  const accessToken = uniqueId('oauth-bearer');

  await Effect.runPromise(
    OAuthStore.pipe(
      Effect.flatMap((store) =>
        store.saveTokenPair({
          token: {
            accessToken,
            scope,
            client: { id: 'client-1', client_name: 'Cursor', grants: ['*'] },
            user: { id: 'user-1', name: 'User', email: 'u@x.dev' },
            grant,
          },
          refreshToken: `${accessToken}-refresh`,
        }),
      ),
      Effect.provide(OAuthStore.layer),
    ),
  );

  return accessToken;
};

const listTools = async (bearerToken: string, queryString = '') => {
  const res = await POST(
    mcpRequest({ method: 'tools/list', bearerToken, queryString }),
  );

  const body = responseBody(await res.text());

  await keepalives.settle();

  return { res, body };
};

const identified = (userId: string) =>
  analytics.delivered.filter(
    (event) => event.type === 'identify' && event.userId === userId,
  );

describe('OAuth bearer on the API-key path while the token store answers', () => {
  it('keeps the stored read-only grant when the token store answers', async () => {
    const bearer = await saveOAuthToken('read', {
      projectId: null,
      scopes: null,
    });

    const { res, body } = await listTools(bearer, '?readonly=false');

    expect(res.status).toBe(200);
    expect(listedToolNames(body)).toContain('run_sql');
    expect(listedToolNames(body)).not.toContain('create_project');
    expect(neon.requestedWith(bearer)).toStrictEqual([]);
  });

  it('identifies the account behind an API key on a cache miss only', async () => {
    const apiKey = uniqueId('napi-identify');
    const accountId = uniqueId('user');

    neon.callers.set(apiKey, { authMethod: 'api_key_user', accountId });

    const miss = await listTools(apiKey);

    const [identify, ...others] = identified(accountId);

    expect(miss.res.status).toBe(200);
    expect(others).toStrictEqual([]);
    expect(identify?.traits).toStrictEqual({
      name: 'User',
      email: 'u@x.dev',
      isOrg: false,
    });
    expect(identify?.context).toMatchObject({ authMethod: 'api_key_user' });

    // The miss cached the key before its keepalives settled.
    const hit = await listTools(apiKey);

    expect(hit.res.status).toBe(200);
    expect(identified(accountId)).toHaveLength(1);
    expect(neon.requestedWith(apiKey)).toStrictEqual(['/auth', '/users/me']);
  });

  it('answers 401 with the OAuth challenge when the store has no record', async () => {
    const bearer = uniqueId('oauth-unknown');

    neon.callers.set(bearer, { authMethod: 'oauth', accountId: 'user-1' });

    const { res } = await listTools(bearer);

    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toContain('Bearer');
    expect(res.headers.get('WWW-Authenticate')).toContain('resource_metadata=');
  });

  it.each(['/mcp', '/api/mcp'])(
    'answers HEAD %s with an empty 401 when the record is missing',
    async (path) => {
      const bearer = uniqueId('oauth-unknown');

      neon.callers.set(bearer, { authMethod: 'oauth', accountId: 'user-1' });

      const missing = await HEAD(
        new Request(`http://localhost${path}`, {
          method: 'HEAD',
          headers: { Authorization: `Bearer ${bearer}` },
        }),
      );

      expect(missing.status).toBe(401);
      expect(missing.headers.get('WWW-Authenticate')).toContain(
        'resource_metadata=',
      );
      await expect(missing.text()).resolves.toBe('');
    },
  );

  it('keeps an API key without a token-store record on its URL grant', async () => {
    const apiKey = uniqueId('napi-org');

    neon.callers.set(apiKey, {
      authMethod: 'api_key_org',
      accountId: uniqueId('org'),
    });

    const { res, body } = await listTools(apiKey, '?projectId=proj-1');

    expect(res.status).toBe(200);
    expect(listedToolNames(body)).not.toContain('list_projects');
    expect(listedToolNames(body)).toContain('run_sql');
  });
});
