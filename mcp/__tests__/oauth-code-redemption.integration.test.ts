/**
 * The authorization_code grant against the real OAuth Postgres database: PKCE
 * verification, the non-PKCE redirect_uri path, single use, and what each
 * answer leaves in the code and token tables. Codes are stored in the shape
 * /callback writes.
 */
import { randomUUID } from 'node:crypto';
import type { AuthorizationCode } from 'oauth2-server';
import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

process.env.ANALYTICS_WRITE_KEY = '';

process.env.SENTRY_DSN = '';

const { ensureTestOauthDatabase } =
  await import('./ensure-test-oauth-database');

await ensureTestOauthDatabase();

const { POST } = await import('../../app/api/token/route');

const { SERVER_HOST } = await import('../../lib/config');

const { model } = await import('../oauth/model');

const { getAuthorizationCodes, getClients, getRefreshTokens, getTokens } =
  await import('../oauth/kv-store');

// The pair from RFC 7636 Appendix B, so the challenge is not computed by the
// code under test.
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

const REDIRECT_URI = 'http://127.0.0.1:55667/callback';

const client = {
  id: `code-redemption-${randomUUID()}`,
  secret: '',
  tokenEndpointAuthMethod: 'none',
  redirect_uris: [REDIRECT_URI],
  grants: ['authorization_code', 'refresh_token'],
  client_name: 'Code Redemption Test Client',
};

const user = {
  id: 'user-redeem',
  name: 'Test User',
  email: 'test@example.com',
  isOrg: false,
};

const grant = {
  projectId: 'proj-redeem',
  scopes: ['querying', 'schema'],
  roleName: 'mcp_pinned_reader',
};

await model.saveClient(client);

type Issued = {
  readonly code: string;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly accessTokenExpiresAt: number;
};

const issued: Issued[] = [];

const issueCode = async (pkce: boolean): Promise<Issued> => {
  const now = Date.now();

  const code: Issued = {
    code: `code-redemption-${randomUUID()}`,
    accessToken: `at-${randomUUID()}`,
    refreshToken: `rt-${randomUUID()}`,
    accessTokenExpiresAt: now + 3_600_000,
  };

  const record: AuthorizationCode = {
    authorizationCode: code.code,
    expiresAt: new Date(now + 600_000),
    createdAt: now,
    redirectUri: REDIRECT_URI,
    scope: 'read write',
    client,
    user,
    token: {
      access_token: code.accessToken,
      access_token_expires_at: code.accessTokenExpiresAt,
      refresh_token: code.refreshToken,
    },
    grant,
  };

  if (pkce) {
    record.code_challenge = CHALLENGE;
    record.code_challenge_method = 'S256';
  }

  await model.saveAuthorizationCode(record);
  issued.push(code);

  return code;
};

type Redeemed = { readonly status: number; readonly body: string };

const redeem = async (
  code: string,
  fields: Record<string, string>,
): Promise<Redeemed> => {
  const response = await POST(
    new Request(`${SERVER_HOST}/api/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: client.id,
        code,
        ...fields,
      }).toString(),
    }),
  );

  return { status: response.status, body: await response.text() };
};

const errorBody = (error: string, description: string) =>
  JSON.stringify({ error, error_description: description });

const TokenResponse = z.strictObject({
  access_token: z.string(),
  expires_in: z.number().int().min(0).max(3600),
  token_type: z.string(),
  refresh_token: z.string(),
  scope: z.string(),
});

// expires_in counts down with the clock, so it is checked for range only.
const issuedTokens = ({ status, body }: Redeemed) => {
  const { expires_in: _expiresIn, ...tokens } = TokenResponse.parse(
    JSON.parse(body),
  );

  return { status, tokens };
};

const tokensOf = (code: Issued) => ({
  access_token: code.accessToken,
  token_type: 'bearer',
  refresh_token: code.refreshToken,
  scope: 'read write',
});

// The rows exactly as stored, expiry included.
const rows = async ({ code, accessToken, refreshToken }: Issued) => ({
  code: await getAuthorizationCodes().get(code, { raw: true }),
  token: await getTokens().get(accessToken, { raw: true }),
  refreshToken: await getRefreshTokens().get(refreshToken, { raw: true }),
});

const persisted = async (code: Issued) => ({
  code: await model.getAuthorizationCode(code.code),
  token: await model.getAccessToken(code.accessToken),
  refreshToken: await model.getRefreshToken(code.refreshToken),
});

const grantOf = (code: Issued) => ({
  code: undefined,
  token: {
    accessToken: code.accessToken,
    refreshToken: code.refreshToken,
    expires_at: code.accessTokenExpiresAt,
    client,
    user,
    scope: 'read write',
    grant,
  },
  refreshToken: {
    refreshToken: code.refreshToken,
    accessToken: code.accessToken,
  },
});

describe('authorization_code redemption', () => {
  afterAll(async () => {
    await Promise.all([
      ...issued.flatMap((code) => [
        getAuthorizationCodes().delete(code.code),
        getTokens().delete(code.accessToken),
        getRefreshTokens().delete(code.refreshToken),
      ]),
      getClients().delete(client.id),
    ]);
  });

  it('issues the stored tokens for a valid S256 verifier and consumes the code', async () => {
    const code = await issueCode(true);

    const redeemed = await redeem(code.code, { code_verifier: VERIFIER });

    expect(issuedTokens(redeemed)).toStrictEqual({
      status: 200,
      tokens: tokensOf(code),
    });
    await expect(persisted(code)).resolves.toStrictEqual(grantOf(code));
  });

  it.each([
    ['a wrong verifier', { code_verifier: `${VERIFIER.slice(0, -1)}A` }],
    ['no verifier', {}],
  ])(
    'rejects a PKCE code redeemed with %s and leaves every row as it was',
    async (_, fields) => {
      const code = await issueCode(true);
      const before = await rows(code);

      const response = await redeem(code.code, fields);

      expect(response).toStrictEqual({
        status: 400,
        body: errorBody('invalid_grant', 'Invalid PKCE code verifier'),
      });
      expect(before.code?.value?.authorizationCode).toBe(code.code);
      expect(before.token).toBeUndefined();
      expect(before.refreshToken).toBeUndefined();
      await expect(rows(code)).resolves.toStrictEqual(before);
    },
  );

  it('issues the stored tokens for a code without PKCE redeemed with its redirect_uri', async () => {
    const code = await issueCode(false);

    const redeemed = await redeem(code.code, { redirect_uri: REDIRECT_URI });

    expect(issuedTokens(redeemed)).toStrictEqual({
      status: 200,
      tokens: tokensOf(code),
    });
    await expect(persisted(code)).resolves.toStrictEqual(grantOf(code));
  });

  it('rejects a second redemption of a consumed code and leaves the issued tokens as they were', async () => {
    const code = await issueCode(true);

    const first = await redeem(code.code, { code_verifier: VERIFIER });

    expect(first.status).toBe(200);

    const before = await rows(code);
    const second = await redeem(code.code, { code_verifier: VERIFIER });

    expect(second).toStrictEqual({
      status: 400,
      body: errorBody('invalid_grant', 'Invalid authorization code'),
    });
    expect(before.code).toBeUndefined();
    expect(before.token?.value?.accessToken).toBe(code.accessToken);
    await expect(rows(code)).resolves.toStrictEqual(before);
  });
});
