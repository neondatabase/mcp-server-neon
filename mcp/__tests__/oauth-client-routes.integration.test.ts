/**
 * /api/register and /api/revoke through the Effect app, against the real OAuth
 * Postgres database: what the client gets, and the spans and Sentry events
 * each answer leaves. A request the client got wrong keeps every span ok and
 * sends nothing to Sentry.
 */
import { once } from 'node:events';
import { flush, init, startSpan } from '@sentry/node';
import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ensureTestOauthDatabase } from './ensure-test-oauth-database';

process.env.E2E_SENTRY_PORT = '3115';

const {
  SENTRY_FIXTURE_DSN,
  SENTRY_FIXTURE_ITEMS_URL,
  startSentryFixtureServer,
} = await import('../../e2e/sentry-fixture');

await ensureTestOauthDatabase();

const { model } = await import('../oauth/model');
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

init({ dsn: SENTRY_FIXTURE_DSN, tracesSampleRate: 1 });

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
      ]);
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
      ]);
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
