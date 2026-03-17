/**
 * Integration tests for the refresh token flow.
 *
 * Tests the actual POST /api/token route handler with mocked model and
 * upstream OAuth exchange. Verifies singleflight coalescing (same-instance)
 * and distributed cache fallback (cross-instance) behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../oauth/model', () => ({
  model: {
    getClient: vi.fn(),
    getRefreshToken: vi.fn(),
    getAccessToken: vi.fn(),
    saveToken: vi.fn(),
    saveRefreshToken: vi.fn(),
    deleteToken: vi.fn(),
    deleteRefreshToken: vi.fn(),
    saveRefreshResult: vi.fn(),
    getRefreshResult: vi.fn(),
  },
}));

vi.mock('../../lib/oauth/client', () => ({
  exchangeRefreshToken: vi.fn(),
}));

vi.mock('../oauth/utils', () => ({
  verifyPKCE: vi.fn().mockReturnValue(true),
}));

vi.mock('../analytics/analytics', () => ({
  identify: vi.fn(),
  flushAnalytics: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/errors', () => ({
  handleOAuthError: vi.fn(
    () =>
      new Response(JSON.stringify({ error: 'server_error' }), { status: 500 }),
  ),
}));

vi.mock('@vercel/functions', () => ({
  waitUntil: vi.fn(),
}));

import { POST } from '../../app/api/token/route';
import { model } from '../oauth/model';
import { exchangeRefreshToken } from '../../lib/oauth/client';
import { NextRequest } from 'next/server';

const mockModel = vi.mocked(model);
const mockExchange = vi.mocked(exchangeRefreshToken);

const TEST_CLIENT = {
  id: 'client-1',
  secret: 'secret-1',
  grants: ['refresh_token'],
  redirect_uris: ['http://localhost/callback'],
  client_name: 'Test Client',
  tokenEndpointAuthMethod: 'client_secret_post',
};

const TEST_OLD_ACCESS_TOKEN = {
  accessToken: 'old-access-token',
  refreshToken: 'old-refresh-token',
  expires_at: Date.now() + 3600_000,
  client: TEST_CLIENT,
  user: { id: 'user-1', name: 'Test User', email: 'test@example.com' },
  scope: 'read write',
};

const TEST_REFRESH_TOKEN_RECORD = {
  refreshToken: 'old-refresh-token',
  accessToken: 'old-access-token',
};

function makeTokenRequest(
  refreshToken: string,
  clientId = 'client-1',
  clientSecret = 'secret-1',
): NextRequest {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  return new NextRequest('http://localhost/api/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
}

function makeUpstreamTokenResponse(overrides: Record<string, unknown> = {}) {
  return {
    access_token: 'new-access-token',
    refresh_token: 'new-refresh-token',
    expiresIn: () => 3600,
    ...overrides,
  };
}

describe('Token refresh flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockModel.getClient.mockResolvedValue(TEST_CLIENT as any);
    mockModel.getRefreshToken.mockResolvedValue(TEST_REFRESH_TOKEN_RECORD);
    mockModel.getAccessToken.mockResolvedValue(TEST_OLD_ACCESS_TOKEN as any);
    mockModel.saveToken.mockImplementation(async (token: any) => token);
    mockModel.saveRefreshToken.mockResolvedValue({} as any);
    mockModel.deleteToken.mockResolvedValue(true);
    mockModel.deleteRefreshToken.mockResolvedValue(true);
    mockModel.saveRefreshResult.mockResolvedValue(undefined);
    mockModel.getRefreshResult.mockResolvedValue(undefined);
  });

  it('happy path: refreshes token and returns new tokens', async () => {
    mockExchange.mockResolvedValue(makeUpstreamTokenResponse() as any);

    const response = await POST(makeTokenRequest('old-refresh-token'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.access_token).toBe('new-access-token');
    expect(body.refresh_token).toBe('new-refresh-token');
    expect(body.token_type).toBe('bearer');
    expect(body.expires_in).toBeGreaterThan(0);

    expect(mockExchange).toHaveBeenCalledTimes(1);
    expect(mockModel.saveToken).toHaveBeenCalledTimes(1);
    expect(mockModel.saveRefreshToken).toHaveBeenCalledTimes(1);
    expect(mockModel.deleteToken).toHaveBeenCalledTimes(1);
    expect(mockModel.deleteRefreshToken).toHaveBeenCalledTimes(1);
    expect(mockModel.saveRefreshResult).toHaveBeenCalledTimes(1);
  });

  it('does not delete refresh token when upstream reuses the same token string', async () => {
    mockExchange.mockResolvedValue(
      makeUpstreamTokenResponse({ refresh_token: undefined }) as any,
    );

    const response = await POST(makeTokenRequest('old-refresh-token'));
    expect(response.status).toBe(200);

    expect(mockModel.saveRefreshToken).toHaveBeenCalledTimes(1);
    expect(mockModel.deleteRefreshToken).not.toHaveBeenCalled();
  });

  describe('singleflight coalescing (same-instance)', () => {
    it('concurrent requests with same refresh token share one upstream call', async () => {
      let resolveExchange!: (value: any) => void;
      mockExchange.mockReturnValue(
        new Promise((resolve) => {
          resolveExchange = resolve;
        }),
      );

      const req1 = POST(makeTokenRequest('old-refresh-token'));
      const req2 = POST(makeTokenRequest('old-refresh-token'));

      resolveExchange(makeUpstreamTokenResponse());

      const [response1, response2] = await Promise.all([req1, req2]);
      const [body1, body2] = await Promise.all([
        response1.json(),
        response2.json(),
      ]);

      expect(response1.status).toBe(200);
      expect(response2.status).toBe(200);
      expect(body1.access_token).toBe('new-access-token');
      expect(body2.access_token).toBe('new-access-token');

      expect(mockExchange).toHaveBeenCalledTimes(1);
    });
  });

  describe('distributed cache fallback (cross-instance)', () => {
    it('returns cached result when refresh token is already consumed', async () => {
      mockModel.getRefreshToken.mockResolvedValue(undefined);

      mockModel.getRefreshResult.mockResolvedValue({
        accessToken: 'cached-access-token',
        refreshToken: 'cached-refresh-token',
        expiresAt: Date.now() + 3600_000,
        scope: 'read write',
      });

      const response = await POST(makeTokenRequest('old-refresh-token'));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.access_token).toBe('cached-access-token');
      expect(body.refresh_token).toBe('cached-refresh-token');

      expect(mockExchange).not.toHaveBeenCalled();
    });

    it('returns cached result when upstream rejects with 4xx (token rotation)', async () => {
      const upstreamError = new Error('invalid_grant') as Error & {
        status: number;
      };
      upstreamError.status = 400;
      mockExchange.mockRejectedValue(upstreamError);

      mockModel.getRefreshResult.mockResolvedValue({
        accessToken: 'cached-access-token',
        refreshToken: 'cached-refresh-token',
        expiresAt: Date.now() + 3600_000,
        scope: 'read write',
      });

      const response = await POST(makeTokenRequest('old-refresh-token'));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.access_token).toBe('cached-access-token');
      expect(body.refresh_token).toBe('cached-refresh-token');
    });

    it('returns error when no cache hit and token is gone', async () => {
      mockModel.getRefreshToken.mockResolvedValue(undefined);
      mockModel.getRefreshResult.mockResolvedValue(undefined);

      const response = await POST(makeTokenRequest('old-refresh-token'));
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('invalid_grant');
    });

    it('returns error when upstream rejects and no cache hit', async () => {
      const upstreamError = new Error('invalid_grant') as Error & {
        status: number;
      };
      upstreamError.status = 400;
      mockExchange.mockRejectedValue(upstreamError);
      mockModel.getRefreshResult.mockResolvedValue(undefined);

      const response = await POST(makeTokenRequest('old-refresh-token'));
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('invalid_grant');
    });
  });

  describe('transient errors', () => {
    it('returns 503 on upstream 5xx without deleting tokens', async () => {
      const upstreamError = new Error('Internal Server Error') as Error & {
        status: number;
      };
      upstreamError.status = 500;
      mockExchange.mockRejectedValue(upstreamError);

      const response = await POST(makeTokenRequest('old-refresh-token'));
      const body = await response.json();

      expect(response.status).toBe(503);
      expect(body.error).toBe('server_error');

      expect(mockModel.deleteToken).not.toHaveBeenCalled();
      expect(mockModel.deleteRefreshToken).not.toHaveBeenCalled();
    });
  });
});
