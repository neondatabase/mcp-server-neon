import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../../app/callback/route';
import { model } from '../oauth/model';
import { exchangeCode } from '../../lib/oauth/client';
import { resolveAccountFromAuth } from '../server/account';

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
  });

  it('persists grant resolved from OAuth resource URI and forwards resource to token exchange', async () => {
    const resource =
      'https://mcp.neon.tech/mcp?projectId=proj-123&category=querying,schema';
    const state = buildState({ resource });

    const response = await GET(buildRequest(state));

    expect(response.status).toBe(307);
    expect(exchangeCode).toHaveBeenCalledWith(expect.any(URL), state, resource);
    expect(model.saveAuthorizationCode).toHaveBeenCalledWith(
      expect.objectContaining({
        grant: {
          projectId: 'proj-123',
          scopes: ['querying', 'schema'],
        },
      }),
    );
  });

  it('returns invalid_target when resource URI is malformed', async () => {
    const state = buildState({
      resource: '/mcp?projectId=proj-123',
    });

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
});
