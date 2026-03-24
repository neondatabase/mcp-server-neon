import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  discoveryMock,
  buildAuthorizationUrlMock,
  authorizationCodeGrantMock,
  clientSecretPostMock,
  refreshTokenGrantMock,
} = vi.hoisted(() => ({
  discoveryMock: vi.fn(),
  buildAuthorizationUrlMock: vi.fn(),
  authorizationCodeGrantMock: vi.fn(),
  clientSecretPostMock: vi.fn(() => 'client-secret-post-auth'),
  refreshTokenGrantMock: vi.fn(),
}));

vi.mock('openid-client', () => ({
  discovery: discoveryMock,
  buildAuthorizationUrl: buildAuthorizationUrlMock,
  authorizationCodeGrant: authorizationCodeGrantMock,
  ClientSecretPost: clientSecretPostMock,
  refreshTokenGrant: refreshTokenGrantMock,
}));

vi.mock('../../lib/config', () => ({
  CLIENT_ID: 'client-id',
  CLIENT_SECRET: 'client-secret',
  SERVER_HOST: 'https://mcp.neon.tech',
  UPSTREAM_OAUTH_HOST: 'https://oauth.neon.tech',
}));

describe('lib/oauth/client upstream OAuth request shape', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    discoveryMock.mockResolvedValue({ config: 'upstream-config' });
    buildAuthorizationUrlMock.mockReturnValue(
      new URL('https://oauth.neon.tech/authorize'),
    );
    authorizationCodeGrantMock.mockResolvedValue({
      access_token: 'token',
      expiresIn: () => 3600,
    });
  });

  it('does not include resource parameter in upstream authorization URL', async () => {
    const { upstreamAuth } = await import('../../lib/oauth/client');
    await upstreamAuth('encoded-state');

    expect(buildAuthorizationUrlMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        state: 'encoded-state',
      }),
    );
    expect(buildAuthorizationUrlMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.not.objectContaining({
        resource: expect.anything(),
      }),
    );
  });

  it('does not include resource parameter in code exchange token request', async () => {
    const { exchangeCode } = await import('../../lib/oauth/client');
    const callbackUrl = new URL('https://mcp.neon.tech/callback?code=abc');

    await exchangeCode(callbackUrl, 'encoded-state');

    expect(authorizationCodeGrantMock).toHaveBeenCalledWith(
      expect.anything(),
      callbackUrl,
      {
        expectedState: 'encoded-state',
        idTokenExpected: true,
      },
    );
  });
});
