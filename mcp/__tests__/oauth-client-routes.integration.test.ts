/**
 * /api/register and /api/revoke through the Effect app, against the real OAuth
 * Postgres database: what the client gets, and the spans and Sentry events
 * each answer leaves. A request the client got wrong keeps every span ok and
 * sends nothing to Sentry.
 */
import { createServer } from 'node:https';
import { fixtureCertificate } from './oauth-fixture-certificate';
import { once } from 'node:events';
import { Writable } from 'node:stream';
import pg from 'pg';
import winston from 'winston';
import { flush, httpIntegration, init, startSpan } from '@sentry/node';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

process.env.E2E_SENTRY_PORT = '3115';

// openid-client requires HTTPS. This worker uses a disposable loopback issuer.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

process.env.CLIENT_ID = 'synthetic-broker';

process.env.CLIENT_SECRET = 'synthetic-broker-secret';

const issuer = createServer(await fixtureCertificate(), (request, response) => {
  if (request.url === '/.well-known/openid-configuration') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        issuer: issuerUrl,
        authorization_endpoint: `${issuerUrl}/authorize`,
        token_endpoint: `${issuerUrl}/token`,
        revocation_endpoint: `${issuerUrl}/revoke`,
        response_types_supported: ['code'],
      }),
    );

    return;
  }

  request.resume();
  response.writeHead(
    request.method === 'POST' && request.url === '/revoke' ? 200 : 404,
  );
  response.end();
});

issuer.listen(0, '127.0.0.1');

await once(issuer, 'listening');

const issuerPort = z.object({ port: z.number() }).parse(issuer.address()).port;
const issuerUrl = `https://127.0.0.1:${issuerPort}`;

process.env.UPSTREAM_OAUTH_HOST = issuerUrl;

const {
  SENTRY_FIXTURE_DSN,
  SENTRY_FIXTURE_ITEMS_URL,
  startSentryFixtureServer,
} = await import('../../e2e/sentry-fixture');

const { ensureTestOauthDatabase } =
  await import('./ensure-test-oauth-database');

const databaseUrl = await ensureTestOauthDatabase();

const { model } = await import('../oauth/model');
const { logger } = await import('../utils/logger');
const { app } = await import('../../lib/http/app');

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

const Registration = z.object({
  client_id: z.string(),
  client_secret: z.string(),
  client_name: z.string(),
  redirect_uris: z.array(z.string()),
  token_endpoint_auth_method: z.string(),
});

const fixture = await startSentryFixtureServer();

// The fixture's own HTTP requests would otherwise become transactions too.
init({
  dsn: SENTRY_FIXTURE_DSN,
  tracesSampleRate: 1,
  integrations: [httpIntegration({ ignoreIncomingRequests: () => true })],
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

/** The OAuth spans of the transaction named `name`, parent first. */
const oauthSpans = async (name: string) => {
  const payloads = await items('transaction');

  const transaction = payloads
    .map((payload) => Transaction.parse(payload))
    .find((candidate) => candidate.transaction === name);

  return (transaction?.spans ?? [])
    .filter(({ description }) => description.startsWith('OAuth'))
    .map(({ description, status, data }) => ({
      description,
      status,
      errorType: data['error.type'],
    }));
};

/** One attribute of the span `description` in the transaction `name`. */
const spanAttribute = async (
  name: string,
  description: string,
  attribute: string,
) => {
  const payloads = await items('transaction');

  const span = payloads
    .map((payload) => Transaction.parse(payload))
    .find((candidate) => candidate.transaction === name)
    ?.spans.find((candidate) => candidate.description === description);

  return span?.data[attribute];
};

let requestCount = 0;

// Node's fetch needs `duplex` for a streamed body; the DOM type omits it.
type StreamingRequestInit = RequestInit & { duplex?: 'half' };

/** Sends a request to `path` under a uniquely named request span. */
const send = async (path: string, requestInit: StreamingRequestInit) => {
  requestCount += 1;

  const name = `POST ${path} #${requestCount}`;

  const response = await startSpan({ name, op: 'http.server' }, async () =>
    app.handler(new Request(`http://localhost${path}`, requestInit)),
  );

  return { response, name };
};

const VALID_PAYLOAD = {
  client_name: 'Codex',
  redirect_uris: ['http://127.0.0.1:55555/callback'],
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  token_endpoint_auth_method: 'client_secret_post',
};

const sendRegistration = async (body: string) =>
  send('/api/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-read-only': 'true' },
    body,
  });

const revoke = async (fields: Record<string, string>) =>
  send('/api/revoke', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });

const registerClient = async () => {
  const { response } = await sendRegistration(JSON.stringify(VALID_PAYLOAD));
  const body: unknown = await response.json();

  return Registration.parse(body);
};

const seedTokens = async (clientId: string) => {
  const suffix = crypto.randomUUID();
  const accessToken = `at-${suffix}`;
  const refreshToken = `rt-${suffix}`;

  await model.saveToken({
    accessToken,
    refreshToken,
    expires_at: Date.now() + 3_600_000,
    client: { id: clientId, grants: [] },
    user: { id: 'user-1', name: 'Test User' },
    scope: 'read write',
  });
  await model.saveRefreshToken({ refreshToken, accessToken });

  return { accessToken, refreshToken };
};

describe('OAuth client routes', () => {
  afterAll(async () => {
    fixture.close();
    issuer.closeAllConnections();
    issuer.close();
    await once(fixture, 'close');
  });

  it.each([
    { path: '/api/register', contentType: 'application/json' },
    { path: '/api/revoke', contentType: 'application/x-www-form-urlencoded' },
  ])(
    'answers a body $path cannot read with server_error and no Sentry event',
    async ({ path, contentType }) => {
      const eventsBefore = await errorEventCount();

      const { response, name } = await send(path, {
        method: 'POST',
        headers: { 'content-type': contentType },
        body: new ReadableStream({
          start(controller) {
            controller.error(new Error('connection reset'));
          },
        }),
        duplex: 'half',
      });

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toStrictEqual({
        error: 'server_error',
        error_description: 'Internal server error',
      });

      const [routeSpan] = await oauthSpans(name);

      expect(routeSpan).toMatchObject({
        status: 'ok',
        errorType: 'RequestBodyUnreadable',
      });
      await expect(errorEventCount()).resolves.toBe(eventsBefore);
    },
  );

  describe('POST /api/register', () => {
    it('stores the client with the headers it registered with', async () => {
      const { response, name } = await sendRegistration(
        JSON.stringify(VALID_PAYLOAD),
      );

      expect(response.status).toBe(200);

      const json: unknown = await response.json();
      const body = Registration.parse(json);

      expect(body).toMatchObject({
        client_name: 'Codex',
        redirect_uris: VALID_PAYLOAD.redirect_uris,
        token_endpoint_auth_method: 'client_secret_post',
      });

      await expect(model.getClient(body.client_id, '')).resolves.toMatchObject({
        id: body.client_id,
        secret: body.client_secret,
        client_name: 'Codex',
        tokenEndpointAuthMethod: 'client_secret_post',
      });

      const registerHeaders = await model.getClientRegisterHeaders(
        body.client_id,
      );

      expect(registerHeaders?.headers['x-read-only']).toBe('true');
      await expect(oauthSpans(name)).resolves.toStrictEqual([
        {
          description: 'OAuthRegister.register',
          status: 'ok',
          errorType: undefined,
        },
        {
          description: 'OAuthStore.saveClient',
          status: 'ok',
          errorType: undefined,
        },
        {
          description: 'OAuthModel.saveClient',
          status: 'ok',
          errorType: undefined,
        },
        {
          description: 'OAuthModel.saveClientRegisterHeaders',
          status: 'ok',
          errorType: undefined,
        },
      ]);
      await expect(
        spanAttribute(name, 'OAuthRegister.register', 'oauth.client_id'),
      ).resolves.toBe(body.client_id);
    });

    it.each([
      ['invalid JSON', '{', 'Invalid JSON in request body'],
      ['a null body', 'null', 'client_name is required'],
      [
        'grant_types that is not an array',
        JSON.stringify({ ...VALID_PAYLOAD, grant_types: 'authorization_code' }),
        'grant_types is required and must only include supported grant types',
      ],
    ])(
      'answers %s with 400 and an ok span',
      async (_case, body, description) => {
        const eventsBefore = await errorEventCount();
        const { response, name } = await sendRegistration(body);

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toStrictEqual({
          error: 'invalid_request',
          error_description: description,
        });
        await expect(oauthSpans(name)).resolves.toStrictEqual([
          {
            description: 'OAuthRegister.register',
            status: 'ok',
            errorType: 'InvalidRegistration',
          },
        ]);
        await expect(errorEventCount()).resolves.toBe(eventsBefore);
      },
    );
  });

  describe('POST /api/revoke', () => {
    it('revokes the refresh token and its access token for the owner', async () => {
      const client = await registerClient();
      const { accessToken, refreshToken } = await seedTokens(client.client_id);

      const { response, name } = await revoke({
        client_id: client.client_id,
        client_secret: client.client_secret,
        token: refreshToken,
      });

      expect(response.status).toBe(200);
      await expect(
        model.getRefreshToken(refreshToken),
      ).resolves.toBeUndefined();
      await expect(model.getAccessToken(accessToken)).resolves.toBeUndefined();

      const spans = await oauthSpans(name);

      expect(
        spans.map(({ description, status }) => ({ description, status })),
      ).toStrictEqual([
        { description: 'OAuthRevoke.revoke', status: 'ok' },
        { description: 'OAuthStore.findClient', status: 'ok' },
        { description: 'OAuthClient.authenticate', status: 'ok' },
        { description: 'OAuthStore.revokeToken', status: 'ok' },
        { description: 'OAuthModel.findGrant', status: 'ok' },
        { description: 'OAuthModel.traceGrant', status: 'ok' },
        { description: 'OAuthModel.denyGrant', status: 'ok' },
        { description: 'OAuthModel.traceGrant', status: 'ok' },
        { description: 'OAuthModel.denyGrant', status: 'ok' },
        { description: 'OAuthModel.deleteGrantRows', status: 'ok' },
        { description: 'OAuthModel.retireGrant', status: 'ok' },
      ]);
      await expect(
        spanAttribute(name, 'OAuthRevoke.revoke', 'oauth.client_id'),
      ).resolves.toBe(client.client_id);
    });

    it('finishes deleting the token pair when the request is aborted mid-revocation', async () => {
      const client = await registerClient();
      const { accessToken, refreshToken } = await seedTokens(client.client_id);
      const locker = new pg.Client({ connectionString: databaseUrl });
      // pg_stat_activity is a snapshot per transaction, so the lock holder
      // can't watch for the waiting delete itself.
      const observer = new pg.Client({ connectionString: databaseUrl });

      await locker.connect();
      await observer.connect();
      await locker.query('BEGIN');
      // Holds the access token's row, so the revocation's first delete waits.
      await locker.query(
        'SELECT 1 FROM mcpauth.tokens WHERE key = $1 FOR UPDATE',
        [`keyv:${accessToken}`],
      );

      const abort = new AbortController();

      const pending = app.handler(
        new Request('http://localhost/api/revoke', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: client.client_id,
            client_secret: client.client_secret,
            token: refreshToken,
          }).toString(),
          signal: abort.signal,
        }),
      );

      await vi.waitFor(
        async () => {
          const { rows } = await observer.query<{ waiting: number }>(
            "SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE 'DELETE FROM mcpauth.tokens%'",
          );

          expect(rows[0]?.waiting).toBe(1);
        },
        { timeout: 10_000 },
      );

      abort.abort();
      await locker.query('ROLLBACK');
      await pending;
      await locker.end();
      await observer.end();

      await vi.waitFor(
        async () => {
          await expect(
            model.getRefreshToken(refreshToken),
          ).resolves.toBeUndefined();
        },
        { timeout: 10_000 },
      );
      await expect(model.getAccessToken(accessToken)).resolves.toBeUndefined();
    }, 30_000);

    it('records no client id for a client the store does not resolve', async () => {
      const sentinel = 'SENTINEL_SECRET';

      const { response, name } = await revoke({
        client_id: `https://user:${sentinel}@example.invalid/client.json?token=${sentinel}`,
        token: 'anything',
      });

      expect(response.status).toBe(200);
      await expect(
        spanAttribute(name, 'OAuthRevoke.revoke', 'oauth.client_id'),
      ).resolves.toBeUndefined();

      const transactions = await items('transaction');

      expect(JSON.stringify(transactions)).not.toContain(sentinel);
    });

    it('keeps an access token another client names', async () => {
      const owner = await registerClient();
      const other = await registerClient();
      const { accessToken } = await seedTokens(owner.client_id);

      const { response } = await revoke({
        client_id: other.client_id,
        client_secret: other.client_secret,
        token: accessToken,
        token_type_hint: 'access_token',
      });

      expect(response.status).toBe(200);
      await expect(model.getAccessToken(accessToken)).resolves.toBeDefined();
    });

    it('treats an empty token_type_hint as no hint', async () => {
      const client = await registerClient();
      const { accessToken } = await seedTokens(client.client_id);

      const { response } = await revoke({
        client_id: client.client_id,
        client_secret: client.client_secret,
        token: accessToken,
        token_type_hint: '',
      });

      expect(response.status).toBe(200);
      await expect(model.getAccessToken(accessToken)).resolves.toBeUndefined();
    });

    it('answers 200 for an unknown client', async () => {
      const { response } = await revoke({
        client_id: `unknown-${crypto.randomUUID()}`,
        token: 'anything',
      });

      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toBe('');
    });

    it('answers wrong credentials with 401 and an ok span', async () => {
      const client = await registerClient();
      const eventsBefore = await errorEventCount();

      const { response, name } = await revoke({
        client_id: client.client_id,
        client_secret: 'wrong',
        token: 'anything',
      });

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toStrictEqual({
        error: 'invalid_client',
        error_description: 'Invalid client credentials',
      });

      const [routeSpan] = await oauthSpans(name);

      expect(routeSpan).toStrictEqual({
        description: 'OAuthRevoke.revoke',
        status: 'ok',
        errorType: undefined,
      });
      await expect(errorEventCount()).resolves.toBe(eventsBefore);
    });

    it('answers a malformed Basic header with server_error and no Sentry event', async () => {
      const eventsBefore = await errorEventCount();

      const { response, name } = await send('/api/revoke', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          authorization: 'Basic %%%',
        },
        body: new URLSearchParams({ token: 'anything' }).toString(),
      });

      expect(response.status).toBe(500);

      const [routeSpan] = await oauthSpans(name);

      expect(routeSpan).toStrictEqual({
        description: 'OAuthRevoke.revoke',
        status: 'ok',
        errorType: 'MalformedClientCredentials',
      });
      await expect(errorEventCount()).resolves.toBe(eventsBefore);
    });

    // A metadata document host that accepts no connection: the fetch hits its
    // deadline, which is the client's outage.
    it('answers an unreachable client metadata document with 503 and ok spans', async () => {
      const eventsBefore = await errorEventCount();

      const { response, name } = await revoke({
        client_id: 'https://neon.com:9/client.json',
        token: 'anything',
      });

      expect(response.status).toBe(503);
      expect(response.headers.get('retry-after')).toBe('30');
      await expect(oauthSpans(name)).resolves.toStrictEqual([
        {
          description: 'OAuthRevoke.revoke',
          status: 'ok',
          errorType: 'ClientMetadataUnavailable',
        },
        {
          description: 'OAuthStore.findClient',
          status: 'ok',
          errorType: 'ClientMetadataUnavailable',
        },
      ]);
      await expect(errorEventCount()).resolves.toBe(eventsBefore);
    }, 30_000);

    it('logs a JWKS outage and answers 503 with ok spans', async () => {
      const clientId = `jwks-outage-${crypto.randomUUID()}`;
      const lines: string[] = [];

      const transport = new winston.transports.Stream({
        stream: new Writable({
          write(chunk: Buffer, _encoding, callback) {
            lines.push(chunk.toString());
            callback();
          },
        }),
      });

      await model.saveClient({
        id: clientId,
        secret: 'unused',
        grants: [],
        tokenEndpointAuthMethod: 'private_key_jwt',
        jwks_uri: 'https://neon.com:9/jwks.json',
      });
      logger.add(transport);

      const eventsBefore = await errorEventCount();

      const { response, name } = await revoke({
        client_id: clientId,
        client_assertion: 'not-checked-before-the-jwks-loads',
        client_assertion_type:
          'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
        token: 'anything',
      });

      logger.remove(transport);

      expect(response.status).toBe(503);
      expect(
        lines.some((line) =>
          line.includes('Client metadata unavailable during revocation'),
        ),
      ).toBe(true);

      const spans = await oauthSpans(name);

      expect(
        spans.map(({ description, status }) => ({ description, status })),
      ).toStrictEqual([
        { description: 'OAuthRevoke.revoke', status: 'ok' },
        { description: 'OAuthStore.findClient', status: 'ok' },
        { description: 'OAuthClient.authenticate', status: 'ok' },
      ]);
      await expect(errorEventCount()).resolves.toBe(eventsBefore);
    }, 30_000);

    it('answers a body that is not a form with 415', async () => {
      const { response } = await send('/api/revoke', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });

      expect(response.status).toBe(415);
      await expect(response.json()).resolves.toStrictEqual({
        error: 'invalid_request',
        error_description: 'Invalid content type',
      });
    });
  });
});
