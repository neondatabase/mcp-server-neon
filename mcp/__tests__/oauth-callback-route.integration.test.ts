/**
 * /callback on the real OAuth Postgres store and auth transactions, with a
 * local Neon API answering the account lookup. Upstream Hydra and analytics
 * are recording layers; a test that needs a store failure replaces one store
 * operation with one that fails the way the store does.
 */
import { neon } from '@neondatabase/serverless';
import { init } from '@sentry/node';
import { Effect, Layer, Option, Predicate } from 'effect';
import { HttpRouter } from 'effect/http';
import he from 'he';
import type { AuthorizationCode } from 'oauth2-server';
import type {
  TokenEndpointResponse,
  TokenEndpointResponseHelpers,
} from 'openid-client';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { SERVER_HOST } from '../../lib/config';
import { ClientMetadataUnavailableError } from '../../lib/oauth/client-id-metadata-document';
import { ClientMetadataUnavailable } from '../../lib/oauth/client-metadata-unavailable';
import { UpstreamOAuth } from '../../lib/oauth/upstream-oauth';
import { UpstreamOAuthFailed } from '../../lib/oauth/upstream-oauth-failed';
import { Analytics } from '../analytics/analytics-service';
import {
  authTransactions,
  createAuthTransactionStore,
} from '../oauth/auth-transaction-store';
import { consentCookieName } from '../oauth/browser-binding';
import { AUTH_RESTART_DESCRIPTION } from '../oauth/consent-html-headers';
import { OAuthStore } from '../oauth/oauth-store';
import { OAuthStoreUnavailable } from '../oauth/oauth-store-unavailable';
import { retryPgConnect } from '../oauth/pg-connect-retry';
import { logger } from '../utils/logger';
import {
  seedApprovedTransaction,
  seedPendingTransaction,
} from './auth-transaction-fixtures';
import { OAuthTestApp } from './helpers/oauth-app';

// Server failures the route answers still reach Sentry; these record which.
const reported: string[] = [];

init({
  dsn: 'http://public@127.0.0.1:1/1',
  beforeSend: (event) => {
    reported.push(event.exception?.values?.at(-1)?.type ?? 'unknown');

    return null;
  },
});

// A local Neon API answers the account lookup for the upstream access token.
await vi.hoisted(async () => {
  const { createServer } = await import('node:http');
  const { EventEmitter } = await import('node:events');
  const { Predicate: P } = await import('effect');

  const answers = new Map<string, object>([
    ['/api/v2/auth', { auth_method: 'oauth', account_id: 'user-1' }],
    [
      '/api/v2/users/me',
      { id: 'user-1', name: 'User', last_name: '', email: 'user@example.com' },
    ],
  ]);

  const api = createServer((req, res) => {
    const answer = answers.get(req.url ?? '');

    res.writeHead(answer === undefined ? 404 : 200, {
      'content-type': 'application/json',
    });
    res.end(JSON.stringify(answer ?? { message: 'not found' }));
  });

  api.listen(0, '127.0.0.1');
  await EventEmitter.once(api, 'listening');
  api.unref();

  const address = api.address();

  const port = address === null || P.isString(address) ? 0 : address.port;

  process.env.NEON_API_HOST = `http://127.0.0.1:${port}/api/v2`;
});

const CLIENT_ID = `callback-route-${crypto.randomUUID()}`;

const CLIENT = {
  id: CLIENT_ID,
  client_name: 'Callback Test Client',
  redirect_uris: ['http://127.0.0.1:55667/callback'],
  grants: ['authorization_code', 'refresh_token'],
};

const REQUEST = {
  responseType: 'code',
  clientId: CLIENT_ID,
  redirectUri: 'http://127.0.0.1:55667/callback',
  scope: ['read', 'write'],
  state: 'client-state',
};

type StoreOperations = typeof OAuthStore.Service;

type Tracked = Parameters<(typeof Analytics.Service)['track']>[0];

type UpstreamResponse = TokenEndpointResponse & TokenEndpointResponseHelpers;

const assertUpstreamResponse: (
  value: unknown,
) => asserts value is UpstreamResponse = (value) => {
  if (!Predicate.hasProperty(value, 'expiresIn')) {
    throw new Error('not an upstream token response');
  }
};

// Shaped like openid-client's response: `expiresIn` is a non-enumerable
// helper, so code that copies the tokens with a spread loses it.
const upstreamTokens = (fields: { refresh_token?: string }) => {
  const tokens = Object.defineProperties(
    {
      access_token: 'upstream-access',
      id_token: 'upstream-id-token',
      token_type: 'bearer',
      ...fields,
    },
    {
      expiresIn: { value: () => 3600 },
      claims: { value: () => undefined },
    },
  );

  assertUpstreamResponse(tokens);

  return tokens;
};

/** The code exchange failing the way openid-client reports a Hydra error. */
const rejectedExchange = (
  message: string,
  fields: {
    readonly status: number;
    readonly error: string;
    readonly error_description: string;
  },
) =>
  UpstreamOAuthFailed.make({
    operation: 'exchangeCode',
    cause: Object.assign(new Error(message), fields),
  });

const storeFailure = (operation: string, cause: Error) =>
  OAuthStoreUnavailable.make({ operation, cause });

const handlers: { readonly dispose: () => Promise<void> }[] = [];

/**
 * The OAuth app on its real store, with `store` replacing some of its
 * operations, an upstream whose code exchange answers `exchange`, and
 * analytics that records what it would send.
 */
const callbackApp = (
  input: {
    readonly exchange?: Effect.Effect<UpstreamResponse, UpstreamOAuthFailed>;
    readonly store?: (real: StoreOperations) => Partial<StoreOperations>;
  } = {},
) => {
  const exchange =
    input.exchange ??
    Effect.sync(() => upstreamTokens({ refresh_token: 'upstream-refresh' }));
  const exchanges: { readonly currentUrl: URL; readonly state: string }[] = [];
  const savedCodes: AuthorizationCode[] = [];
  const tracked: Tracked[] = [];

  const store = Layer.effect(
    OAuthStore,
    OAuthStore.make.pipe(
      Effect.map((real) =>
        OAuthStore.of({
          ...real,
          saveAuthorizationCode: (save) =>
            real.saveAuthorizationCode(save).pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  savedCodes.push(save.code);
                }),
              ),
            ),
          ...input.store?.(real),
        }),
      ),
    ),
  );

  const notUsed = Effect.die(new Error('/callback does not call this'));

  const upstream = Layer.succeed(
    UpstreamOAuth,
    UpstreamOAuth.of({
      authorizationUrl: () => notUsed,
      exchangeCode: (request) =>
        Effect.sync(() => {
          exchanges.push(request);
        }).pipe(Effect.andThen(exchange)),
      exchangeRefreshToken: () => notUsed,
    }),
  );

  const analytics = Layer.succeed(
    Analytics,
    Analytics.of({
      track: (event) =>
        Effect.sync(() => {
          tracked.push(event);
        }),
      identify: () => Effect.void,
    }),
  );

  const handler = HttpRouter.toWebHandler(
    Layer.mergeAll(OAuthTestApp, store, upstream, analytics),
    { disableLogger: true },
  );

  handlers.push(handler);

  return { handler: handler.handler, exchanges, savedCodes, tracked };
};

const clientLookupFailingOnce =
  (error: OAuthStoreUnavailable | ClientMetadataUnavailable) =>
  (real: StoreOperations): Partial<StoreOperations> => {
    const lookups = { count: 0 };

    return {
      findClient: (lookup) =>
        Effect.suspend(() => {
          lookups.count += 1;

          return lookups.count === 1
            ? Effect.fail(error)
            : real.findClient(lookup);
        }),
    };
  };

const onStore = async <A, E>(
  run: (store: StoreOperations) => Effect.Effect<A, E>,
) =>
  Effect.runPromise(
    OAuthStore.pipe(Effect.flatMap(run), Effect.provide(OAuthStore.layer)),
  );

/** The authorization code a redirect hands the client, as stored. */
const storedCode = async (response: Response) => {
  const location = new URL(response.headers.get('location') ?? '');

  return onStore((store) =>
    store.findAuthorizationCode({
      code: location.searchParams.get('code') ?? '',
    }),
  );
};

const seedApproved = async (
  options: Parameters<typeof seedApprovedTransaction>[0] = {},
) => seedApprovedTransaction({ request: REQUEST, ...options });

const logged: string[] = [];

logger.on('data', (info: { message: string }) => {
  logged.push(info.message);
});

/** This test's `[SLO] auth-callback` line for `outcome`, if any. */
const findSloLine = (outcome = '') =>
  logged.find((message) =>
    message.startsWith(`[SLO] auth-callback outcome=${outcome}`),
  );

const app = callbackApp();

function buildRequest(state: string, cookie: string): Request {
  const url = `http://localhost/callback?code=upstream-code&state=${encodeURIComponent(state)}`;
  return new Request(url, {
    method: 'GET',
    headers: { cookie },
  });
}

function buildErrorRequest(
  state: string,
  cookie: string,
  error: string,
  errorDescription?: string,
): Request {
  const qs = new URLSearchParams({ error, state });
  if (errorDescription) qs.set('error_description', errorDescription);
  return new Request(`http://localhost/callback?${qs.toString()}`, {
    method: 'GET',
    headers: { cookie },
  });
}

describe('/callback route integration', () => {
  beforeAll(async () => {
    await onStore((store) =>
      store.saveClient({ client: CLIENT, registerHeaders: {} }),
    );
  });

  beforeEach(() => {
    logged.length = 0;
    app.exchanges.length = 0;
    app.savedCodes.length = 0;
    app.tracked.length = 0;
  });

  afterAll(async () => {
    await Promise.all(handlers.map(async (handler) => handler.dispose()));
  });

  it('answers a missing upstream refresh token with 502 and reports it', async () => {
    const withoutRefresh = callbackApp({
      exchange: Effect.sync(() => upstreamTokens({})),
    });
    reported.length = 0;

    const seeded = await seedApproved();
    const response = await withoutRefresh.handler(
      buildRequest(seeded.id, seeded.cookie),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toStrictEqual({
      error: 'server_error',
      error_description: 'Upstream did not issue a refresh token',
    });
    await vi.waitFor(() => {
      expect(reported).toStrictEqual(['UpstreamRefreshTokenMissing']);
    });
  });

  it('persists the approved grant and scopes from the transaction', async () => {
    const seeded = await seedApproved({
      request: {
        responseType: 'code',
        clientId: CLIENT_ID,
        redirectUri: 'http://127.0.0.1:55667/callback',
        scope: ['read', 'write'],
        state: 'client-state',
        resource:
          'https://mcp.neon.tech/mcp?projectId=proj-123&category=querying,schema',
      },
      approvedGrant: {
        projectId: 'proj-123',
        scopes: ['querying', 'schema'],
      },
      approvedScopes: ['read'],
    });

    const response = await app.handler(buildRequest(seeded.id, seeded.cookie));

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get('location')!);
    expect(location.origin + location.pathname).toBe(
      'http://127.0.0.1:55667/callback',
    );
    expect(location.searchParams.get('code')).toBeTruthy();
    expect(location.searchParams.get('state')).toBe('client-state');
    expect(location.searchParams.get('iss')).toBe(SERVER_HOST);
    expect(app.exchanges.map(({ state }) => state)).toStrictEqual([seeded.id]);
    expect(app.exchanges[0]?.currentUrl).toBeInstanceOf(URL);
    await expect(storedCode(response)).resolves.toMatchObject(
      Option.some({
        scope: 'read',
        grant: {
          projectId: 'proj-123',
          scopes: ['querying', 'schema'],
        },
      }),
    );
  });

  it('keeps the approved transaction when the client metadata document is unreadable, so the callback can be retried', async () => {
    const seeded = await seedApproved();
    const unreadable = callbackApp({
      store: clientLookupFailingOnce(
        ClientMetadataUnavailable.make({
          cause: new ClientMetadataUnavailableError('answered 502'),
        }),
      ),
    });

    const failed = await unreadable.handler(
      buildRequest(seeded.id, seeded.cookie),
    );
    expect(failed.status).toBe(503);
    expect(unreadable.exchanges).toStrictEqual([]);
    expect(await authTransactions.getById(seeded.id)).toBeDefined();

    const retried = await unreadable.handler(
      buildRequest(seeded.id, seeded.cookie),
    );
    expect(retried.status).toBe(307);
    expect(unreadable.exchanges).toHaveLength(1);
  });

  it('completes a transaction approved before the cookie prefix over HTTPS with its unprefixed cookie', async () => {
    const seeded = await seedApproved();
    const response = await app.handler(
      new Request(
        `http://localhost/callback?code=upstream-code&state=${seeded.id}`,
        {
          method: 'GET',
          headers: { cookie: seeded.cookie, 'x-forwarded-proto': 'https' },
        },
      ),
    );

    expect(response.status).toBe(307);
    expect(app.savedCodes).toHaveLength(1);
  });

  it('rejects an HTTPS transaction whose prefixed binding is planted as an unprefixed cookie value', async () => {
    const seeded = await seedApproved({ hostPrefixedCookie: true });
    const planted = `${consentCookieName(seeded.id, false)}=__Host-:${seeded.browserSecret}`;
    const response = await app.handler(
      new Request(
        `http://localhost/callback?code=upstream-code&state=${seeded.id}`,
        {
          method: 'GET',
          headers: { cookie: planted, 'x-forwarded-proto': 'https' },
        },
      ),
    );

    expect(response.status).toBe(400);
    expect(app.savedCodes).toStrictEqual([]);

    const genuine = await app.handler(
      new Request(
        `http://localhost/callback?code=upstream-code&state=${seeded.id}`,
        {
          method: 'GET',
          headers: { cookie: seeded.cookie, 'x-forwarded-proto': 'https' },
        },
      ),
    );
    expect(genuine.status).toBe(307);
  });

  it('carries a pinned roleName from the approved transaction onto the authorization code', async () => {
    const seeded = await seedApproved({
      request: {
        responseType: 'code',
        clientId: CLIENT_ID,
        redirectUri: 'http://127.0.0.1:55667/callback',
        scope: ['read'],
        state: 'client-state',
        resource:
          'https://mcp.neon.tech/mcp?readonly=true&roleName=mcp_pinned_reader',
      },
      approvedGrant: {
        projectId: null,
        scopes: null,
        roleName: 'mcp_pinned_reader',
      },
      approvedScopes: ['read'],
    });

    const response = await app.handler(buildRequest(seeded.id, seeded.cookie));

    expect(response.status).toBe(307);
    await expect(storedCode(response)).resolves.toMatchObject(
      Option.some({
        scope: 'read',
        grant: {
          projectId: null,
          scopes: null,
          roleName: 'mcp_pinned_reader',
        },
      }),
    );
  });

  it('preserves * on the issued scope when the approved transaction includes it', async () => {
    const seeded = await seedApproved({
      approvedScopes: ['read', 'write', '*'],
    });
    const response = await app.handler(buildRequest(seeded.id, seeded.cookie));
    expect(response.status).toBe(307);
    await expect(storedCode(response)).resolves.toMatchObject(
      Option.some({ scope: 'read write *' }),
    );
  });

  it('rejects unsigned JSON state without minting a code', async () => {
    const state = btoa(
      JSON.stringify({
        responseType: 'code',
        clientId: CLIENT_ID,
        redirectUri: 'https://attacker.example/callback',
        scope: ['read', 'write'],
        state: 'client-state',
      }),
    );
    const response = await app.handler(buildRequest(state, ''));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_request',
      error_description: AUTH_RESTART_DESCRIPTION,
    });
    expect(app.exchanges).toStrictEqual([]);
    expect(app.savedCodes).toStrictEqual([]);
  });

  it('rejects a pending transaction at callback', async () => {
    const pending = await seedPendingTransaction({ request: REQUEST });
    const response = await app.handler(
      buildRequest(
        pending.transaction.id,
        `neon_mcp_at_${pending.transaction.id}=${pending.browserSecret}`,
      ),
    );
    expect(response.status).toBe(400);
    expect(app.exchanges).toStrictEqual([]);
  });

  it('rejects an expired approved transaction without minting a code', async () => {
    const seeded = await seedApproved();
    const url = process.env.OAUTH_DATABASE_URL;
    if (!url) {
      throw new Error('OAUTH_DATABASE_URL is required');
    }
    const sql = neon(url);
    await sql`
      UPDATE mcpauth.auth_transactions
      SET expires_at = now() - interval '1 minute'
      WHERE id = ${seeded.id}
    `;
    const response = await app.handler(buildRequest(seeded.id, seeded.cookie));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_request',
      error_description: AUTH_RESTART_DESCRIPTION,
    });
    expect(app.exchanges).toStrictEqual([]);
  });

  it('rejects a swapped cookie from another browser', async () => {
    const first = await seedApproved();
    const second = await seedApproved();
    const response = await app.handler(
      buildRequest(
        second.id,
        `${consentCookieName(second.id, false)}=${first.browserSecret}`,
      ),
    );
    expect(response.status).toBe(400);
    expect(app.exchanges).toStrictEqual([]);
  });

  it('lets only one concurrent callback consume the approval', async () => {
    const seeded = await seedApproved();
    const [first, second] = await Promise.all([
      app.handler(buildRequest(seeded.id, seeded.cookie)),
      app.handler(buildRequest(seeded.id, seeded.cookie)),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([307, 400]);
    expect(app.savedCodes).toHaveLength(1);
  });

  it('relays upstream `error=error` to the original client redirect and state', async () => {
    const seeded = await seedApproved();
    const response = await app.handler(
      buildErrorRequest(
        seeded.id,
        seeded.cookie,
        'error',
        'The error is unrecognizable',
      ),
    );

    expect(response.status).toBe(307);
    const url = new URL(response.headers.get('location')!);
    expect(url.origin + url.pathname).toBe('http://127.0.0.1:55667/callback');
    expect(url.searchParams.get('error')).toBe('error');
    expect(url.searchParams.get('state')).toBe('client-state');
    expect(url.searchParams.get('iss')).toBe(SERVER_HOST);
    expect(app.exchanges).toStrictEqual([]);
  });

  it('relays upstream `access_denied` to client redirect_uri', async () => {
    const seeded = await seedApproved();
    const response = await app.handler(
      buildErrorRequest(
        seeded.id,
        seeded.cookie,
        'access_denied',
        'The resource owner denied the request',
      ),
    );
    const url = new URL(response.headers.get('location')!);
    expect(url.searchParams.get('error')).toBe('access_denied');
    expect(url.searchParams.get('state')).toBe('client-state');
  });

  it('does not relay an upstream error using unsigned forged redirect data', async () => {
    const forged = btoa(
      JSON.stringify({
        responseType: 'code',
        clientId: CLIENT_ID,
        redirectUri: 'https://attacker.example/callback',
        scope: ['read', 'write'],
        state: 'stolen',
      }),
    );
    const response = await app.handler(
      buildErrorRequest(forged, '', 'access_denied', 'denied'),
    );
    expect(response.status).toBe(400);
    expect(response.headers.get('location')).toBeNull();
  });

  it('classifies `request_unauthorized` as correct_consent_expired', async () => {
    const seeded = await seedApproved();
    await app.handler(
      buildErrorRequest(
        seeded.id,
        seeded.cookie,
        'request_unauthorized',
        'The login request has expired. Please try again.',
      ),
    );
    const sloLine = findSloLine();
    expect(sloLine).toContain('outcome=correct_consent_expired');
    expect(sloLine).toContain(`clientId=${CLIENT_ID}`);
  });

  it('classifies `request_forbidden` as correct_csrf_mismatch', async () => {
    const seeded = await seedApproved();
    await app.handler(
      buildErrorRequest(
        seeded.id,
        seeded.cookie,
        'request_forbidden',
        'The CSRF value from the token does not match the CSRF value from the data store.',
      ),
    );
    const sloLine = findSloLine();
    expect(sloLine).toContain('outcome=correct_csrf_mismatch');
  });

  it('classifies code-exchange `invalid_grant` as correct_invalid_grant', async () => {
    const rejecting = callbackApp({
      exchange: Effect.fail(
        rejectedExchange('authorization code already used', {
          status: 400,
          error: 'invalid_grant',
          error_description: 'The authorization code has already been used.',
        }),
      ),
    });
    const seeded = await seedApproved();
    const response = await rejecting.handler(
      buildRequest(seeded.id, seeded.cookie),
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    const sloLine = findSloLine();
    expect(sloLine).toContain('outcome=correct_invalid_grant');
    expect(sloLine).toContain(`clientId=${CLIENT_ID}`);
  });

  it('still buckets unknown upstream errors as upstream_other_error', async () => {
    const seeded = await seedApproved();
    await app.handler(
      buildErrorRequest(
        seeded.id,
        seeded.cookie,
        'unmappable_new_code',
        'Something new',
      ),
    );
    const sloLine = findSloLine();
    expect(sloLine).toContain('outcome=upstream_other_error');
  });

  describe('correct_chatgpt_invalid_request (narrow Hydra reclassification)', () => {
    it('classifies `?error=invalid_request` with rURIHost=chatgpt.com as correct_chatgpt_invalid_request', async () => {
      const seeded = await seedApproved({
        request: {
          responseType: 'code',
          clientId: CLIENT_ID,
          redirectUri: 'https://chatgpt.com/connector/oauth/aF1iFlAFZjHP',
          scope: ['read', 'write'],
          state: 'client-state',
          resource: 'https://mcp.neon.tech/mcp',
          codeChallenge: 'pkce-test',
          codeChallengeMethod: 'S256',
        },
      });
      await app.handler(
        buildErrorRequest(
          seeded.id,
          seeded.cookie,
          'invalid_request',
          'The request is missing a required parameter, ...',
        ),
      );
      const sloLine = findSloLine();
      expect(sloLine).toContain('outcome=correct_chatgpt_invalid_request');
      expect(sloLine).toContain('rURIHost=chatgpt.com');
    });

    it('classifies code-exchange `invalid_request` with rURIHost=chatgpt.com as correct_chatgpt_invalid_request', async () => {
      const rejecting = callbackApp({
        exchange: Effect.fail(
          rejectedExchange('bad request', {
            status: 400,
            error: 'invalid_request',
            error_description:
              'The request is missing a required parameter, ...',
          }),
        ),
      });
      const seeded = await seedApproved({
        request: {
          responseType: 'code',
          clientId: CLIENT_ID,
          redirectUri: 'https://chatgpt.com/connector/oauth/aF1iFlAFZjHP',
          scope: ['read', 'write'],
          state: 'client-state',
        },
      });
      await rejecting.handler(buildRequest(seeded.id, seeded.cookie));
      const sloLine = findSloLine();
      expect(sloLine).toContain('outcome=correct_chatgpt_invalid_request');
      expect(sloLine).toContain('rURIHost=chatgpt.com');
    });

    it('does NOT reclassify when rURIHost is localhost', async () => {
      const seeded = await seedApproved({
        request: {
          responseType: 'code',
          clientId: CLIENT_ID,
          redirectUri: 'http://localhost:55667/oauth/callback',
          scope: ['read', 'write'],
          state: 'client-state',
        },
      });
      await app.handler(
        buildErrorRequest(
          seeded.id,
          seeded.cookie,
          'invalid_request',
          'malformed redirect_uri',
        ),
      );
      const sloLine = findSloLine();
      expect(sloLine).toContain('outcome=upstream_other_error');
      expect(sloLine).toContain('rURIHost=localhost');
    });

    it('does NOT reclassify when rURIHost is some other 3rd-party connector', async () => {
      const seeded = await seedApproved({
        request: {
          responseType: 'code',
          clientId: CLIENT_ID,
          redirectUri: 'https://tasklet.ai/oauth/callback',
          scope: ['read', 'write'],
          state: 'client-state',
        },
      });
      await app.handler(
        buildErrorRequest(
          seeded.id,
          seeded.cookie,
          'invalid_request',
          'bad params',
        ),
      );
      const sloLine = findSloLine();
      expect(sloLine).toContain('outcome=upstream_other_error');
      expect(sloLine).toContain('rURIHost=tasklet.ai');
    });

    it('does NOT reclassify when chatgpt.com hits a non-invalid_request error', async () => {
      const seeded = await seedApproved({
        request: {
          responseType: 'code',
          clientId: CLIENT_ID,
          redirectUri: 'https://chatgpt.com/connector/oauth/aF1iFlAFZjHP',
          scope: ['read', 'write'],
          state: 'client-state',
        },
      });
      await app.handler(
        buildErrorRequest(
          seeded.id,
          seeded.cookie,
          'request_forbidden',
          'The CSRF value from the token does not match the CSRF value from the data store.',
        ),
      );
      const sloLine = findSloLine();
      expect(sloLine).toContain('outcome=correct_csrf_mismatch');
    });
  });

  describe('downstream-request fingerprint on upstream errors', () => {
    it('emits stateLen, stateFp, scopeCount and redirectUri host/path', async () => {
      const seeded = await seedApproved({
        request: {
          responseType: 'code',
          clientId: CLIENT_ID,
          redirectUri: 'http://127.0.0.1:55667/callback',
          scope: ['read', 'write'],
          state: 'client-state',
          resource: 'https://mcp.neon.tech/mcp?projectId=p-1',
          codeChallenge: 'pkce-abc',
          codeChallengeMethod: 'S256',
        },
      });
      await app.handler(
        buildErrorRequest(
          seeded.id,
          seeded.cookie,
          'invalid_request',
          'The request is missing a required parameter, ...',
        ),
      );
      const sloLine = findSloLine();
      expect(sloLine).toContain(`stateLen=${seeded.id.length}`);
      expect(sloLine).toContain(
        `stateFp=len=${seeded.id.length},prefix=${seeded.id.slice(0, 6)}`,
      );
      expect(sloLine).toContain('scopeCount=2');
      expect(sloLine).toContain('rURIHost=127.0.0.1');
      expect(sloLine).toContain('rURIPath=/callback');
      expect(sloLine).toContain('hasResource=1');
      expect(sloLine).toContain('hasPKCE=1');
    });

    it('never includes the downstream client state in the SLO line', async () => {
      const seeded = await seedApproved({
        request: {
          responseType: 'code',
          clientId: CLIENT_ID,
          redirectUri: 'http://127.0.0.1:55667/callback',
          scope: ['read', 'write'],
          state: 'secret-downstream-state-do-not-leak',
        },
      });
      await app.handler(
        buildErrorRequest(
          seeded.id,
          seeded.cookie,
          'invalid_request',
          'malformed',
        ),
      );
      const sloLine = findSloLine();
      expect(sloLine).not.toContain('secret-downstream-state-do-not-leak');
      expect(sloLine).not.toContain(seeded.browserSecret);
    });

    it('includes the fingerprint on the code-exchange catch path too', async () => {
      const rejecting = callbackApp({
        exchange: Effect.fail(
          rejectedExchange('bad request', {
            status: 400,
            error: 'invalid_grant',
            error_description: 'The authorization code has already been used.',
          }),
        ),
      });
      const seeded = await seedApproved();
      await rejecting.handler(buildRequest(seeded.id, seeded.cookie));
      const sloLine = findSloLine();
      expect(sloLine).toContain('outcome=correct_invalid_grant');
      expect(sloLine).toContain(`stateLen=${seeded.id.length}`);
      expect(sloLine).toContain('scopeCount=2');
    });
  });

  it('falls back to JSON 400 when upstream error arrives without state', async () => {
    const response = await app.handler(
      new Request('http://localhost/callback?error=server_error', {
        method: 'GET',
      }),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'server_error',
      error_description: 'Upstream authorization failed',
    });
  });

  it('falls back to JSON 400 when upstream error arrives with un-decodable state', async () => {
    const response = await app.handler(
      new Request(
        'http://localhost/callback?error=invalid_scope&state=not%2Dbase64%21',
        { method: 'GET' },
      ),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: 'invalid_scope',
    });
  });

  it('still returns Missing code or state when nothing useful is in the query', async () => {
    const response = await app.handler(
      new Request('http://localhost/callback', { method: 'GET' }),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_request',
      error_description: 'Missing code or state',
    });
  });

  describe('completion page', () => {
    const appRequest = {
      responseType: 'code',
      clientId: CLIENT_ID,
      redirectUri: 'cursor://anysphere.cursor-mcp/oauth/callback',
      scope: ['read', 'write'],
      state: 'client-state',
    };

    function returnLink(html: string): URL {
      const href = /id="return-link" href="([^"]+)"/.exec(html)?.[1];
      expect(href).toBeTruthy();
      return new URL(he.decode(href!));
    }

    // The page is only for browsers, which send this on every navigation.
    function fromBrowser(request: Request): Request {
      request.headers.set('accept', 'text/html,application/xhtml+xml');
      return request;
    }

    it('renders the success page for a native app redirect and hands it the code', async () => {
      const seeded = await seedApproved({ request: appRequest });

      const response = await app.handler(
        fromBrowser(buildRequest(seeded.id, seeded.cookie)),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(response.headers.get('cache-control')).toBe('no-store');
      const html = await response.text();
      expect(html).toContain('You’ve approved access to Neon');
      expect(html).toContain('Copy prompt');
      const link = returnLink(html);
      expect(link.protocol).toBe('cursor:');
      expect(link.searchParams.get('code')).toBeTruthy();
      expect(link.searchParams.get('state')).toBe('client-state');
      expect(link.searchParams.get('iss')).toBe(SERVER_HOST);
      expect(response.headers.getSetCookie().join('\n')).toContain(
        `${consentCookieName(seeded.id, false)}=;`,
      );
      expect(app.tracked).toContainEqual(
        expect.objectContaining({
          userId: 'user-1',
          event: 'auth_complete_viewed',
          properties: expect.objectContaining({
            outcome: 'success',
            clientId: CLIENT_ID,
            clientName: 'Callback Test Client',
          }),
        }),
      );
    });

    it('shows success when the registered redirect_uri carries an error param', async () => {
      const seeded = await seedApproved({
        request: {
          ...appRequest,
          redirectUri: `${appRequest.redirectUri}?error=access_denied`,
        },
      });

      const response = await app.handler(
        fromBrowser(buildRequest(seeded.id, seeded.cookie)),
      );

      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('You’ve approved access to Neon');
      expect(returnLink(html).searchParams.get('code')).toBeTruthy();
    });

    it('renders the cancelled page and relays access_denied to a native app', async () => {
      const seeded = await seedApproved({ request: appRequest });

      const response = await app.handler(
        fromBrowser(
          buildErrorRequest(seeded.id, seeded.cookie, 'access_denied'),
        ),
      );

      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('Connection cancelled');
      expect(html).not.toContain('Copy prompt');
      expect(returnLink(html).searchParams.get('error')).toBe('access_denied');
      expect(app.tracked).toContainEqual(
        expect.objectContaining({
          event: 'auth_complete_viewed',
          properties: expect.objectContaining({
            outcome: 'cancelled',
            clientId: CLIENT_ID,
            clientName: 'Callback Test Client',
          }),
        }),
      );
      expect(app.tracked.at(-1)).not.toHaveProperty('userId');
    });

    it('keeps the query on a retryable failure so a reload completes it', async () => {
      const seeded = await seedApproved({ request: appRequest });
      const unreadable = callbackApp({
        store: clientLookupFailingOnce(
          ClientMetadataUnavailable.make({
            cause: new ClientMetadataUnavailableError('answered 502'),
          }),
        ),
      });

      const failed = await unreadable.handler(
        fromBrowser(buildRequest(seeded.id, seeded.cookie)),
      );
      expect(failed.status).toBe(503);
      expect(failed.headers.get('retry-after')).toBe('30');
      expect(await failed.text()).not.toContain('history.replaceState');

      const retried = await unreadable.handler(
        fromBrowser(buildRequest(seeded.id, seeded.cookie)),
      );
      expect(retried.status).toBe(200);
      expect(await retried.text()).toContain('You’ve approved access to Neon');
    });

    it('lets a reload retry a server failure before the transaction is used up', async () => {
      const seeded = await seedApproved({ request: appRequest });
      const failing = callbackApp({
        store: clientLookupFailingOnce(
          storeFailure('getClient', new Error('unexpected non-pg failure')),
        ),
      });

      const failed = await failing.handler(
        fromBrowser(buildRequest(seeded.id, seeded.cookie)),
      );
      expect(failed.status).toBe(500);
      const html = await failed.text();
      expect(html).toContain('Reload this page in a moment to try again.');
      expect(html).not.toContain('history.replaceState');

      const retried = await failing.handler(
        fromBrowser(buildRequest(seeded.id, seeded.cookie)),
      );
      expect(retried.status).toBe(200);
    });

    it('drops the query after a server failure that used up the transaction', async () => {
      const seeded = await seedApproved({ request: appRequest });
      const failing = callbackApp({
        store: () => ({
          saveAuthorizationCode: () =>
            Effect.fail(
              storeFailure(
                'saveAuthorizationCode',
                new Error('unexpected non-pg failure'),
              ),
            ),
        }),
      });

      const failed = await failing.handler(
        fromBrowser(buildRequest(seeded.id, seeded.cookie)),
      );
      expect(failed.status).toBe(500);
      const html = await failed.text();
      expect(html).toContain('Start again from your app.');
      expect(html).toContain('history.replaceState');
    });

    it('keeps the plain redirect for a browser returning to a loopback client', async () => {
      const seeded = await seedApproved();

      const response = await app.handler(
        fromBrowser(buildRequest(seeded.id, seeded.cookie)),
      );

      expect(response.status).toBe(307);
      const location = new URL(response.headers.get('location')!);
      expect(location.origin).toBe('http://127.0.0.1:55667');
      expect(location.searchParams.get('code')).toBeTruthy();
      expect(location.searchParams.get('state')).toBe('client-state');
      expect(app.tracked).toStrictEqual([]);
    });

    it('keeps the native app redirect for a non-browser caller', async () => {
      const seeded = await seedApproved({ request: appRequest });

      const response = await app.handler(
        buildRequest(seeded.id, seeded.cookie),
      );

      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toMatch(/^cursor:/);
    });
  });

  describe('internal_error + pg-connect retry', () => {
    const makePgXX000Error = () =>
      Object.assign(new Error("Couldn't connect to compute node"), {
        code: 'XX000',
      });

    /**
     * Client lookups whose first `failures` attempts fail to connect. Like
     * the store's, a lookup retries a connect failure once when the caller
     * names the operation.
     */
    const lookupsFailingToConnect = (failures: number) => {
      const attempts = { count: 0 };

      const store = (real: StoreOperations): Partial<StoreOperations> => ({
        findClient: (lookup) => {
          const attempt = Effect.suspend(() => {
            attempts.count += 1;

            return attempts.count <= failures
              ? Effect.fail(storeFailure('getClient', makePgXX000Error()))
              : real.findClient({ clientId: lookup.clientId });
          });

          return lookup.connectRetryOperation === undefined
            ? attempt
            : attempt.pipe(retryPgConnect(lookup.connectRetryOperation));
        },
      });

      return { attempts, store };
    };

    it('emits internal_error SLO line with clientId when KV first call fails', async () => {
      const failing = callbackApp({
        store: () => ({
          findClient: () =>
            Effect.fail(
              storeFailure('getClient', new Error('unexpected non-pg failure')),
            ),
        }),
      });
      const seeded = await seedApproved();
      const response = await failing.handler(
        buildRequest(seeded.id, seeded.cookie),
      );
      expect(response.status).toBeGreaterThanOrEqual(500);
      const sloLine = findSloLine('internal_error');
      expect(sloLine).toContain(`clientId=${CLIENT_ID}`);
      expect(sloLine).toContain('reason=Error');
    });

    it('retries once and succeeds when the first KV call hits Postgres XX000', async () => {
      const lookups = lookupsFailingToConnect(1);
      const seeded = await seedApproved();
      const response = await callbackApp({ store: lookups.store }).handler(
        buildRequest(seeded.id, seeded.cookie),
      );
      expect(response.status).toBe(307);
      expect(lookups.attempts.count).toBe(2);
    });

    it('exhausts retries on persistent XX000 and emits internal_error with pg_connect_failure reason', async () => {
      const lookups = lookupsFailingToConnect(Number.POSITIVE_INFINITY);
      const seeded = await seedApproved();
      const response = await callbackApp({ store: lookups.store }).handler(
        buildRequest(seeded.id, seeded.cookie),
      );
      expect(response.status).toBeGreaterThanOrEqual(500);
      expect(lookups.attempts.count).toBe(2);
      const sloLine = findSloLine('internal_error');
      expect(sloLine).toContain(`clientId=${CLIENT_ID}`);
      expect(sloLine).toContain('reason=pg_connect_failure');
    });
  });

  it('reads an approved transaction from a second store instance', async () => {
    const seeded = await seedApproved({
      approvedGrant: { projectId: 'proj-other', scopes: ['schema'] },
      approvedScopes: ['read'],
    });
    const other = createAuthTransactionStore(process.env.OAUTH_DATABASE_URL!);
    const loaded = await other.getById(seeded.id);
    expect(loaded?.status).toBe('approved');
    if (loaded?.status !== 'approved') {
      throw new Error('expected approved');
    }
    expect(loaded.approvedGrant).toEqual({
      projectId: 'proj-other',
      scopes: ['schema'],
    });
  });
});
