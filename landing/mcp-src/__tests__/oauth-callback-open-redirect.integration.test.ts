// Regression test for CWE-601 open redirect on the OAuth /callback route.
//
// Background: /callback decoded the `state` query parameter (base64-encoded
// JSON) and used the embedded `redirectUri` as the destination of the final
// 307 to the downstream MCP client, without re-checking that the URI was on
// the client's registered `redirect_uris` allowlist. An attacker who could
// induce a victim's browser to begin an OAuth flow with a tampered state
// (or who controlled the state directly via the POST /api/authorize handler,
// which also did not re-validate the decoded state) could exfiltrate the
// authorization code to an arbitrary host.
//
// The fix matches the same redirect-URI allowlist check that already runs
// in GET /api/authorize (lib/oauth/redirect-uri.ts → matchesRedirectUri).

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../../app/callback/route';
import { model } from '../oauth/model';
import { exchangeCode } from '../../lib/oauth/client';
import { resolveAccountFromAuth } from '../server/account';

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

const REGISTERED_REDIRECT = 'http://127.0.0.1:55667/callback';
const ATTACKER_REDIRECT = 'https://attacker.example/steal';

function buildState(redirectUri: string): string {
  return btoa(
    JSON.stringify({
      responseType: 'code',
      clientId: 'client-123',
      redirectUri,
      scope: ['read', 'write'],
      state: 'client-state',
    }),
  );
}

function buildSuccessRequest(state: string): NextRequest {
  return new NextRequest(
    `http://localhost/callback?code=upstream-code&state=${encodeURIComponent(state)}`,
    { method: 'GET' },
  );
}

function buildErrorRequest(state: string): NextRequest {
  const qs = new URLSearchParams({
    error: 'access_denied',
    error_description: 'denied',
    state,
  });
  return new NextRequest(`http://localhost/callback?${qs.toString()}`, {
    method: 'GET',
  });
}

describe('/callback CWE-601 open redirect', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(model.getClient).mockResolvedValue({
      id: 'client-123',
      client_name: 'Test Client',
      redirect_uris: [REGISTERED_REDIRECT],
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

  it('rejects success-path redirect to a URI not on the client allowlist', async () => {
    const state = buildState(ATTACKER_REDIRECT);
    const response = await GET(buildSuccessRequest(state));

    // Must NOT 307 to attacker host. Must NOT mint an authorization code.
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('invalid_request');
    expect(model.saveAuthorizationCode).not.toHaveBeenCalled();

    // Defence in depth: even if a Location header somehow leaked, it must
    // not point to the attacker's host.
    const location = response.headers.get('location');
    if (location) {
      expect(new URL(location).hostname).not.toBe('attacker.example');
    }
  });

  it('rejects upstream-error relay to a URI not on the client allowlist', async () => {
    const state = buildState(ATTACKER_REDIRECT);
    const response = await GET(buildErrorRequest(state));

    expect(response.status).toBe(400);
    const location = response.headers.get('location');
    if (location) {
      expect(new URL(location).hostname).not.toBe('attacker.example');
    }
  });

  it('still allows success-path redirect to a registered URI', async () => {
    const state = buildState(REGISTERED_REDIRECT);
    const response = await GET(buildSuccessRequest(state));

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get('location')!);
    expect(location.origin + location.pathname).toBe(REGISTERED_REDIRECT);
    expect(location.searchParams.get('code')).toBeTruthy();
  });

  it('still allows upstream-error relay to a registered URI', async () => {
    const state = buildState(REGISTERED_REDIRECT);
    const response = await GET(buildErrorRequest(state));

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get('location')!);
    expect(location.origin + location.pathname).toBe(REGISTERED_REDIRECT);
    expect(location.searchParams.get('error')).toBe('access_denied');
  });
});
