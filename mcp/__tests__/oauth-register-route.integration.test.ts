/**
 * /api/register on the real OAuth Postgres store. Registered clients are read
 * back through the store; a recording layer over it shows which ones a
 * rejected request never saved.
 */
import { Effect, Layer, Option } from 'effect';
import { HttpRouter } from 'effect/http';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { OAuthStore } from '../oauth/oauth-store';
import { OAuthTestApp } from './helpers/oauth-app';

const VALID_PAYLOAD = {
  client_name: 'Codex',
  redirect_uris: ['http://127.0.0.1:55555/callback'],
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  token_endpoint_auth_method: 'none',
};

type StoreOperations = typeof OAuthStore.Service;

const savedClientIds: string[] = [];

const recordingStore = Layer.effect(
  OAuthStore,
  OAuthStore.make.pipe(
    Effect.map((real) =>
      OAuthStore.of({
        ...real,
        saveClient: (input) =>
          Effect.sync(() => {
            savedClientIds.push(input.client.id);
          }).pipe(Effect.andThen(real.saveClient(input))),
      }),
    ),
  ),
);

const app = HttpRouter.toWebHandler(
  Layer.mergeAll(OAuthTestApp, recordingStore),
  { disableLogger: true },
);

const onStore = async <A, E>(
  run: (store: StoreOperations) => Effect.Effect<A, E>,
) =>
  Effect.runPromise(
    OAuthStore.pipe(Effect.flatMap(run), Effect.provide(OAuthStore.layer)),
  );

const storedClient = async (clientId: string) =>
  onStore((store) => store.findClient({ clientId }));

const register = async (
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> =>
  app.handler(
    new Request('http://localhost/api/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  );

describe('/api/register route integration', () => {
  beforeEach(() => {
    savedClientIds.length = 0;
  });

  afterAll(async () => {
    await app.dispose();
  });

  it('returns a valid response and stores register headers for a valid request', async () => {
    const response = await register(VALID_PAYLOAD, { 'x-read-only': 'true' });
    const body = (await response.json()) as {
      client_id: string;
      client_secret: string;
      token_endpoint_auth_method: string;
    };

    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(200);
    expect(body.client_id).toBeTypeOf('string');
    expect(body.client_secret).toBeTypeOf('string');
    expect(body.token_endpoint_auth_method).toBe('none');
    expect(savedClientIds).toStrictEqual([body.client_id]);
    await expect(storedClient(body.client_id)).resolves.toMatchObject(
      Option.some({ id: body.client_id, secret: body.client_secret }),
    );
    await expect(
      onStore((store) =>
        store.findRegisterHeaders({ clientId: body.client_id }),
      ),
    ).resolves.toMatchObject(
      Option.some({ headers: { 'x-read-only': 'true' } }),
    );
  });

  it('generates the client_id, so a registration cannot claim a metadata document URL', async () => {
    const claimed = 'https://claude.ai/oauth/mcp-oauth-client-metadata';
    const response = await register({
      ...VALID_PAYLOAD,
      id: claimed,
      client_id: claimed,
    });
    const body = (await response.json()) as { client_id: string };

    expect(response.status).toBe(200);
    expect(body.client_id).not.toMatch(/^https:\/\//);
    await expect(storedClient(body.client_id)).resolves.toMatchObject(
      Option.some({ id: body.client_id }),
    );
  });

  it('returns 400 when client_name is missing', async () => {
    const { client_name, ...payloadWithoutClientName } = VALID_PAYLOAD;
    void client_name;

    const response = await register(payloadWithoutClientName);
    const body = (await response.json()) as {
      error: string;
      error_description: string;
    };

    expect(response.status).toBe(400);
    expect(body.error).toBe('invalid_request');
    expect(body.error_description).toContain('client_name');
    expect(savedClientIds).toStrictEqual([]);
  });

  it('returns 400 when redirect_uris is missing', async () => {
    const { redirect_uris, ...payloadWithoutRedirectUris } = VALID_PAYLOAD;
    void redirect_uris;

    const response = await register(payloadWithoutRedirectUris);
    const body = (await response.json()) as {
      error: string;
      error_description: string;
    };

    expect(response.status).toBe(400);
    expect(body.error).toBe('invalid_request');
    expect(body.error_description).toContain('redirect_uris');
    expect(savedClientIds).toStrictEqual([]);
  });

  it.each([
    'https://client.example/callback',
    'claude://claude.ai/oauth/callback',
    'http://hermes.cobaltweb.dev/callback',
  ])('normalizes scalar redirect URI %s', async (redirectUri) => {
    const response = await register({
      ...VALID_PAYLOAD,
      redirect_uris: redirectUri,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      redirect_uris: [redirectUri],
    });

    const [clientId = ''] = savedClientIds;

    await expect(storedClient(clientId)).resolves.toMatchObject(
      Option.some({ redirect_uris: [redirectUri] }),
    );
  });

  it('keeps valid redirects from a mixed array', async () => {
    const redirectUris = [
      'https://client.example/callback',
      42,
      'custom://client/callback',
    ];
    const response = await register({
      ...VALID_PAYLOAD,
      redirect_uris: redirectUris,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      redirect_uris: [
        'https://client.example/callback',
        'custom://client/callback',
      ],
    });
  });

  it('returns 400 when redirect_uris contains no strings', async () => {
    const response = await register({
      ...VALID_PAYLOAD,
      redirect_uris: [42, null],
    });

    expect(response.status).toBe(400);
    expect(savedClientIds).toStrictEqual([]);
  });

  it('returns 400 when grant_types contains unsupported values', async () => {
    const response = await register({
      ...VALID_PAYLOAD,
      grant_types: ['client_credentials'],
    });
    const body = (await response.json()) as {
      error: string;
      error_description: string;
    };

    expect(response.status).toBe(400);
    expect(body.error).toBe('invalid_request');
    expect(body.error_description).toContain('grant_types');
    expect(savedClientIds).toStrictEqual([]);
  });

  it('returns 400 when response_types contains unsupported values', async () => {
    const response = await register({
      ...VALID_PAYLOAD,
      response_types: ['token'],
    });
    const body = (await response.json()) as {
      error: string;
      error_description: string;
    };

    expect(response.status).toBe(400);
    expect(body.error).toBe('invalid_request');
    expect(body.error_description).toContain('response_types');
    expect(savedClientIds).toStrictEqual([]);
  });

  it('returns 204 and CORS headers for OPTIONS', async () => {
    const response = await app.handler(
      new Request('http://localhost/api/register', { method: 'OPTIONS' }),
    );

    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-allow-methods')).toContain(
      'POST',
    );
    expect(response.headers.get('access-control-allow-headers')).toContain(
      'x-read-only',
    );
  });
});
