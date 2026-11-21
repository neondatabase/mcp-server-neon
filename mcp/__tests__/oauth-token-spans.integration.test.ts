/**
 * /api/token through the Effect app with nothing replaced: the real OAuth
 * Postgres database (tokens, refresh caches, the Postgres refresh lock), real
 * openid-client exchanges against a local HTTPS stand-in for Hydra, and a
 * Sentry ingestion stand-in. Covers what the client gets, the spans and
 * Sentry events each answer leaves, and that a client disconnect after the
 * upstream exchange started still persists the rotated pair.
 */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { flush, httpIntegration, init, startSpan } from '@sentry/node';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

process.env.E2E_SENTRY_PORT = '3117';

// The upstream stand-in serves a throwaway self-signed certificate:
// openid-client refuses a plain-HTTP issuer.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

process.env.CLIENT_ID = 'token-spans-upstream-client';

process.env.CLIENT_SECRET = 'token-spans-upstream-secret';

delete process.env.KV_URL;

delete process.env.REDIS_URL;

type UpstreamAnswer = { readonly status: number; readonly body: object };

type Upstream = {
  readonly received: string[];
  answer: () => Promise<UpstreamAnswer>;
};

const upstream: Upstream = {
  received: [],
  answer: async () => rotated(),
};

const rotated = (): UpstreamAnswer => ({
  status: 200,
  body: {
    access_token: `at-${crypto.randomUUID()}`,
    refresh_token: `rt-${crypto.randomUUID()}`,
    token_type: 'bearer',
    expires_in: 3600,
  },
});

const certificate = async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'token-spans-'));
  const key = path.join(dir, 'key.pem');
  const cert = path.join(dir, 'cert.pem');

  const openssl = spawn(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      key,
      '-out',
      cert,
      '-days',
      '1',
      '-subj',
      '/CN=127.0.0.1',
    ],
    { stdio: 'ignore' },
  );

  await once(openssl, 'exit');

  const pair = { key: await readFile(key), cert: await readFile(cert) };

  await rm(dir, { recursive: true, force: true });

  return pair;
};

const answerToken = async (refreshToken: string, response: ServerResponse) => {
  upstream.received.push(refreshToken);

  const { status, body } = await upstream.answer();

  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
};

const hydra = createServer(await certificate(), (request, response) => {
  const chunks: Buffer[] = [];

  request.on('data', (chunk: Buffer) => {
    chunks.push(chunk);
  });
  request.on('end', () => {
    const issuer = `https://127.0.0.1:${hydraPort()}`;

    if (request.url === '/.well-known/openid-configuration') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          issuer,
          authorization_endpoint: `${issuer}/oauth2/auth`,
          token_endpoint: `${issuer}/oauth2/token`,
          response_types_supported: ['code'],
        }),
      );

      return;
    }

    const refreshToken =
      new URLSearchParams(Buffer.concat(chunks).toString('utf8')).get(
        'refresh_token',
      ) ?? '';

    void answerToken(refreshToken, response);
  });
});

hydra.listen(0, '127.0.0.1');

await once(hydra, 'listening');

const hydraPort = (): number =>
  z.object({ port: z.number() }).parse(hydra.address()).port;

process.env.UPSTREAM_OAUTH_HOST = `https://127.0.0.1:${hydraPort()}`;

const {
  SENTRY_FIXTURE_DSN,
  SENTRY_FIXTURE_ITEMS_URL,
  startSentryFixtureServer,
} = await import('../../e2e/sentry-fixture');

// Imported once the environment above is set: lib/config reads it on load.
const { ensureTestOauthDatabase } =
  await import('./ensure-test-oauth-database');

await ensureTestOauthDatabase();

const { model } = await import('../oauth/model');
const { app } = await import('../../lib/http/app');

const fixture = await startSentryFixtureServer();

// The fixture's own HTTP requests would otherwise become transactions too.
init({
  dsn: SENTRY_FIXTURE_DSN,
  tracesSampleRate: 1,
  integrations: [httpIntegration({ ignoreIncomingRequests: () => true })],
});

const Items = z.array(z.object({ type: z.string(), payload: z.unknown() }));

const Transaction = z.object({
  transaction: z.string(),
  spans: z.array(
    z.object({
      description: z.string(),
      status: z.string(),
      data: z.record(z.string(), z.unknown()),
    }),
  ),
});

const TokenPair = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  token_type: z.literal('bearer'),
  expires_in: z.number(),
});

const items = async (type: string) => {
  await flush(5000);

  const response = await fetch(SENTRY_FIXTURE_ITEMS_URL);
  const body: unknown = await response.json();

  return Items.parse(body)
    .filter((item) => item.type === type)
    .map((item) => item.payload);
};

const errorEventCount = async () => {
  const events = await items('event');

  return events.length;
};

/**
 * The Effect spans of the transaction named `name`, parent first. Sentry's own
 * outgoing-HTTP spans are left out: they carry the upstream's status code.
 */
const spans = async (name: string) => {
  const payloads = await items('transaction');

  const transaction = payloads
    .map((payload) => Transaction.parse(payload))
    .find((candidate) => candidate.transaction === name);

  return (transaction?.spans ?? [])
    .filter(({ description }) => !/^(?:GET|POST) /u.test(description))
    .map(({ description, status, data }) => ({
      description,
      status,
      errorType: data['error.type'],
      clientId: data['oauth.client_id'],
      grantType: data['oauth.grant_type'],
    }));
};

const client = {
  id: `token-spans-${crypto.randomUUID()}`,
  secret: 'token-spans-secret',
};

await model.saveClient({
  id: client.id,
  secret: client.secret,
  grants: ['authorization_code', 'refresh_token'],
  redirect_uris: ['http://localhost/callback'],
  tokenEndpointAuthMethod: 'client_secret_post',
  client_name: 'Token spans test',
});

const seedRefreshToken = async () => {
  const refreshToken = `rt-${crypto.randomUUID()}`;
  const accessToken = `at-${crypto.randomUUID()}`;

  await model.saveToken({
    accessToken,
    refreshToken,
    expires_at: Date.now() + 3_600_000,
    client: { id: client.id, grants: [] },
    user: { id: 'user-1', name: 'Test User', email: 'test@example.com' },
    scope: 'read write',
  });
  await model.saveRefreshToken({ refreshToken, accessToken });

  return refreshToken;
};

const refreshRequest = (refreshToken: string, signal?: AbortSignal) =>
  new Request('http://localhost/api/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: client.id,
      client_secret: client.secret,
    }).toString(),
    signal,
  });

let requestCount = 0;

/** Refreshes under a uniquely named request span. */
const refresh = async (refreshToken: string) => {
  requestCount += 1;

  const name = `POST /api/token #${requestCount}`;

  const response = await startSpan({ name, op: 'http.server' }, async () =>
    app.handler(refreshRequest(refreshToken)),
  );

  return { response, name };
};

describe('POST /api/token spans and Sentry events', () => {
  beforeEach(() => {
    upstream.received.length = 0;
    upstream.answer = async () => rotated();
  });

  afterAll(async () => {
    fixture.close();
    hydra.close();
    await once(fixture, 'close');
  });

  it('rotates a refresh token with ok spans and the resolved client on the route span', async () => {
    const refreshToken = await seedRefreshToken();
    const eventsBefore = await errorEventCount();

    const { response, name } = await refresh(refreshToken);

    expect(response.status).toBe(200);

    const pair = TokenPair.parse(await response.json());

    expect(upstream.received).toStrictEqual([refreshToken]);
    await expect(
      model.getRefreshToken(pair.refresh_token),
    ).resolves.toStrictEqual({
      refreshToken: pair.refresh_token,
      accessToken: pair.access_token,
    });
    await expect(model.getRefreshToken(refreshToken)).resolves.toBeUndefined();

    const recorded = await spans(name);
    const descriptions = recorded.map(({ description }) => description);

    expect(recorded[0]).toMatchObject({
      description: 'OAuthToken.token',
      status: 'ok',
      clientId: client.id,
      grantType: 'refresh_token',
      errorType: undefined,
    });
    expect(descriptions).toStrictEqual(
      expect.arrayContaining([
        'OAuthStore.findClient',
        'OAuthClient.authenticate',
        'RefreshRotations.cachedFailure',
        'RefreshLock.acquire',
        'RefreshToken.execute',
        'RefreshRotations.resolveOwned',
        'RefreshToken.exchangeUpstream',
        'UpstreamOAuth.exchangeRefreshToken',
        'RefreshToken.persist',
        'RefreshLock.release',
      ]),
    );
    expect(recorded.filter(({ status }) => status !== 'ok')).toStrictEqual([]);
    await expect(errorEventCount()).resolves.toBe(eventsBefore);

    const transactions = JSON.stringify(await items('transaction'));

    expect(transactions).not.toContain(refreshToken);
    expect(transactions).not.toContain(pair.refresh_token);
    expect(transactions).not.toContain(client.secret);
  }, 30_000);

  it('answers an unknown refresh token with invalid_grant, ok spans, and no Sentry event', async () => {
    const eventsBefore = await errorEventCount();

    const { response, name } = await refresh(`rt-${crypto.randomUUID()}`);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toStrictEqual({
      error: 'invalid_grant',
      error_description: 'Invalid or expired refresh token',
    });
    expect(upstream.received).toStrictEqual([]);

    const recorded = await spans(name);

    expect(recorded[0]).toMatchObject({
      description: 'OAuthToken.token',
      status: 'ok',
      errorType: 'correct_invalid_grant',
      clientId: client.id,
    });
    expect(recorded).toContainEqual(
      expect.objectContaining({
        description: 'RefreshToken.execute',
        status: 'ok',
        errorType: 'correct_invalid_grant',
      }),
    );
    expect(recorded.filter(({ status }) => status !== 'ok')).toStrictEqual([]);
    await expect(errorEventCount()).resolves.toBe(eventsBefore);
  }, 30_000);

  it('answers an upstream rejection as a cliff with ok spans and no Sentry event', async () => {
    const refreshToken = await seedRefreshToken();
    const eventsBefore = await errorEventCount();

    upstream.answer = async () => ({
      status: 400,
      body: { error: 'token_inactive', error_description: 'inactive' },
    });

    const { response, name } = await refresh(refreshToken);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toStrictEqual({
      error: 'invalid_grant',
      error_description: 'Invalid or expired refresh token',
    });
    await expect(model.getRefreshFailure(refreshToken)).resolves.toMatchObject({
      oauthError: 'token_inactive',
    });

    const recorded = await spans(name);

    expect(recorded[0]).toMatchObject({
      description: 'OAuthToken.token',
      status: 'ok',
      errorType: 'cliff_upstream',
    });
    expect(recorded).toContainEqual(
      expect.objectContaining({
        description: 'UpstreamOAuth.exchangeRefreshToken',
        status: 'ok',
        errorType: 'UpstreamOAuthRejected',
      }),
    );
    expect(recorded.filter(({ status }) => status !== 'ok')).toStrictEqual([]);
    await expect(errorEventCount()).resolves.toBe(eventsBefore);
  }, 30_000);

  it('answers an upstream 5xx with 503 and no Sentry event, keeping the token', async () => {
    const refreshToken = await seedRefreshToken();
    const eventsBefore = await errorEventCount();

    upstream.answer = async () => ({
      status: 500,
      body: { error: 'server_error' },
    });

    const { response, name } = await refresh(refreshToken);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toStrictEqual({
      error: 'server_error',
      error_description: 'Temporary error refreshing token, please retry',
    });
    expect(upstream.received).toStrictEqual([refreshToken]);
    await expect(model.getRefreshToken(refreshToken)).resolves.toBeDefined();

    const [routeSpan] = await spans(name);

    expect(routeSpan).toMatchObject({
      description: 'OAuthToken.token',
      status: 'ok',
      errorType: 'transient_upstream_5xx',
    });
    await expect(errorEventCount()).resolves.toBe(eventsBefore);
  }, 30_000);

  it('persists the rotated pair when the client disconnects after the upstream exchange started', async () => {
    const refreshToken = await seedRefreshToken();
    const answer = rotated();
    const started = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();

    upstream.answer = async () => {
      started.resolve(undefined);
      await release.promise;

      return answer;
    };

    const abort = new AbortController();
    const pending = app.handler(refreshRequest(refreshToken, abort.signal));

    await started.promise;
    abort.abort();
    release.resolve(undefined);
    await pending;

    const issued = TokenPair.parse({
      ...answer.body,
      expires_in: 3600,
    });

    await vi.waitFor(
      async () => {
        await expect(
          model.getRefreshToken(issued.refresh_token),
        ).resolves.toStrictEqual({
          refreshToken: issued.refresh_token,
          accessToken: issued.access_token,
        });
      },
      { timeout: 10_000 },
    );
    await expect(model.getRefreshResult(refreshToken)).resolves.toMatchObject({
      clientId: client.id,
      refreshToken: issued.refresh_token,
    });
    await expect(model.getRefreshToken(refreshToken)).resolves.toBeUndefined();

    // The client that never saw the answer retries with the old token and
    // gets the pair from the cache, without a second upstream call.
    const retry = await refresh(refreshToken);
    const replayed = TokenPair.parse(await retry.response.json());

    expect(replayed.refresh_token).toBe(issued.refresh_token);
    expect(upstream.received).toStrictEqual([refreshToken]);
  }, 30_000);
});
