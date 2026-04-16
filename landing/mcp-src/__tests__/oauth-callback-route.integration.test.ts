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
});
