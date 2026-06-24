import { test, expect } from '@playwright/test';

type RegisterResponse = {
  client_id: string;
  client_secret: string;
};

const VALID_REGISTER_PAYLOAD = {
  client_name: 'E2E OAuth Client',
  client_uri: 'https://example.com',
  redirect_uris: ['http://127.0.0.1:55667/callback'],
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  token_endpoint_auth_method: 'none',
};

async function registerClient(
  request: {
    post: (
      url: string,
      options?: { data?: unknown; headers?: Record<string, string> },
    ) => Promise<{
      status: () => number;
      json: () => Promise<unknown>;
    }>;
  },
  headers: Record<string, string> = {},
): Promise<RegisterResponse> {
  const registerResponse = await request.post('/api/register', {
    data: VALID_REGISTER_PAYLOAD,
    headers,
  });
  expect(registerResponse.status()).toBe(200);
  return (await registerResponse.json()) as RegisterResponse;
}

test.describe('OAuth register and authorize contract', () => {
  test('registered client is accepted by authorize route and redirected to consent page', async ({
    request,
  }) => {
    const registerBody = await registerClient(request);
    expect(registerBody.client_id).toBeTruthy();
    expect(registerBody.client_secret).toBeTruthy();

    const authorizeResponse = await request.get('/api/authorize', {
      params: {
        response_type: 'code',
        client_id: registerBody.client_id,
        redirect_uri: VALID_REGISTER_PAYLOAD.redirect_uris[0],
        scope: 'read write',
        state: 'e2e-state',
      },
      maxRedirects: 0,
    });

    // Unapproved clients are redirected to the consent page; approved
    // clients with the same grant shape get a direct upstream redirect.
    expect([302, 307].includes(authorizeResponse.status())).toBeTruthy();
    const location = authorizeResponse.headers()['location'];
    expect(location).toBeTruthy();
    expect(location).toMatch(/\/oauth\/consent\?state=|oauth\.[\w.-]+/);
  });

  test('signed state is required to render the consent page', async ({
    request,
  }) => {
    const consentResponse = await request.get('/oauth/consent', {
      maxRedirects: 0,
    });
    // notFound() in App Router renders the 404 page.
    expect(consentResponse.status()).toBe(404);
  });

  test('tampered signed state is rejected at the consent page', async ({
    request,
  }) => {
    const tamperedState =
      '00'.repeat(32) + '.' + Buffer.from('{}').toString('base64url');
    const consentResponse = await request.get('/oauth/consent', {
      params: { state: tamperedState },
      maxRedirects: 0,
    });
    expect(consentResponse.status()).toBe(404);
  });

  test('unknown client is rejected by authorize route', async ({ request }) => {
    const authorizeResponse = await request.get('/api/authorize', {
      params: {
        response_type: 'code',
        client_id: 'missing-client-id',
        redirect_uri: VALID_REGISTER_PAYLOAD.redirect_uris[0],
        scope: 'read write',
        state: 'e2e-state',
      },
    });

    expect(authorizeResponse.status()).toBe(400);
    const body = (await authorizeResponse.json()) as {
      error: string;
      error_description: string;
    };
    expect(body.error).toBe('invalid_client');
    expect(body.error_description).toContain('Invalid client ID');
  });

  test('attacker-controlled redirect URI is rejected before consent', async ({
    request,
  }) => {
    const registerBody = await registerClient(request);
    const authorizeResponse = await request.get('/api/authorize', {
      params: {
        response_type: 'code',
        client_id: registerBody.client_id,
        redirect_uri: 'https://attacker.example/callback',
        scope: 'read write',
        state: 'e2e-state',
      },
    });

    expect(authorizeResponse.status()).toBe(400);
    const body = (await authorizeResponse.json()) as {
      error: string;
      error_description: string;
    };
    expect(body.error).toBe('invalid_request');
    expect(body.error_description).toContain('Invalid redirect URI');
  });
});
