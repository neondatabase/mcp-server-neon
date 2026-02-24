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

async function registerClient(request: {
  post: (
    url: string,
    options?: { data?: unknown },
  ) => Promise<{
    status: () => number;
    json: () => Promise<unknown>;
  }>;
}): Promise<RegisterResponse> {
  const registerResponse = await request.post('/api/register', {
    data: VALID_REGISTER_PAYLOAD,
  });
  expect(registerResponse.status()).toBe(200);
  return (await registerResponse.json()) as RegisterResponse;
}

function extractWriteCheckbox(html: string): string {
  const match = html.match(
    /<input[\s\S]*?name="scopes"[\s\S]*?value="write"[\s\S]*?class="scope-checkbox"[\s\S]*?\/>/,
  );
  expect(match).toBeTruthy();
  return match![0];
}

test.describe('OAuth register and authorize contract', () => {
  test('registered client is accepted by authorize route', async ({
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

    // For unapproved clients, authorize renders consent HTML (200).
    // If a cookie somehow exists in local runs, it may redirect upstream (302).
    expect([200, 302]).toContain(authorizeResponse.status());
  });

  test('read-only header defaults Full access to unchecked in authorize dialog', async ({
    request,
  }) => {
    const registerBody = await registerClient(request);

    const authorizeResponse = await request.get('/api/authorize', {
      headers: {
        'X-Neon-Read-Only': 'true',
      },
      params: {
        response_type: 'code',
        client_id: registerBody.client_id,
        redirect_uri: VALID_REGISTER_PAYLOAD.redirect_uris[0],
        scope: 'read write',
        state: 'e2e-state',
      },
      maxRedirects: 0,
    });

    expect(authorizeResponse.status()).toBe(200);
    const body = await authorizeResponse.text();
    const writeCheckbox = extractWriteCheckbox(body);
    expect(writeCheckbox).not.toContain('checked');
  });

  test('X-Neon-Read-Only takes precedence over x-read-only on authorize dialog default', async ({
    request,
  }) => {
    const registerBody = await registerClient(request);

    const authorizeResponse = await request.get('/api/authorize', {
      headers: {
        'X-Neon-Read-Only': 'false',
        'x-read-only': 'true',
      },
      params: {
        response_type: 'code',
        client_id: registerBody.client_id,
        redirect_uri: VALID_REGISTER_PAYLOAD.redirect_uris[0],
        scope: 'read write',
        state: 'e2e-state',
      },
      maxRedirects: 0,
    });

    expect(authorizeResponse.status()).toBe(200);
    const body = await authorizeResponse.text();
    const writeCheckbox = extractWriteCheckbox(body);
    expect(writeCheckbox).toContain('checked');
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
});
