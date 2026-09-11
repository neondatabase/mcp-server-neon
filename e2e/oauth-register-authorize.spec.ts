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

function extractWriteCheckbox(html: string): string {
  const match = html.match(
    /<input[\s\S]*?name="scopes"[\s\S]*?value="write"[\s\S]*?class="scope-checkbox"[\s\S]*?\/>/,
  );
  expect(match).toBeTruthy();
  return match![0];
}

test.describe('OAuth register and authorize contract', () => {
  test('consent shows the selected redirect and warns on a trusted-name mismatch', async ({
    page,
    request,
  }) => {
    const redirectUri = 'https://evil.example/oauth/callback?source=cursor';
    const registerResponse = await request.post('/api/register', {
      data: {
        ...VALID_REGISTER_PAYLOAD,
        client_name: 'Cursor',
        client_uri: 'https://cursor.com',
        redirect_uris: [
          'https://www.cursor.com/agents/mcp/oauth/callback',
          redirectUri,
        ],
      },
    });
    expect(registerResponse.status()).toBe(200);
    const registerBody = (await registerResponse.json()) as RegisterResponse;
    const authorizeUrl = new URL('/api/authorize', 'http://localhost');
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('client_id', registerBody.client_id);
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('scope', 'read write');
    authorizeUrl.searchParams.set('state', 'e2e-state');

    await page.goto(`${authorizeUrl.pathname}${authorizeUrl.search}`);

    await expect(
      page.getByRole('heading', { name: 'Authorize evil.example' }),
    ).toBeVisible();
    await expect(page.getByText('Claimed name:')).toBeVisible();
    await expect(page.getByText('Cursor', { exact: true })).toBeVisible();
    await expect(page.getByText('Redirect destination:')).toBeVisible();
    const destination = page.getByText(redirectUri, { exact: true });
    await expect(destination).toBeVisible();
    await expect(destination).not.toHaveAttribute('href');
    await expect(
      page.getByText('Check this redirect before authorizing'),
    ).toBeVisible();
    await expect(
      page.getByText(
        'This request uses the name Cursor, but after you authorize you will be redirected to evil.example, not Cursor.',
      ),
    ).toBeVisible();
    await expect(
      page.getByText('https://www.cursor.com/agents/mcp/oauth/callback'),
    ).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Approve' })).toBeEnabled();
    const browserBindingCookies = (await page.context().cookies()).filter(
      (cookie) => cookie.name.startsWith('__Host-neon_oauth_'),
    );
    expect(browserBindingCookies).toHaveLength(1);
    expect(browserBindingCookies[0]).toMatchObject({
      domain: 'localhost',
      httpOnly: true,
      path: '/',
      sameSite: 'Lax',
      secure: true,
    });
  });

  test('long redirect hosts do not overflow a mobile consent page', async ({
    page,
    request,
  }) => {
    const redirectHost = `cursor.com.${'a'.repeat(63)}.example`;
    const redirectUri = `https://${redirectHost}/oauth/callback`;
    const registerResponse = await request.post('/api/register', {
      data: {
        ...VALID_REGISTER_PAYLOAD,
        client_name: 'Cursor',
        redirect_uris: [redirectUri],
      },
    });
    expect(registerResponse.status()).toBe(200);
    const registerBody = (await registerResponse.json()) as RegisterResponse;
    const authorizeUrl = new URL('/api/authorize', 'http://localhost');
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('client_id', registerBody.client_id);
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('scope', 'read write');
    authorizeUrl.searchParams.set('state', 'e2e-state');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${authorizeUrl.pathname}${authorizeUrl.search}`);

    await expect(
      page.getByText('Check this redirect before authorizing'),
    ).toBeVisible();
    const dimensions = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    }));
    expect(dimensions.documentWidth).toBeLessThanOrEqual(
      dimensions.viewportWidth,
    );
  });

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

    expect(authorizeResponse.status()).toBe(200);
  });

  test('register with no read-only headers keeps Full access checked by default', async ({
    request,
  }) => {
    const registerBody = await registerClient(request);

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

    expect(authorizeResponse.status()).toBe(200);
    const body = await authorizeResponse.text();
    const writeCheckbox = extractWriteCheckbox(body);
    expect(writeCheckbox).toContain('checked');
  });

  test('register x-read-only=true defaults Full access to unchecked on authorize', async ({
    request,
  }) => {
    const registerBody = await registerClient(request, {
      'x-read-only': 'true',
    });

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

    expect(authorizeResponse.status()).toBe(200);
    const body = await authorizeResponse.text();
    const writeCheckbox = extractWriteCheckbox(body);
    expect(writeCheckbox).not.toContain('checked');
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

  for (const redirectUri of [
    'https://antigravity.google/oauth-callback',
    'https://gamma.app.kiro.dev/agent/mcp/callback',
    'https://backend.composio.dev/api/v1/auth-apps/add',
  ]) {
    test(`https redirect ${redirectUri} registers and authorizes`, async ({
      request,
    }) => {
      const registerResponse = await request.post('/api/register', {
        data: {
          ...VALID_REGISTER_PAYLOAD,
          redirect_uris: [redirectUri],
        },
      });
      expect(registerResponse.status()).toBe(200);
      const registerBody =
        (await registerResponse.json()) as RegisterResponse & {
          redirect_uris: string[];
        };
      expect(registerBody.redirect_uris).toEqual([redirectUri]);

      const authorizeResponse = await request.get('/api/authorize', {
        params: {
          response_type: 'code',
          client_id: registerBody.client_id,
          redirect_uri: redirectUri,
          scope: 'read write',
          state: 'e2e-state',
        },
        maxRedirects: 0,
      });
      expect(authorizeResponse.status()).toBe(200);
      const host = new URL(redirectUri).hostname;
      expect(await authorizeResponse.text()).toContain(`Authorize ${host}`);
    });
  }

  test('ChatGPT, Claude.ai, and Postman https redirects register', async ({
    request,
  }) => {
    for (const redirectUri of [
      'https://chatgpt.com/connector/oauth/e2e',
      'https://claude.ai/api/mcp/auth_callback',
      'https://oauth.pstmn.io/v1/browser-callback',
    ]) {
      const registerResponse = await request.post('/api/register', {
        data: {
          ...VALID_REGISTER_PAYLOAD,
          redirect_uris: [redirectUri],
        },
      });
      expect(registerResponse.status()).toBe(200);
    }
  });

  test('Cursor mixed payload keeps every supported redirect', async ({
    request,
  }) => {
    const registerResponse = await request.post('/api/register', {
      data: {
        ...VALID_REGISTER_PAYLOAD,
        redirect_uris: [
          'http://localhost:8787/callback',
          'https://www.cursor.com/agents/mcp/oauth/callback',
          'cursor://anysphere.cursor-mcp/oauth/callback',
        ],
      },
    });
    expect(registerResponse.status()).toBe(200);
    const registerBody = (await registerResponse.json()) as RegisterResponse & {
      redirect_uris: string[];
    };
    expect(registerBody.redirect_uris).toEqual([
      'http://localhost:8787/callback',
      'https://www.cursor.com/agents/mcp/oauth/callback',
      'cursor://anysphere.cursor-mcp/oauth/callback',
    ]);

    const loopbackAuthorize = await request.get('/api/authorize', {
      params: {
        response_type: 'code',
        client_id: registerBody.client_id,
        redirect_uri: 'http://localhost:9999/callback',
        scope: 'read write',
        state: 'e2e-state',
      },
      maxRedirects: 0,
    });
    expect(loopbackAuthorize.status()).toBe(200);

    const httpsAuthorize = await request.get('/api/authorize', {
      params: {
        response_type: 'code',
        client_id: registerBody.client_id,
        redirect_uri: 'https://www.cursor.com/agents/mcp/oauth/callback',
        scope: 'read write',
        state: 'e2e-state',
      },
      maxRedirects: 0,
    });
    expect(httpsAuthorize.status()).toBe(200);

    const customAuthorize = await request.get('/api/authorize', {
      params: {
        response_type: 'code',
        client_id: registerBody.client_id,
        redirect_uri: 'cursor://anysphere.cursor-mcp/oauth/callback',
        scope: 'read write',
        state: 'e2e-state',
      },
      maxRedirects: 0,
    });
    expect(customAuthorize.status()).toBe(200);
    expect(await customAuthorize.text()).not.toContain(
      'Check this redirect before authorizing',
    );
  });

  test('unsupported custom scheme is rejected at register', async ({
    request,
  }) => {
    const registerResponse = await request.post('/api/register', {
      data: {
        ...VALID_REGISTER_PAYLOAD,
        redirect_uris: ['cursor://attacker.example/oauth/callback'],
      },
    });
    expect(registerResponse.status()).toBe(400);
    const body = (await registerResponse.json()) as { error: string };
    expect(body.error).toBe('invalid_redirect_uri');
  });

  test('non-loopback http alone is rejected at register', async ({
    request,
  }) => {
    const registerResponse = await request.post('/api/register', {
      data: {
        ...VALID_REGISTER_PAYLOAD,
        redirect_uris: ['http://evil.example/cb'],
      },
    });
    expect(registerResponse.status()).toBe(400);
    const body = (await registerResponse.json()) as { error: string };
    expect(body.error).toBe('invalid_redirect_uri');
  });

  test('javascript, fragment, and userinfo redirects are rejected at register', async ({
    request,
  }) => {
    for (const redirect_uris of [
      ['javascript:alert(1)'],
      ['https://a.example/cb#x'],
      ['https://u:p@a.example/cb'],
    ]) {
      const registerResponse = await request.post('/api/register', {
        data: {
          ...VALID_REGISTER_PAYLOAD,
          redirect_uris,
        },
      });
      expect(registerResponse.status()).toBe(400);
      const body = (await registerResponse.json()) as { error: string };
      expect(body.error).toBe('invalid_redirect_uri');
    }
  });

  test('authorize rejects a redirect_uri not in the stored list', async ({
    request,
  }) => {
    const registerBody = await registerClient(request);
    const authorizeResponse = await request.get('/api/authorize', {
      params: {
        response_type: 'code',
        client_id: registerBody.client_id,
        redirect_uri: 'https://www.cursor.com/agents/mcp/oauth/callback',
        scope: 'read write',
        state: 'e2e-state',
      },
      maxRedirects: 0,
    });
    expect(authorizeResponse.status()).toBe(400);
    const body = (await authorizeResponse.json()) as { error: string };
    expect(body.error).toBe('invalid_request');
  });
});
