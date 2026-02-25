import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../../app/api/token/route';
import { model } from '../oauth/model';

vi.mock('../oauth/model', () => ({
  model: {
    getClient: vi.fn(),
    getAuthorizationCode: vi.fn(),
    saveToken: vi.fn(),
    saveRefreshToken: vi.fn(),
    revokeAuthorizationCode: vi.fn(),
    getRefreshToken: vi.fn(),
    getAccessToken: vi.fn(),
    deleteToken: vi.fn(),
    deleteRefreshToken: vi.fn(),
  },
}));

vi.mock('../analytics/analytics', () => ({
  identify: vi.fn(),
  flushAnalytics: vi.fn().mockResolvedValue(undefined),
}));

describe('/api/token route integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('persists authorization-code grant context onto saved access token', async () => {
    const client = {
      id: 'client-123',
      secret: '',
      tokenEndpointAuthMethod: 'none',
      redirect_uris: ['http://127.0.0.1:55667/callback'],
      grants: ['authorization_code', 'refresh_token'],
      client_name: 'Token Route Test Client',
    };
    const grant = {
      projectId: 'proj_123',
      scopes: ['querying', 'schema'],
    };

    vi.mocked(model.getClient).mockResolvedValue(client as never);
    vi.mocked(model.getAuthorizationCode).mockResolvedValue({
      authorizationCode: 'code-123',
      client,
      user: { id: 'user-1', name: 'User', email: 'user@example.com' },
      expiresAt: new Date(Date.now() + 60_000),
      token: {
        access_token: 'upstream-access',
        refresh_token: 'upstream-refresh',
        access_token_expires_at: Date.now() + 3600_000,
      },
      scope: 'read write',
      grant,
    } as never);

    vi.mocked(model.saveToken).mockResolvedValue({
      accessToken: 'saved-access',
      refreshToken: 'saved-refresh',
      expires_at: Date.now() + 3600_000,
      scope: 'read write',
      client,
      user: { id: 'user-1' },
      grant,
    } as never);

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: client.id,
      code: 'code-123',
      redirect_uri: client.redirect_uris[0],
    });
    const request = new NextRequest('http://localhost/api/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    expect(model.saveToken).toHaveBeenCalledWith(
      expect.objectContaining({
        grant,
      }),
    );
  });
});
