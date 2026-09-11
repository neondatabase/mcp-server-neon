import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../../app/callback/route';
import { model } from '../oauth/model';
import { exchangeCode } from '../../lib/oauth/client';
import { resolveAccountFromAuth } from '../server/account';
import { logger } from '../utils/logger';
import { seedApprovedTransaction } from './auth-transaction-fixtures';
import { ensureTestOauthDatabase } from './ensure-test-oauth-database';
import { AUTH_RESTART_DESCRIPTION } from '../oauth/consent-html-headers';
import { createAuthTransactionStore } from '../oauth/auth-transaction-store';
import { consentCookieName } from '../oauth/browser-binding';

vi.mock('../oauth/model', () => ({
  model: {
    getClient: vi.fn(),
    saveAuthorizationCode: vi.fn(),
  },
}));

vi.mock('../../lib/oauth/client', () => ({
  exchangeCode: vi.fn(),
}));

vi.mock('../oauth/utils', () => ({
  generateRandomString: vi.fn(() => 'fixed-random'),
}));

vi.mock('../server/api', () => ({
  createNeonClient: vi.fn(() => ({
    getAuthDetails: vi.fn(async () => ({ data: { auth_method: 'session' } })),
  })),
}));

vi.mock('../server/account', () => ({
  resolveAccountFromAuth: vi.fn(),
}));

function buildRequest(state: string, cookie: string): NextRequest {
  const url = `http://localhost/callback?code=upstream-code&state=${encodeURIComponent(state)}`;
  return new NextRequest(url, {
    method: 'GET',
    headers: { cookie },
  });
}

function buildErrorRequest(
  state: string,
  cookie: string,
  error: string,
  errorDescription?: string,
): NextRequest {
  const qs = new URLSearchParams({ error, state });
  if (errorDescription) qs.set('error_description', errorDescription);
  return new NextRequest(`http://localhost/callback?${qs.toString()}`, {
    method: 'GET',
    headers: { cookie },
  });
}

describe('/callback route integration', () => {
  beforeAll(async () => {
    await ensureTestOauthDatabase();
  });

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(model.getClient).mockResolvedValue({
      id: 'client-123',
      client_name: 'Callback Test Client',
      redirect_uris: ['http://127.0.0.1:55667/callback'],
    } as never);

    vi.mocked(exchangeCode).mockResolvedValue({
      access_token: 'upstream-access',
      refresh_token: 'upstream-refresh',
      id_token: 'upstream-id-token',
      expiresIn: () => 3600,
    } as never);

    vi.mocked(resolveAccountFromAuth).mockResolvedValue({
      id: 'user-1',
      name: 'User',
      email: 'user@example.com',
      isOrg: false,
    } as never);
    vi.mocked(model.saveAuthorizationCode).mockResolvedValue({} as never);
  });

  it('persists the approved grant and scopes from the transaction', async () => {
    const seeded = await seedApprovedTransaction({
      request: {
        responseType: 'code',
        clientId: 'client-123',
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

    const response = await GET(buildRequest(seeded.id, seeded.cookie));

    expect(response.status).toBe(307);
    expect(exchangeCode).toHaveBeenCalledWith(expect.any(URL), seeded.id);
    expect(model.saveAuthorizationCode).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'read',
        grant: {
          projectId: 'proj-123',
          scopes: ['querying', 'schema'],
        },
      }),
    );
  });

  it('preserves * on the issued scope when the approved transaction includes it', async () => {
    const seeded = await seedApprovedTransaction({
      approvedScopes: ['read', 'write', '*'],
    });
    const response = await GET(buildRequest(seeded.id, seeded.cookie));
    expect(response.status).toBe(307);
    expect(model.saveAuthorizationCode).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'read write *',
      }),
    );
  });

  it('rejects unsigned JSON state without minting a code', async () => {
    const state = btoa(
      JSON.stringify({
        responseType: 'code',
        clientId: 'client-123',
        redirectUri: 'https://attacker.example/callback',
        scope: ['read', 'write'],
        state: 'client-state',
      }),
    );
    const response = await GET(buildRequest(state, ''));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_request',
      error_description: AUTH_RESTART_DESCRIPTION,
    });
    expect(exchangeCode).not.toHaveBeenCalled();
    expect(model.saveAuthorizationCode).not.toHaveBeenCalled();
  });

  it('rejects a pending transaction at callback', async () => {
    const { seedPendingTransaction } =
      await import('./auth-transaction-fixtures');
    const pending = await seedPendingTransaction();
    const response = await GET(
      buildRequest(
        pending.transaction.id,
        `neon_mcp_at_${pending.transaction.id}=${pending.browserSecret}`,
      ),
    );
    expect(response.status).toBe(400);
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it('rejects an expired approved transaction without minting a code', async () => {
    const seeded = await seedApprovedTransaction();
    const url = process.env.OAUTH_DATABASE_URL;
    if (!url) {
      throw new Error('OAUTH_DATABASE_URL is required');
    }
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(url);
    await sql`
      UPDATE mcpauth.auth_transactions
      SET expires_at = now() - interval '1 minute'
      WHERE id = ${seeded.id}
    `;
    const response = await GET(buildRequest(seeded.id, seeded.cookie));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_request',
      error_description: AUTH_RESTART_DESCRIPTION,
    });
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it('rejects a swapped cookie from another browser', async () => {
    const first = await seedApprovedTransaction();
    const second = await seedApprovedTransaction();
    const response = await GET(
      buildRequest(
        second.id,
        `${consentCookieName(second.id)}=${first.browserSecret}`,
      ),
    );
    expect(response.status).toBe(400);
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it('lets only one concurrent callback consume the approval', async () => {
    const seeded = await seedApprovedTransaction();
    const [first, second] = await Promise.all([
      GET(buildRequest(seeded.id, seeded.cookie)),
      GET(buildRequest(seeded.id, seeded.cookie)),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([307, 400]);
    expect(model.saveAuthorizationCode).toHaveBeenCalledTimes(1);
  });

  it('relays upstream `error=error` to the original client redirect and state', async () => {
    const seeded = await seedApprovedTransaction();
    const response = await GET(
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
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it('relays upstream `access_denied` to client redirect_uri', async () => {
    const seeded = await seedApprovedTransaction();
    const response = await GET(
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
        clientId: 'client-123',
        redirectUri: 'https://attacker.example/callback',
        scope: ['read', 'write'],
        state: 'stolen',
      }),
    );
    const response = await GET(
      buildErrorRequest(forged, '', 'access_denied', 'denied'),
    );
    expect(response.status).toBe(400);
    expect(response.headers.get('location')).toBeNull();
  });

  it('classifies `request_unauthorized` as correct_consent_expired', async () => {
    const sloSpy = vi.spyOn(logger, 'info');
    const seeded = await seedApprovedTransaction();
    await GET(
      buildErrorRequest(
        seeded.id,
        seeded.cookie,
        'request_unauthorized',
        'The login request has expired. Please try again.',
      ),
    );
    const sloLine = sloSpy.mock.calls
      .map(([msg]) => String(msg))
      .find((m) => m.startsWith('[SLO] auth-callback outcome='));
    expect(sloLine).toContain('outcome=correct_consent_expired');
    expect(sloLine).toContain('clientId=client-123');
  });

  it('classifies `request_forbidden` as correct_csrf_mismatch', async () => {
    const sloSpy = vi.spyOn(logger, 'info');
    const seeded = await seedApprovedTransaction();
    await GET(
      buildErrorRequest(
        seeded.id,
        seeded.cookie,
        'request_forbidden',
        'The CSRF value from the token does not match the CSRF value from the data store.',
      ),
    );
    const sloLine = sloSpy.mock.calls
      .map(([msg]) => String(msg))
      .find((m) => m.startsWith('[SLO] auth-callback outcome='));
    expect(sloLine).toContain('outcome=correct_csrf_mismatch');
  });

  it('classifies code-exchange `invalid_grant` as correct_invalid_grant', async () => {
    const sloSpy = vi.spyOn(logger, 'info');
    vi.mocked(exchangeCode).mockRejectedValue(
      Object.assign(new Error('authorization code already used'), {
        status: 400,
        error: 'invalid_grant',
        error_description: 'The authorization code has already been used.',
      }),
    );
    const seeded = await seedApprovedTransaction();
    const response = await GET(buildRequest(seeded.id, seeded.cookie));
    expect(response.status).toBeGreaterThanOrEqual(400);
    const sloLine = sloSpy.mock.calls
      .map(([msg]) => String(msg))
      .find((m) => m.startsWith('[SLO] auth-callback outcome='));
    expect(sloLine).toContain('outcome=correct_invalid_grant');
    expect(sloLine).toContain('clientId=client-123');
  });

  it('still buckets unknown upstream errors as upstream_other_error', async () => {
    const sloSpy = vi.spyOn(logger, 'info');
    const seeded = await seedApprovedTransaction();
    await GET(
      buildErrorRequest(
        seeded.id,
        seeded.cookie,
        'unmappable_new_code',
        'Something new',
      ),
    );
    const sloLine = sloSpy.mock.calls
      .map(([msg]) => String(msg))
      .find((m) => m.startsWith('[SLO] auth-callback outcome='));
    expect(sloLine).toContain('outcome=upstream_other_error');
  });

  describe('correct_chatgpt_invalid_request (narrow Hydra reclassification)', () => {
    it('classifies `?error=invalid_request` with rURIHost=chatgpt.com as correct_chatgpt_invalid_request', async () => {
      const sloSpy = vi.spyOn(logger, 'info');
      const seeded = await seedApprovedTransaction({
        request: {
          responseType: 'code',
          clientId: 'client-123',
          redirectUri: 'https://chatgpt.com/connector/oauth/aF1iFlAFZjHP',
          scope: ['read', 'write'],
          state: 'client-state',
          resource: 'https://mcp.neon.tech/mcp',
          codeChallenge: 'pkce-test',
          codeChallengeMethod: 'S256',
        },
      });
      await GET(
        buildErrorRequest(
          seeded.id,
          seeded.cookie,
          'invalid_request',
          'The request is missing a required parameter, ...',
        ),
      );
      const sloLine = sloSpy.mock.calls
        .map(([msg]) => String(msg))
        .find((m) => m.startsWith('[SLO] auth-callback outcome='));
      expect(sloLine).toContain('outcome=correct_chatgpt_invalid_request');
      expect(sloLine).toContain('rURIHost=chatgpt.com');
    });

    it('classifies code-exchange `invalid_request` with rURIHost=chatgpt.com as correct_chatgpt_invalid_request', async () => {
      const sloSpy = vi.spyOn(logger, 'info');
      vi.mocked(exchangeCode).mockRejectedValue(
        Object.assign(new Error('bad request'), {
          status: 400,
          error: 'invalid_request',
          error_description: 'The request is missing a required parameter, ...',
        }),
      );
      const seeded = await seedApprovedTransaction({
        request: {
          responseType: 'code',
          clientId: 'client-123',
          redirectUri: 'https://chatgpt.com/connector/oauth/aF1iFlAFZjHP',
          scope: ['read', 'write'],
          state: 'client-state',
        },
      });
      await GET(buildRequest(seeded.id, seeded.cookie));
      const sloLine = sloSpy.mock.calls
        .map(([msg]) => String(msg))
        .find((m) => m.startsWith('[SLO] auth-callback outcome='));
      expect(sloLine).toContain('outcome=correct_chatgpt_invalid_request');
      expect(sloLine).toContain('rURIHost=chatgpt.com');
    });

    it('does NOT reclassify when rURIHost is localhost', async () => {
      const sloSpy = vi.spyOn(logger, 'info');
      const seeded = await seedApprovedTransaction({
        request: {
          responseType: 'code',
          clientId: 'client-123',
          redirectUri: 'http://localhost:55667/oauth/callback',
          scope: ['read', 'write'],
          state: 'client-state',
        },
      });
      await GET(
        buildErrorRequest(
          seeded.id,
          seeded.cookie,
          'invalid_request',
          'malformed redirect_uri',
        ),
      );
      const sloLine = sloSpy.mock.calls
        .map(([msg]) => String(msg))
        .find((m) => m.startsWith('[SLO] auth-callback outcome='));
      expect(sloLine).toContain('outcome=upstream_other_error');
      expect(sloLine).toContain('rURIHost=localhost');
    });

    it('does NOT reclassify when rURIHost is some other 3rd-party connector', async () => {
      const sloSpy = vi.spyOn(logger, 'info');
      const seeded = await seedApprovedTransaction({
        request: {
          responseType: 'code',
          clientId: 'client-123',
          redirectUri: 'https://tasklet.ai/oauth/callback',
          scope: ['read', 'write'],
          state: 'client-state',
        },
      });
      await GET(
        buildErrorRequest(
          seeded.id,
          seeded.cookie,
          'invalid_request',
          'bad params',
        ),
      );
      const sloLine = sloSpy.mock.calls
        .map(([msg]) => String(msg))
        .find((m) => m.startsWith('[SLO] auth-callback outcome='));
      expect(sloLine).toContain('outcome=upstream_other_error');
      expect(sloLine).toContain('rURIHost=tasklet.ai');
    });

    it('does NOT reclassify when chatgpt.com hits a non-invalid_request error', async () => {
      const sloSpy = vi.spyOn(logger, 'info');
      const seeded = await seedApprovedTransaction({
        request: {
          responseType: 'code',
          clientId: 'client-123',
          redirectUri: 'https://chatgpt.com/connector/oauth/aF1iFlAFZjHP',
          scope: ['read', 'write'],
          state: 'client-state',
        },
      });
      await GET(
        buildErrorRequest(
          seeded.id,
          seeded.cookie,
          'request_forbidden',
          'The CSRF value from the token does not match the CSRF value from the data store.',
        ),
      );
      const sloLine = sloSpy.mock.calls
        .map(([msg]) => String(msg))
        .find((m) => m.startsWith('[SLO] auth-callback outcome='));
      expect(sloLine).toContain('outcome=correct_csrf_mismatch');
    });
  });

  describe('downstream-request fingerprint on upstream errors', () => {
    it('emits stateLen, stateFp, scopeCount and redirectUri host/path', async () => {
      const sloSpy = vi.spyOn(logger, 'info');
      const seeded = await seedApprovedTransaction({
        request: {
          responseType: 'code',
          clientId: 'client-123',
          redirectUri: 'http://127.0.0.1:55667/callback',
          scope: ['read', 'write'],
          state: 'client-state',
          resource: 'https://mcp.neon.tech/mcp?projectId=p-1',
          codeChallenge: 'pkce-abc',
          codeChallengeMethod: 'S256',
        },
      });
      await GET(
        buildErrorRequest(
          seeded.id,
          seeded.cookie,
          'invalid_request',
          'The request is missing a required parameter, ...',
        ),
      );
      const sloLine = sloSpy.mock.calls
        .map(([msg]) => String(msg))
        .find((m) => m.startsWith('[SLO] auth-callback outcome='));
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
      const sloSpy = vi.spyOn(logger, 'info');
      const seeded = await seedApprovedTransaction({
        request: {
          responseType: 'code',
          clientId: 'client-123',
          redirectUri: 'http://127.0.0.1:55667/callback',
          scope: ['read', 'write'],
          state: 'secret-downstream-state-do-not-leak',
        },
      });
      await GET(
        buildErrorRequest(
          seeded.id,
          seeded.cookie,
          'invalid_request',
          'malformed',
        ),
      );
      const sloLine = sloSpy.mock.calls
        .map(([msg]) => String(msg))
        .find((m) => m.startsWith('[SLO] auth-callback outcome='));
      expect(sloLine).not.toContain('secret-downstream-state-do-not-leak');
      expect(sloLine).not.toContain(seeded.browserSecret);
    });

    it('includes the fingerprint on the code-exchange catch path too', async () => {
      const sloSpy = vi.spyOn(logger, 'info');
      vi.mocked(exchangeCode).mockRejectedValue(
        Object.assign(new Error('bad request'), {
          status: 400,
          error: 'invalid_grant',
          error_description: 'The authorization code has already been used.',
        }),
      );
      const seeded = await seedApprovedTransaction();
      await GET(buildRequest(seeded.id, seeded.cookie));
      const sloLine = sloSpy.mock.calls
        .map(([msg]) => String(msg))
        .find((m) => m.startsWith('[SLO] auth-callback outcome='));
      expect(sloLine).toContain('outcome=correct_invalid_grant');
      expect(sloLine).toContain(`stateLen=${seeded.id.length}`);
      expect(sloLine).toContain('scopeCount=2');
    });
  });

  it('falls back to JSON 400 when upstream error arrives without state', async () => {
    const response = await GET(
      new NextRequest('http://localhost/callback?error=server_error', {
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
    const response = await GET(
      new NextRequest(
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
    const response = await GET(
      new NextRequest('http://localhost/callback', { method: 'GET' }),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_request',
      error_description: 'Missing code or state',
    });
  });

  describe('internal_error + pg-connect retry', () => {
    type PgConnectError = Error & { code: string };
    const makePgXX000Error = (): PgConnectError => {
      const err = new Error("Couldn't connect to compute node");
      return Object.assign(err, { code: 'XX000' });
    };

    it('emits internal_error SLO line with clientId when KV first call fails', async () => {
      const sloSpy = vi.spyOn(logger, 'info');
      vi.mocked(model.getClient).mockRejectedValue(
        new Error('unexpected non-pg failure'),
      );
      const seeded = await seedApprovedTransaction();
      const response = await GET(buildRequest(seeded.id, seeded.cookie));
      expect(response.status).toBeGreaterThanOrEqual(500);
      const sloLine = sloSpy.mock.calls
        .map(([msg]) => String(msg))
        .find((m) =>
          m.startsWith('[SLO] auth-callback outcome=internal_error'),
        );
      expect(sloLine).toContain('clientId=client-123');
      expect(sloLine).toContain('reason=Error');
    });

    it('retries once and succeeds when the first KV call hits Postgres XX000', async () => {
      vi.mocked(model.getClient)
        .mockRejectedValueOnce(makePgXX000Error())
        .mockResolvedValue({
          id: 'client-123',
          client_name: 'Callback Test Client',
          redirect_uris: ['http://127.0.0.1:55667/callback'],
        } as never);
      const seeded = await seedApprovedTransaction();
      const response = await GET(buildRequest(seeded.id, seeded.cookie));
      expect(response.status).toBe(307);
      expect(model.getClient).toHaveBeenCalledTimes(2);
    });

    it('exhausts retries on persistent XX000 and emits internal_error with pg_connect_failure reason', async () => {
      const sloSpy = vi.spyOn(logger, 'info');
      vi.mocked(model.getClient).mockRejectedValue(makePgXX000Error());
      const seeded = await seedApprovedTransaction();
      const response = await GET(buildRequest(seeded.id, seeded.cookie));
      expect(response.status).toBeGreaterThanOrEqual(500);
      expect(model.getClient).toHaveBeenCalledTimes(2);
      const sloLine = sloSpy.mock.calls
        .map(([msg]) => String(msg))
        .find((m) =>
          m.startsWith('[SLO] auth-callback outcome=internal_error'),
        );
      expect(sloLine).toContain('clientId=client-123');
      expect(sloLine).toContain('reason=pg_connect_failure');
    });
  });

  it('reads an approved transaction from a second store instance', async () => {
    const seeded = await seedApprovedTransaction({
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
