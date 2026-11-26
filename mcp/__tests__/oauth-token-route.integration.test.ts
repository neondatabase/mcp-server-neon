/**
 * /api/token on the real OAuth Postgres store. Client ID metadata document
 * clients are served by replacing the store's client lookup: the document
 * fetch refuses loopback addresses, so no local server can host one.
 */
import { Effect, Layer, Option } from 'effect';
import { HttpRouter } from 'effect/http';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterAll, describe, expect, it } from 'vitest';
import { SERVER_HOST } from '../../lib/config';
import { CLIENT_ASSERTION_TYPE } from '../../lib/oauth/client-assertion';
import { ClientMetadataUnavailable } from '../../lib/oauth/client-metadata-unavailable';
import { Analytics } from '../analytics/analytics-service';
import { OAuthStore } from '../oauth/oauth-store';
import { OAuthTestApp } from './helpers/oauth-app';

const REDIRECT_URI = 'http://127.0.0.1:55667/callback';

type StoreOperations = typeof OAuthStore.Service;

type StoredCode = Parameters<
  StoreOperations['saveAuthorizationCode']
>[0]['code'];

type Identified = Parameters<(typeof Analytics.Service)['identify']>[0];

const handlers: { readonly dispose: () => Promise<void> }[] = [];

/** The OAuth app with `overrides` merged over its real services. */
const appWith = <ROut>(overrides: Layer.Layer<ROut>) => {
  const handler = HttpRouter.toWebHandler(
    Layer.mergeAll(OAuthTestApp, overrides),
    { disableLogger: true },
  );

  handlers.push(handler);

  return handler;
};

/** The real OAuth store with some of its operations replaced. */
const storeWith = (overrides: Partial<StoreOperations>) =>
  Layer.effect(
    OAuthStore,
    OAuthStore.make.pipe(
      Effect.map((real) => OAuthStore.of({ ...real, ...overrides })),
    ),
  );

const onStore = async <A, E>(
  run: (store: StoreOperations) => Effect.Effect<A, E>,
) =>
  Effect.runPromise(
    OAuthStore.pipe(Effect.flatMap(run), Effect.provide(OAuthStore.layer)),
  );

/** Analytics that records `identify` calls instead of sending them. */
const recordingAnalytics = () => {
  const identified: Identified[] = [];

  const layer = Layer.succeed(
    Analytics,
    Analytics.of({
      track: () => Effect.void,
      identify: (input) =>
        Effect.sync(() => {
          identified.push(input);
        }),
    }),
  );

  return { identified, layer };
};

const tokenRequest = (fields: Record<string, string>) =>
  new Request('http://localhost/api/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });

const publicClient = () => ({
  id: `token-route-${crypto.randomUUID()}`,
  secret: '',
  tokenEndpointAuthMethod: 'none',
  redirect_uris: [REDIRECT_URI],
  grants: ['authorization_code', 'refresh_token'],
  client_name: 'Token Route Test Client',
});

const authorizationCode = (input: {
  readonly client: StoredCode['client'];
  readonly redirectUri: string;
  readonly scope: string;
  readonly grant: unknown;
}) => {
  const upstreamAccessToken = `upstream-access-${crypto.randomUUID()}`;

  return {
    upstreamAccessToken,
    code: {
      authorizationCode: `code-${crypto.randomUUID()}`,
      client: input.client,
      redirectUri: input.redirectUri,
      user: { id: 'user-1', name: 'User', email: 'user@example.com' },
      expiresAt: new Date(Date.now() + 60_000),
      token: {
        access_token: upstreamAccessToken,
        refresh_token: `upstream-refresh-${crypto.randomUUID()}`,
        access_token_expires_at: Date.now() + 3_600_000,
      },
      scope: input.scope,
      grant: input.grant,
    },
  };
};

/** Counts calls to the store's code and refresh token lookups. */
const countedLookups = () => {
  const calls = { authorizationCodes: [] as string[], refreshTokens: 0 };

  const overrides: Partial<StoreOperations> = {
    findAuthorizationCode: ({ code }) =>
      Effect.sync(() => {
        calls.authorizationCodes.push(code);
      }).pipe(Effect.andThen(Effect.succeedNone)),
    findRefreshToken: () =>
      Effect.sync(() => {
        calls.refreshTokens += 1;
      }).pipe(Effect.andThen(Effect.succeedNone)),
  };

  return { calls, overrides };
};

const savedAccessToken = async (accessToken: string) =>
  onStore((store) => store.findAccessToken({ accessToken }));

describe('/api/token route integration', () => {
  afterAll(async () => {
    await Promise.all(handlers.map(async (handler) => handler.dispose()));
  });

  it('persists authorization-code grant context onto saved access token', async () => {
    const client = publicClient();
    const grant = {
      projectId: 'proj_123',
      scopes: ['querying', 'schema'],
      roleName: 'mcp_pinned_reader',
    };
    const { code, upstreamAccessToken } = authorizationCode({
      client,
      redirectUri: REDIRECT_URI,
      scope: 'read write',
      grant,
    });

    await onStore((store) =>
      store
        .saveClient({ client, registerHeaders: {} })
        .pipe(Effect.andThen(store.saveAuthorizationCode({ code }))),
    );

    const analytics = recordingAnalytics();

    const response = await appWith(analytics.layer).handler(
      tokenRequest({
        grant_type: 'authorization_code',
        client_id: client.id,
        code: code.authorizationCode,
        redirect_uri: REDIRECT_URI,
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      access_token: upstreamAccessToken,
    });
    await expect(savedAccessToken(upstreamAccessToken)).resolves.toMatchObject(
      Option.some({ grant }),
    );
    expect(analytics.identified).toStrictEqual([
      {
        account: {
          id: 'user-1',
          name: 'User',
          email: 'user@example.com',
          isOrg: false,
        },
        params: {
          context: {
            authMethod: 'oauth',
            client: { id: client.id, name: 'Token Route Test Client' },
          },
        },
      },
    ]);
  });

  it('returns the authorization code scope including * on the token', async () => {
    const client = publicClient();
    const { code, upstreamAccessToken } = authorizationCode({
      client,
      redirectUri: REDIRECT_URI,
      scope: 'read write *',
      grant: { projectId: null, scopes: null },
    });

    await onStore((store) =>
      store
        .saveClient({ client, registerHeaders: {} })
        .pipe(Effect.andThen(store.saveAuthorizationCode({ code }))),
    );

    const response = await appWith(recordingAnalytics().layer).handler(
      tokenRequest({
        grant_type: 'authorization_code',
        client_id: client.id,
        code: code.authorizationCode,
        redirect_uri: REDIRECT_URI,
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      access_token: upstreamAccessToken,
      token_type: 'bearer',
      scope: 'read write *',
    });
  });

  describe('redirect_uri on authorization_code exchange', () => {
    // Claude Code's client ID metadata document registers loopback
    // callbacks without a port and listens on a random one.
    const portlessClient = {
      id: 'https://claude.ai/oauth/claude-code-client-metadata',
      tokenEndpointAuthMethod: 'none',
      redirect_uris: ['http://localhost/callback', 'http://127.0.0.1/callback'],
      grants: ['authorization_code', 'refresh_token'],
      client_name: 'Claude Code',
    };

    const exchange = async (redirectUri: string) => {
      const { code, upstreamAccessToken } = authorizationCode({
        client: portlessClient,
        redirectUri: 'http://localhost:54321/callback',
        scope: 'read',
        grant: { projectId: null, scopes: null },
      });

      await onStore((store) => store.saveAuthorizationCode({ code }));

      const response = await appWith(
        Layer.mergeAll(
          storeWith({
            findClient: () => Effect.succeedSome(portlessClient),
          }),
          recordingAnalytics().layer,
        ),
      ).handler(
        tokenRequest({
          grant_type: 'authorization_code',
          client_id: portlessClient.id,
          code: code.authorizationCode,
          redirect_uri: redirectUri,
        }),
      );

      return { response, upstreamAccessToken };
    };

    it('accepts the loopback redirect the code was issued for', async () => {
      const { response } = await exchange('http://localhost:54321/callback');

      expect(response.status).toBe(200);
    });

    it('rejects a redirect that is neither bound to the code nor registered', async () => {
      const { response, upstreamAccessToken } = await exchange(
        'http://localhost:60000/callback',
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toStrictEqual({
        error: 'invalid_request',
        error_description: 'Invalid redirect URI',
      });
      await expect(
        savedAccessToken(upstreamAccessToken),
      ).resolves.toStrictEqual(Option.none());
    });
  });

  describe('a metadata-document client that declared private_key_jwt', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'k1' };
    const client = {
      id: 'https://chatgpt.example/oauth/client.json',
      tokenEndpointAuthMethod: 'private_key_jwt',
      jwks: { keys: [jwk] },
      redirect_uris: ['https://chatgpt.example/callback'],
      grants: ['authorization_code', 'refresh_token'],
      client_name: 'ChatGPT',
    };

    const appCounting = (lookups: ReturnType<typeof countedLookups>) =>
      appWith(
        storeWith({
          findClient: () => Effect.succeedSome(client),
          ...lookups.overrides,
        }),
      );

    it('is refused without an assertion before its refresh token is read', async () => {
      const lookups = countedLookups();

      const response = await appCounting(lookups).handler(
        tokenRequest({
          grant_type: 'refresh_token',
          client_id: client.id,
          refresh_token: 'refresh-123',
        }),
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: 'invalid_client',
      });
      expect(lookups.calls.refreshTokens).toBe(0);
    });

    it('authenticates with a signed assertion', async () => {
      const assertion = await new SignJWT({})
        .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuer(client.id)
        .setSubject(client.id)
        .setAudience(`${SERVER_HOST}/api/token`)
        .setExpirationTime('1m')
        .sign(privateKey);
      const lookups = countedLookups();

      const response = await appCounting(lookups).handler(
        tokenRequest({
          grant_type: 'authorization_code',
          client_id: client.id,
          code: 'code-123',
          client_assertion_type: CLIENT_ASSERTION_TYPE,
          client_assertion: assertion,
        }),
      );

      // Authenticated, so the request reaches the code lookup; the code is
      // unknown to this test's store.
      expect(lookups.calls.authorizationCodes).toStrictEqual(['code-123']);
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toStrictEqual({
        error: 'invalid_grant',
        error_description: 'Invalid authorization code',
      });
    });
  });

  it('answers 503 and consumes nothing when the client metadata document is unreadable', async () => {
    const lookups = countedLookups();

    const response = await appWith(
      storeWith({
        findClient: () =>
          Effect.fail(
            ClientMetadataUnavailable.make({
              cause: new Error('answered 502'),
            }),
          ),
        ...lookups.overrides,
      }),
    ).handler(
      tokenRequest({
        grant_type: 'refresh_token',
        client_id: 'https://client.example.com/oauth/metadata.json',
        refresh_token: 'refresh-123',
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: 'temporarily_unavailable',
    });
    expect(lookups.calls.refreshTokens).toBe(0);
    expect(lookups.calls.authorizationCodes).toStrictEqual([]);
  });
});
