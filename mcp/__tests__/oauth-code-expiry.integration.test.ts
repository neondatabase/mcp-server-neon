/**
 * Authorization code expiry through /api/token and the real OAuth Postgres
 * database: the code row is stored as JSON, so its expiry reads back as a
 * string, and an expired code must still be refused.
 */
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { ensureTestOauthDatabase } from './ensure-test-oauth-database';

process.env.NEON_MCP_DISABLE_ANALYTICS = '1';

await ensureTestOauthDatabase();

const { model } = await import('../oauth/model');

const { POST } = await import('../../app/api/token/route');

const client = { id: `code-expiry-${randomUUID()}`, secret: 'code-expiry' };

const REDIRECT_URI = 'http://localhost/callback';

await model.saveClient({
  id: client.id,
  secret: client.secret,
  grants: ['authorization_code', 'refresh_token'],
  redirect_uris: [REDIRECT_URI],
  tokenEndpointAuthMethod: 'client_secret_post',
  client_name: 'Code expiry test',
});

/** Stores a code for `client` that expires `expiresInMs` from now. */
const storeCode = async (expiresInMs: number) => {
  const authorizationCode = `code-${randomUUID()}`;
  const accessToken = `at-${randomUUID()}`;

  await model.saveAuthorizationCode({
    authorizationCode,
    expiresAt: new Date(Date.now() + expiresInMs),
    redirectUri: REDIRECT_URI,
    scope: 'read write',
    client: { id: client.id, grants: [] },
    user: { id: 'user-1', name: 'Test User', email: 'test@example.com' },
    token: {
      access_token: accessToken,
      refresh_token: `rt-${randomUUID()}`,
      access_token_expires_at: Date.now() + 3_600_000,
    },
  });

  return { authorizationCode, accessToken };
};

const exchange = async (authorizationCode: string) => {
  const response = await POST(
    new NextRequest('http://localhost/api/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: authorizationCode,
        redirect_uri: REDIRECT_URI,
        client_id: client.id,
        client_secret: client.secret,
      }).toString(),
    }),
  );

  const body: unknown = await response.json();

  return { status: response.status, body };
};

describe('authorization code expiry', () => {
  it('refuses an expired code and keeps it unexchanged', async () => {
    const { authorizationCode, accessToken } = await storeCode(-1000);

    await expect(exchange(authorizationCode)).resolves.toStrictEqual({
      status: 400,
      body: {
        error: 'invalid_grant',
        error_description: 'Authorization code expired',
      },
    });
    await expect(model.getAccessToken(accessToken)).resolves.toBeUndefined();
  });

  it('exchanges a code that has not expired', async () => {
    const { authorizationCode, accessToken } = await storeCode(60_000);

    const { status, body } = await exchange(authorizationCode);

    expect(status).toBe(200);
    expect(body).toMatchObject({ access_token: accessToken });
    await expect(
      model.getAuthorizationCode(authorizationCode),
    ).resolves.toBeUndefined();
  });
});
