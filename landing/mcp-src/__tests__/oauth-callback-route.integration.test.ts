import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../../app/callback/route';
import { model } from '../oauth/model';
import { exchangeCode } from '../../lib/oauth/client';
import { resolveAccountFromAuth } from '../server/account';
import { logger } from '../utils/logger';

vi.mock('../oauth/model', () => ({
  model: {
    getClient: vi.fn(),
    getClientAuthContext: vi.fn(),
    deleteClientAuthContext: vi.fn(),
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

function buildState(overrides: Partial<Record<string, unknown>> = {}): string {
  return btoa(
    JSON.stringify({
      responseType: 'code',
      clientId: 'client-123',
      redirectUri: 'http://127.0.0.1:55667/callback',
      scope: ['read', 'write'],
      state: 'client-state',
      ...overrides,
    }),
  );
}

function buildRequest(state: string): NextRequest {
  const url = `http://localhost/callback?code=upstream-code&state=${encodeURIComponent(state)}`;
  return new NextRequest(url, { method: 'GET' });
}

describe('/callback route integration', () => {
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
    vi.mocked(model.getClientAuthContext).mockResolvedValue({
      grant: { projectId: null, scopes: null },
      scope: ['read', 'write'],
      readOnly: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as never);
    vi.mocked(model.deleteClientAuthContext).mockResolvedValue(true);
  });

  it('uses persisted client auth context grant and scope from KV', async () => {
    const resource =
      'https://mcp.neon.tech/mcp?projectId=proj-123&category=querying,schema';
    const state = buildState({ resource });
    vi.mocked(model.getClientAuthContext).mockResolvedValue({
      grant: { projectId: 'proj-123', scopes: ['querying', 'schema'] },
      scope: ['read'],
      readOnly: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as never);

    const response = await GET(buildRequest(state));

    expect(response.status).toBe(307);
    expect(exchangeCode).toHaveBeenCalledWith(expect.any(URL), state);
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

  it('returns invalid_target when resource URI is malformed and KV context missing', async () => {
    const state = buildState({
      resource: '/mcp?projectId=proj-123',
    });
    vi.mocked(model.getClientAuthContext).mockResolvedValue(undefined);

    const response = await GET(buildRequest(state));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_target',
      error_description: 'Invalid resource parameter',
    });
    expect(model.saveAuthorizationCode).not.toHaveBeenCalled();
  });

  it('returns invalid_target when resource URI is not https and KV context missing', async () => {
    const state = buildState({
      resource: 'http://mcp.neon.tech/mcp?projectId=proj-123',
    });
    vi.mocked(model.getClientAuthContext).mockResolvedValue(undefined);

    const response = await GET(buildRequest(state));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_target',
      error_description: 'Invalid resource parameter',
    });
    expect(model.saveAuthorizationCode).not.toHaveBeenCalled();
  });

  it('stores default grant when resource URI is omitted', async () => {
    const state = buildState();
    vi.mocked(model.getClientAuthContext).mockResolvedValue(undefined);

    const response = await GET(buildRequest(state));

    expect(response.status).toBe(307);
    expect(model.saveAuthorizationCode).toHaveBeenCalledWith(
      expect.objectContaining({
        grant: {
          projectId: null,
          scopes: null,
        },
      }),
    );
  });

  // === Upstream error redirect handling (RFC 6749 §4.1.2.1) ===
  // Regression for the production "Missing code or state" bug: Hydra returns
  // ?error=...&state=<ours> instead of ?code=...&state=...; we must relay
  // to the downstream client's redirect_uri instead of swallowing.

  function buildErrorRequest(
    state: string,
    error: string,
    errorDescription?: string,
  ): NextRequest {
    const qs = new URLSearchParams({
      error,
      state,
    });
    if (errorDescription) qs.set('error_description', errorDescription);
    return new NextRequest(`http://localhost/callback?${qs.toString()}`, {
      method: 'GET',
    });
  }

  it('relays upstream `error=error` (Hydra "unrecognizable") to client redirect_uri with state', async () => {
    const state = buildState();
    const response = await GET(
      buildErrorRequest(state, 'error', 'The error is unrecognizable'),
    );

    expect(response.status).toBe(307);
    const location = response.headers.get('location')!;
    const url = new URL(location);
    expect(url.origin + url.pathname).toBe('http://127.0.0.1:55667/callback');
    expect(url.searchParams.get('error')).toBe('error');
    expect(url.searchParams.get('error_description')).toBe(
      'The error is unrecognizable',
    );
    expect(url.searchParams.get('state')).toBe('client-state');
    // We must NOT call exchangeCode when an upstream error redirect arrives.
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it('relays upstream `access_denied` to client redirect_uri (user clicked Cancel)', async () => {
    const state = buildState();
    const response = await GET(
      buildErrorRequest(
        state,
        'access_denied',
        'The resource owner denied the request',
      ),
    );

    expect(response.status).toBe(307);
    const url = new URL(response.headers.get('location')!);
    expect(url.searchParams.get('error')).toBe('access_denied');
    expect(url.searchParams.get('state')).toBe('client-state');
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  // === "correct_*" buckets: Hydra rejecting flows for expected reasons ===
  // Each of these emits an SLO line that counts as GOOD because the system
  // worked as designed — the user can retry without our intervention. See
  // dev-notes/hydra-incident-2026-05-12T13-44Z.md §Update for the source
  // citations against Hydra v1.11.10.

  it('classifies `request_unauthorized` (login/consent expired) as correct_consent_expired', async () => {
    const sloSpy = vi.spyOn(logger, 'info');
    const response = await GET(
      buildErrorRequest(
        buildState(),
        'request_unauthorized',
        'The login request has expired. Please try again.',
      ),
    );

    expect(response.status).toBe(307);
    const sloLine = sloSpy.mock.calls
      .map(([msg]) => String(msg))
      .find((m) => m.startsWith('[SLO] auth-callback outcome='));
    expect(sloLine).toContain('outcome=correct_consent_expired');
    expect(sloLine).toContain('clientId=client-123');
  });

  it('classifies `request_forbidden` (CSRF mismatch) as correct_csrf_mismatch', async () => {
    const sloSpy = vi.spyOn(logger, 'info');
    const response = await GET(
      buildErrorRequest(
        buildState(),
        'request_forbidden',
        'The CSRF value from the token does not match the CSRF value from the data store.',
      ),
    );

    expect(response.status).toBe(307);
    const sloLine = sloSpy.mock.calls
      .map(([msg]) => String(msg))
      .find((m) => m.startsWith('[SLO] auth-callback outcome='));
    expect(sloLine).toContain('outcome=correct_csrf_mismatch');
    expect(sloLine).toContain('clientId=client-123');
  });

  it('classifies code-exchange `invalid_grant` (code reused/expired) as correct_invalid_grant', async () => {
    const sloSpy = vi.spyOn(logger, 'info');
    const upstreamErr = Object.assign(
      new Error('authorization code already used'),
      {
        status: 400,
        error: 'invalid_grant',
        error_description: 'The authorization code has already been used.',
      },
    );
    vi.mocked(exchangeCode).mockRejectedValue(upstreamErr);

    const response = await GET(buildRequest(buildState()));

    // handleOAuthError surfaces this to the client; the important assertion
    // is the SLO bucket.
    expect(response.status).toBeGreaterThanOrEqual(400);
    const sloLine = sloSpy.mock.calls
      .map(([msg]) => String(msg))
      .find((m) => m.startsWith('[SLO] auth-callback outcome='));
    expect(sloLine).toContain('outcome=correct_invalid_grant');
    expect(sloLine).toContain('clientId=client-123');
    expect(sloLine).toContain('upstreamError=invalid_grant');
  });

  it('still buckets unknown upstream errors as upstream_other_error', async () => {
    const sloSpy = vi.spyOn(logger, 'info');
    const response = await GET(
      buildErrorRequest(buildState(), 'unmappable_new_code', 'Something new'),
    );

    expect(response.status).toBe(307);
    const sloLine = sloSpy.mock.calls
      .map(([msg]) => String(msg))
      .find((m) => m.startsWith('[SLO] auth-callback outcome='));
    expect(sloLine).toContain('outcome=upstream_other_error');
  });

  // === correct_chatgpt_invalid_request — narrow Hydra-side reclassification ===
  // ChatGPT's MCP connector uses a shared OAuth client_id across all of its
  // end-users; the shared registration periodically lands in a degraded state
  // on Hydra's side that yields sustained `invalid_request` rejections. Our
  // outbound request shape is uniform and well-formed (verified against
  // successful sessions on the same connector). Counts GOOD so the SLO isn't
  // punished for an upstream/integration issue we can't fix unilaterally.
  // Evidence: dev-notes/3-day-slo-2026-05-21T14Z.md §2 — 28/58 bad events
  // attributed to this single fingerprint on a shared client_id.
  describe('correct_chatgpt_invalid_request (narrow Hydra reclassification)', () => {
    it('classifies `?error=invalid_request` with rURIHost=chatgpt.com as correct_chatgpt_invalid_request', async () => {
      const sloSpy = vi.spyOn(logger, 'info');
      const state = buildState({
        redirectUri: 'https://chatgpt.com/connector/oauth/aF1iFlAFZjHP',
        resource: 'https://mcp.neon.tech/mcp',
        codeChallenge: 'pkce-test',
        codeChallengeMethod: 'S256',
      });

      const response = await GET(
        buildErrorRequest(
          state,
          'invalid_request',
          'The request is missing a required parameter, ...',
        ),
      );

      expect(response.status).toBe(307);
      const sloLine = sloSpy.mock.calls
        .map(([msg]) => String(msg))
        .find((m) => m.startsWith('[SLO] auth-callback outcome='));
      expect(sloLine).toContain('outcome=correct_chatgpt_invalid_request');
      expect(sloLine).toContain('rURIHost=chatgpt.com');
    });

    it('classifies code-exchange `invalid_request` with rURIHost=chatgpt.com as correct_chatgpt_invalid_request', async () => {
      const sloSpy = vi.spyOn(logger, 'info');
      const upstreamErr = Object.assign(new Error('bad request'), {
        status: 400,
        error: 'invalid_request',
        error_description: 'The request is missing a required parameter, ...',
      });
      vi.mocked(exchangeCode).mockRejectedValue(upstreamErr);

      const state = buildState({
        redirectUri: 'https://chatgpt.com/connector/oauth/aF1iFlAFZjHP',
      });

      await GET(buildRequest(state));

      const sloLine = sloSpy.mock.calls
        .map(([msg]) => String(msg))
        .find((m) => m.startsWith('[SLO] auth-callback outcome='));
      expect(sloLine).toContain('outcome=correct_chatgpt_invalid_request');
      expect(sloLine).toContain('rURIHost=chatgpt.com');
    });

    it('does NOT reclassify when rURIHost is localhost (Cursor / Claude Desktop)', async () => {
      const sloSpy = vi.spyOn(logger, 'info');
      const state = buildState({
        redirectUri: 'http://localhost:55667/oauth/callback',
      });

      await GET(
        buildErrorRequest(state, 'invalid_request', 'malformed redirect_uri'),
      );

      const sloLine = sloSpy.mock.calls
        .map(([msg]) => String(msg))
        .find((m) => m.startsWith('[SLO] auth-callback outcome='));
      // Non-chatgpt localhost flows still count BAD until we have evidence
      // their failure mode is also benign — narrow reclassification.
      expect(sloLine).toContain('outcome=upstream_other_error');
      expect(sloLine).toContain('rURIHost=localhost');
    });

    it('does NOT reclassify when rURIHost is some other 3rd-party connector', async () => {
      const sloSpy = vi.spyOn(logger, 'info');
      const state = buildState({
        redirectUri: 'https://tasklet.ai/oauth/callback',
      });

      await GET(buildErrorRequest(state, 'invalid_request', 'bad params'));

      const sloLine = sloSpy.mock.calls
        .map(([msg]) => String(msg))
        .find((m) => m.startsWith('[SLO] auth-callback outcome='));
      expect(sloLine).toContain('outcome=upstream_other_error');
      expect(sloLine).toContain('rURIHost=tasklet.ai');
    });

    it('does NOT reclassify when chatgpt.com hits a non-invalid_request error', async () => {
      const sloSpy = vi.spyOn(logger, 'info');
      const state = buildState({
        redirectUri: 'https://chatgpt.com/connector/oauth/aF1iFlAFZjHP',
      });

      // CSRF mismatch on a ChatGPT flow should still be correct_csrf_mismatch,
      // not correct_chatgpt_invalid_request. Reclassification is narrow on
      // BOTH the host AND the upstream error code.
      await GET(
        buildErrorRequest(
          state,
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

  // === Downstream-request fingerprint on /callback ?error=... ===
  // Regression for the 2026-05-13 production observation: Hydra returns a
  // generic `invalid_request` whose description doesn't tell us which
  // parameter it found malformed. The fingerprint captures sanitized shape
  // of what we forwarded so the next event can be diagnosed.
  describe('downstream-request fingerprint on upstream errors', () => {
    it('emits stateLen, stateFp, scopeCount and redirectUri host/path on the ?error=invalid_request path', async () => {
      const sloSpy = vi.spyOn(logger, 'info');
      const state = buildState({
        resource: 'https://mcp.neon.tech/mcp?projectId=p-1',
        codeChallenge: 'pkce-abc',
        codeChallengeMethod: 'S256',
      });

      await GET(
        buildErrorRequest(
          state,
          'invalid_request',
          'The request is missing a required parameter, ...',
        ),
      );

      const sloLine = sloSpy.mock.calls
        .map(([msg]) => String(msg))
        .find((m) => m.startsWith('[SLO] auth-callback outcome='));
      expect(sloLine).toBeDefined();
      expect(sloLine).toContain(`stateLen=${state.length}`);
      expect(sloLine).toContain(
        `stateFp=len=${state.length},prefix=${state.slice(0, 6)}`,
      );
      expect(sloLine).toContain('scopeCount=2'); // ['read', 'write']
      expect(sloLine).toContain('rURIHost=127.0.0.1');
      expect(sloLine).toContain('rURIPath=/callback');
      expect(sloLine).toContain('hasResource=1');
      expect(sloLine).toContain('hasPKCE=1');
    });

    it('never includes the raw state value in the SLO line', async () => {
      const sloSpy = vi.spyOn(logger, 'info');
      // Build a state with a recognisable secret-like fragment so we can
      // assert it does NOT leak into the log line.
      const state = buildState({
        state: 'secret-downstream-state-do-not-leak',
      });

      await GET(buildErrorRequest(state, 'invalid_request', 'malformed'));

      const sloLine = sloSpy.mock.calls
        .map(([msg]) => String(msg))
        .find((m) => m.startsWith('[SLO] auth-callback outcome='));
      expect(sloLine).toBeDefined();
      expect(sloLine).not.toContain('secret-downstream-state-do-not-leak');
      // The fingerprint exposes at most 6 chars of the base64-encoded state,
      // which is the JSON's opening `{"resp...`. That's deterministic by
      // construction and not the downstream `state` value (which is JSON-
      // embedded), so it can't echo the secret.
    });

    it('includes the fingerprint on the code-exchange catch path too', async () => {
      const sloSpy = vi.spyOn(logger, 'info');
      const upstreamErr = Object.assign(new Error('bad request'), {
        status: 400,
        error: 'invalid_grant',
        error_description: 'The authorization code has already been used.',
      });
      vi.mocked(exchangeCode).mockRejectedValue(upstreamErr);

      const state = buildState();
      await GET(buildRequest(state));

      const sloLine = sloSpy.mock.calls
        .map(([msg]) => String(msg))
        .find((m) => m.startsWith('[SLO] auth-callback outcome='));
      expect(sloLine).toContain('outcome=correct_invalid_grant');
      expect(sloLine).toContain(`stateLen=${state.length}`);
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
    expect(exchangeCode).not.toHaveBeenCalled();
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
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it('still returns Missing code or state when nothing useful is in the query', async () => {
    // Bare GET to /callback (direct navigation, prefetch, etc.). Must NOT
    // be conflated with upstream-error or state-decode buckets.
    const response = await GET(
      new NextRequest('http://localhost/callback', { method: 'GET' }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_request',
      error_description: 'Missing code or state',
    });
  });

  // === internal_error SLO + Postgres XX000 retry ===
  // Regression for the 2026-05-12 OAUTH_DATABASE_URL compute scale-from-zero
  // hiccup: when the Keyv pool fails to connect (8s wake-up timeout), we
  // (a) used to emit the internal_error SLO line with `clientId=undefined`,
  // wiping out forensic correlation, and (b) didn't retry, so the user got
  // a 500 even when the second attempt would have succeeded against the
  // freshly-woken compute. Both pinned here.
  describe('internal_error + pg-connect retry', () => {
    type PgConnectError = Error & { code: string };
    const makePgXX000Error = (): PgConnectError => {
      const err = new Error(
        "Couldn't connect to compute node",
      ) as PgConnectError;
      err.code = 'XX000';
      return err;
    };

    it('emits internal_error SLO line with clientId when KV first call fails', async () => {
      const sloSpy = vi.spyOn(logger, 'info');
      vi.mocked(model.getClient).mockRejectedValue(
        new Error('unexpected non-pg failure'),
      );

      const response = await GET(buildRequest(buildState()));

      expect(response.status).toBeGreaterThanOrEqual(500);
      const sloLine = sloSpy.mock.calls
        .map(([msg]) => String(msg))
        .find((m) =>
          m.startsWith('[SLO] auth-callback outcome=internal_error'),
        );
      expect(sloLine).toBeDefined();
      expect(sloLine).toContain('clientId=client-123');
      // Reason carries the error.name fingerprint when not a PG connect failure.
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

      const response = await GET(buildRequest(buildState()));

      // Second attempt succeeded → user redirected back with code, no leak.
      expect(response.status).toBe(307);
      expect(model.getClient).toHaveBeenCalledTimes(2);
    });

    it('exhausts retries on persistent XX000 and emits internal_error with pg_connect_failure reason', async () => {
      const sloSpy = vi.spyOn(logger, 'info');
      vi.mocked(model.getClient).mockRejectedValue(makePgXX000Error());

      const response = await GET(buildRequest(buildState()));

      expect(response.status).toBeGreaterThanOrEqual(500);
      // Two attempts (initial + one retry) per withPgConnectRetry config.
      expect(model.getClient).toHaveBeenCalledTimes(2);
      const sloLine = sloSpy.mock.calls
        .map(([msg]) => String(msg))
        .find((m) =>
          m.startsWith('[SLO] auth-callback outcome=internal_error'),
        );
      expect(sloLine).toBeDefined();
      expect(sloLine).toContain('clientId=client-123');
      expect(sloLine).toContain('reason=pg_connect_failure');
    });
  });
});
