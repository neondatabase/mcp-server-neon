import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../../app/api/token/route';
import { model } from '../oauth/model';
import { ClientMetadataUnavailableError } from '../../lib/oauth/client-id-metadata-document';
import { CLIENT_ASSERTION_TYPE } from '../../lib/oauth/client-assertion';
import { SERVER_HOST } from '../../lib/config';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

vi.mock('../oauth/model', () => ({
  model: {
    getClient: vi.fn(),
    getAuthorizationCode: vi.fn(),
    saveToken: vi.fn(),
    saveRefreshToken: vi.fn(),
    revokeAuthorizationCode: vi.fn(),
    getRefreshToken: vi.fn(),
    getRefreshFailure: vi.fn(),
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
      roleName: 'mcp_pinned_reader',
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

  it('returns the authorization code scope including * on the token', async () => {
    const client = {
      id: 'client-123',
      secret: '',
      tokenEndpointAuthMethod: 'none',
      redirect_uris: ['http://127.0.0.1:55667/callback'],
      grants: ['authorization_code', 'refresh_token'],
      client_name: 'Token Route Test Client',
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
      scope: 'read write *',
      grant: { projectId: null, scopes: null },
    } as never);

    vi.mocked(model.saveToken).mockResolvedValue({
      accessToken: 'saved-access',
      refreshToken: 'saved-refresh',
      expires_at: Date.now() + 3600_000,
      scope: 'read write *',
      client,
      user: { id: 'user-1' },
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
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        access_token: 'saved-access',
        token_type: 'bearer',
        refresh_token: 'saved-refresh',
        scope: 'read write *',
      }),
    );
  });

  describe('redirect_uri on authorization_code exchange', () => {
    // Claude Code's client ID metadata document registers loopback
    // callbacks without a port and listens on a random one.
    const portlessClient = {
      id: 'https://claude.ai/oauth/claude-code-client-metadata',
      tokenEndpointAuthMethod: 'none',
      redirect_uris: ['http://localhost/callback', 'http://127.0.0.1/callback'],
      grants: ['authorization_code', 'refresh_token'],
      client_name: 'Claude Code',
    };

    const exchange = (redirectUri: string) => {
      vi.mocked(model.getClient).mockResolvedValue(portlessClient as never);
      vi.mocked(model.getAuthorizationCode).mockResolvedValue({
        authorizationCode: 'code-123',
        client: portlessClient,
        redirectUri: 'http://localhost:54321/callback',
        user: { id: 'user-1', name: 'User', email: 'user@example.com' },
        expiresAt: new Date(Date.now() + 60_000),
        token: {
          access_token: 'upstream-access',
          refresh_token: 'upstream-refresh',
          access_token_expires_at: Date.now() + 3600_000,
        },
        scope: 'read',
        grant: { projectId: null, scopes: null },
      } as never);
      vi.mocked(model.saveToken).mockResolvedValue({
        accessToken: 'saved-access',
        refreshToken: 'saved-refresh',
        expires_at: Date.now() + 3600_000,
        scope: 'read',
        client: portlessClient,
        user: { id: 'user-1' },
      } as never);

      return POST(
        new NextRequest('http://localhost/api/token', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: portlessClient.id,
            code: 'code-123',
            redirect_uri: redirectUri,
          }).toString(),
        }),
      );
    };

    it('accepts the loopback redirect the code was issued for', async () => {
      const response = await exchange('http://localhost:54321/callback');
      expect(response.status).toBe(200);
    });

    it('rejects a redirect that is neither bound to the code nor registered', async () => {
      const response = await exchange('http://localhost:60000/callback');
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: 'invalid_request',
        error_description: 'Invalid redirect URI',
      });
      expect(model.saveToken).not.toHaveBeenCalled();
    });
  });

  describe('a metadata-document client that declared private_key_jwt', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'k1' };
    const client = {
      id: 'https://chatgpt.example/oauth/client.json',
      tokenEndpointAuthMethod: 'private_key_jwt',
      jwks: { keys: [jwk] },
      redirect_uris: ['https://chatgpt.example/callback'],
      grants: ['authorization_code', 'refresh_token'],
      client_name: 'ChatGPT',
    };

    const refresh = (extra: Record<string, string>) => {
      vi.mocked(model.getClient).mockResolvedValue(client as never);
      vi.mocked(model.getRefreshFailure).mockResolvedValue(undefined as never);
      vi.mocked(model.getRefreshToken).mockResolvedValue(undefined as never);
      return POST(
        new NextRequest('http://localhost/api/token', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: client.id,
            refresh_token: 'refresh-123',
            ...extra,
          }).toString(),
        }),
      );
    };

    it('is refused without an assertion before its refresh token is read', async () => {
      const response = await refresh({});
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: 'invalid_client',
      });
      expect(model.getRefreshToken).not.toHaveBeenCalled();
    });

    it('authenticates with a signed assertion', async () => {
      const assertion = await new SignJWT({})
        .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuer(client.id)
        .setSubject(client.id)
        .setAudience(`${SERVER_HOST}/api/token`)
        .setExpirationTime('1m')
        .sign(privateKey);

      const response = await refresh({
        client_assertion_type: CLIENT_ASSERTION_TYPE,
        client_assertion: assertion,
      });
      expect(model.getRefreshToken).toHaveBeenCalled();
      await expect(response.json()).resolves.not.toMatchObject({
        error: 'invalid_client',
      });
    });
  });

  it('answers 503 and consumes nothing when the client metadata document is unreadable', async () => {
    vi.mocked(model.getClient).mockRejectedValue(
      new ClientMetadataUnavailableError('answered 502'),
    );

    const response = await POST(
      new NextRequest('http://localhost/api/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: 'https://client.example.com/oauth/metadata.json',
          refresh_token: 'refresh-123',
        }).toString(),
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: 'temporarily_unavailable',
    });
    expect(model.getRefreshToken).not.toHaveBeenCalled();
    expect(model.getAuthorizationCode).not.toHaveBeenCalled();
  });
});
