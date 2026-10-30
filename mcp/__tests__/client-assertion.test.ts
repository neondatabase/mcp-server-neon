import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  exportJWK,
  generateKeyPair,
  SignJWT,
  type CryptoKey,
  type JWK,
} from 'jose';
import type { Client } from 'oauth2-server';
import { SERVER_HOST } from '../../lib/config';
import {
  CLIENT_ASSERTION_TYPE,
  clientIdFromAssertion,
  createClientAssertionVerifier,
} from '../../lib/oauth/client-assertion';
import { authenticateClient } from '../../lib/oauth/client-credentials';
import {
  ClientMetadataUnavailableError,
  type FetchMetadataDocument,
} from '../../lib/oauth/client-id-metadata-document';

const CLIENT_ID = 'https://client.example.com/oauth/client.json';
const JWKS_URI = 'https://client.example.com/oauth/jwks.json';
const TOKEN_ENDPOINT = `${SERVER_HOST}/api/token`;

type Key = { privateKey: CryptoKey; jwk: JWK };

async function makeKey(kid: string): Promise<Key> {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  return { privateKey, jwk: { ...(await exportJWK(publicKey)), kid } };
}

function sign(
  key: Key,
  claims: {
    iss?: string;
    sub?: string;
    aud?: string;
    expiresIn?: number;
  } = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: key.jwk.kid })
    .setIssuer(claims.iss ?? CLIENT_ID)
    .setSubject(claims.sub ?? CLIENT_ID)
    .setAudience(claims.aud ?? TOKEN_ENDPOINT)
    .setJti(crypto.randomUUID())
    .setExpirationTime(now + (claims.expiresIn ?? 60))
    .sign(key.privateKey);
}

const jwksResponse = (...keys: Key[]) => ({
  status: 200,
  contentType: 'application/json',
  cacheControl: 'public, max-age=300',
  body: JSON.stringify({ keys: keys.map((key) => key.jwk) }),
});

const cimdClient: Client = {
  id: CLIENT_ID,
  grants: ['authorization_code', 'refresh_token'],
  tokenEndpointAuthMethod: 'private_key_jwt',
  jwks_uri: JWKS_URI,
};

describe('client assertion verification', () => {
  let key: Key;
  let otherKey: Key;

  beforeAll(async () => {
    key = await makeKey('k1');
    otherKey = await makeKey('k2');
  });

  const verifierFor = (...keys: Key[]) =>
    createClientAssertionVerifier(async () => jwksResponse(...keys));

  it('accepts an assertion signed by a key in the client JWKS', async () => {
    const verify = verifierFor(key);
    expect(
      await verify(cimdClient, await sign(key), CLIENT_ASSERTION_TYPE),
    ).toBe(true);
  });

  it('accepts the issuer identifier as the audience', async () => {
    const verify = verifierFor(key);
    expect(
      await verify(
        cimdClient,
        await sign(key, { aud: SERVER_HOST }),
        CLIENT_ASSERTION_TYPE,
      ),
    ).toBe(true);
  });

  it.each([
    ['another issuer', { iss: 'https://evil.example/client.json' }],
    ['another subject', { sub: 'https://evil.example/client.json' }],
    ['another audience', { aud: 'https://other-as.example/token' }],
    ['an expired token', { expiresIn: -120 }],
    ['a lifetime over five minutes', { expiresIn: 3600 }],
  ])('rejects %s', async (_, claims) => {
    const verify = verifierFor(key);
    expect(
      await verify(cimdClient, await sign(key, claims), CLIENT_ASSERTION_TYPE),
    ).toBe(false);
  });

  it('rejects an assertion signed by a key outside the JWKS', async () => {
    const verify = verifierFor(key);
    const assertion = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(CLIENT_ID)
      .setSubject(CLIENT_ID)
      .setAudience(TOKEN_ENDPOINT)
      .setExpirationTime('1m')
      .sign(otherKey.privateKey);
    expect(await verify(cimdClient, assertion, CLIENT_ASSERTION_TYPE)).toBe(
      false,
    );
  });

  it('rejects a missing assertion or the wrong assertion type', async () => {
    const verify = verifierFor(key);
    expect(await verify(cimdClient, undefined, CLIENT_ASSERTION_TYPE)).toBe(
      false,
    );
    expect(await verify(cimdClient, await sign(key), 'urn:example:other')).toBe(
      false,
    );
  });

  it('refetches the JWKS once when a rotated key is not cached yet', async () => {
    const fetchDocument = vi
      .fn<FetchMetadataDocument>()
      .mockResolvedValueOnce(jwksResponse(key))
      .mockResolvedValueOnce(jwksResponse(key, otherKey));
    const verify = createClientAssertionVerifier(fetchDocument);

    expect(
      await verify(cimdClient, await sign(key), CLIENT_ASSERTION_TYPE),
    ).toBe(true);
    expect(
      await verify(cimdClient, await sign(otherKey), CLIENT_ASSERTION_TYPE),
    ).toBe(true);
    expect(fetchDocument).toHaveBeenCalledTimes(2);
  });

  it('throws ClientMetadataUnavailableError when the JWKS host is down', async () => {
    const verify = createClientAssertionVerifier(async () => ({
      status: 503,
      contentType: 'text/plain',
      cacheControl: undefined,
      body: '',
    }));
    await expect(
      verify(cimdClient, await sign(key), CLIENT_ASSERTION_TYPE),
    ).rejects.toBeInstanceOf(ClientMetadataUnavailableError);
  });

  it('refuses a non-https jwks_uri without fetching it', async () => {
    const fetchDocument = vi.fn<FetchMetadataDocument>();
    const verify = createClientAssertionVerifier(fetchDocument);
    expect(
      await verify(
        { ...cimdClient, jwks_uri: 'http://client.example.com/jwks.json' },
        await sign(key),
        CLIENT_ASSERTION_TYPE,
      ),
    ).toBe(false);
    expect(fetchDocument).not.toHaveBeenCalled();
  });

  it('verifies against inline jwks without fetching', async () => {
    const fetchDocument = vi.fn<FetchMetadataDocument>();
    const verify = createClientAssertionVerifier(fetchDocument);
    expect(
      await verify(
        { ...cimdClient, jwks_uri: undefined, jwks: { keys: [key.jwk] } },
        await sign(key),
        CLIENT_ASSERTION_TYPE,
      ),
    ).toBe(true);
    expect(fetchDocument).not.toHaveBeenCalled();
  });

  it('reads the client_id from an assertion when the request omits it', async () => {
    expect(clientIdFromAssertion(await sign(key))).toBe(CLIENT_ID);
    expect(clientIdFromAssertion('not-a-jwt')).toBeUndefined();
  });
});

describe('authenticateClient', () => {
  const credentials = {
    clientId: undefined,
    clientSecret: undefined,
    clientAssertion: undefined,
    clientAssertionType: undefined,
  };

  it('requires an assertion from a metadata-document client that declared private_key_jwt', async () => {
    expect(
      await authenticateClient(
        { ...cimdClient, jwks: { keys: [] } },
        credentials,
      ),
    ).toBe(false);
  });

  it('still accepts the secret of a registered client that registered private_key_jwt', async () => {
    expect(
      await authenticateClient(
        {
          id: 'aB3dE5fG',
          grants: ['authorization_code'],
          tokenEndpointAuthMethod: 'private_key_jwt',
          secret: 'registered-secret',
        },
        { ...credentials, clientSecret: 'registered-secret' },
      ),
    ).toBe(true);
  });

  it('accepts a public client without credentials', async () => {
    expect(
      await authenticateClient(
        { ...cimdClient, tokenEndpointAuthMethod: 'none' },
        credentials,
      ),
    ).toBe(true);
  });

  it('compares the secret of a client_secret_post client', async () => {
    const client: Client = {
      id: 'aB3dE5fG',
      grants: ['authorization_code'],
      tokenEndpointAuthMethod: 'client_secret_post',
      secret: 's3cret',
    };
    expect(
      await authenticateClient(client, {
        ...credentials,
        clientSecret: 's3cret',
      }),
    ).toBe(true);
    expect(
      await authenticateClient(client, {
        ...credentials,
        clientSecret: 'nope',
      }),
    ).toBe(false);
  });
});
