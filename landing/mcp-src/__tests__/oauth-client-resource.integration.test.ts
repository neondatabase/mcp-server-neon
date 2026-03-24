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

describe('lib/oauth/client resource propagation', () => {
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

  it('includes resource parameter in upstream authorization URL when provided', async () => {
    const { upstreamAuth } = await import('../../lib/oauth/client');
    const resource =
      'https://mcp.neon.tech/mcp?projectId=proj-123&category=querying';

    await upstreamAuth('encoded-state', resource);

    expect(buildAuthorizationUrlMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        state: 'encoded-state',
        resource,
      }),
    );
  });

  it('includes resource parameter in code exchange token request when provided', async () => {
    const { exchangeCode } = await import('../../lib/oauth/client');
    const resource = 'https://mcp.neon.tech/mcp?category=schema';
    const callbackUrl = new URL('https://mcp.neon.tech/callback?code=abc');

    await exchangeCode(callbackUrl, 'encoded-state', resource);

    expect(authorizationCodeGrantMock).toHaveBeenCalledWith(
      expect.anything(),
      callbackUrl,
      {
        expectedState: 'encoded-state',
        idTokenExpected: true,
      },
      { resource },
    );
  });

  it('omits resource parameter for authorization and token requests when absent', async () => {
    const { upstreamAuth, exchangeCode } =
      await import('../../lib/oauth/client');
    const callbackUrl = new URL('https://mcp.neon.tech/callback?code=abc');

    await upstreamAuth('encoded-state');
    await exchangeCode(callbackUrl, 'encoded-state');

    expect(buildAuthorizationUrlMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.not.objectContaining({ resource: expect.anything() }),
    );
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
