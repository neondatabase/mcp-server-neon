import { test, expect } from '@playwright/test';
import {
  authorizePath,
  registerClient,
  VALID_REGISTER_PAYLOAD,
} from './oauth-helpers';

type RegisterResponse = {
  client_id: string;
  client_secret: string;
};

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

    expect(authorizeResponse.status()).toBe(200);
    expect(authorizeResponse.headers()['x-frame-options']).toBe('DENY');
    expect(authorizeResponse.headers()['content-security-policy']).toBe(
      "frame-ancestors 'none'",
    );
  });

  test('register with no read-only headers keeps Allow writes checked by default', async ({
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
    expect(body).toMatch(/class="scope-checkbox"[\s\S]*?checked/);
  });

  test('register x-read-only=true defaults Allow writes to unchecked on authorize', async ({
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
    const writeCheckbox = body.match(
      /<input\s+type="checkbox"\s+name="scopes"\s+value="write"[\s\S]*?\/>/,
    )?.[0];
    expect(writeCheckbox).toBeTruthy();
    expect(writeCheckbox).not.toContain('checked');
  });

  test('parameterized resource is a fixed confirmation', async ({
    request,
  }) => {
    const registerBody = await registerClient(request);
    const resource =
      'https://mcp.neon.tech/mcp?projectId=proj-e2e&category=querying&readonly=true';

    const authorizeResponse = await request.get('/api/authorize', {
      params: {
        response_type: 'code',
        client_id: registerBody.client_id,
        redirect_uri: VALID_REGISTER_PAYLOAD.redirect_uris[0],
        scope: 'read write',
        state: 'e2e-state',
        resource,
      },
      maxRedirects: 0,
    });

    expect(authorizeResponse.status()).toBe(200);
    const body = await authorizeResponse.text();
    expect(body).toContain('proj-e2e');
    expect(body).toContain('Querying');
    expect(body).toContain(
      'To change these limits, update the connection URL and authorize again.',
    );
    expect(body).not.toContain('class="scope-checkbox"');
    expect(body).not.toContain('name="projectMode"');
  });

  test('resource readonly=false stays writable despite registration x-read-only', async ({
    request,
  }) => {
    const registerBody = await registerClient(request, {
      'x-read-only': 'true',
    });
    const resource = 'https://mcp.neon.tech/mcp?readonly=false';

    const authorizeResponse = await request.get('/api/authorize', {
      params: {
        response_type: 'code',
        client_id: registerBody.client_id,
        redirect_uri: VALID_REGISTER_PAYLOAD.redirect_uris[0],
        scope: 'read write',
        state: 'e2e-state',
        resource,
      },
      maxRedirects: 0,
    });

    expect(authorizeResponse.status()).toBe(200);
    const body = await authorizeResponse.text();
    expect(body).toContain('Read and write');
    expect(body).not.toContain('class="scope-checkbox"');
    expect(body).not.toContain('name="projectMode"');
  });

  test('toggling Allow writes hides write tools on the editable default grant', async ({
    page,
    request,
  }) => {
    const registerBody = await registerClient(request);
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: registerBody.client_id,
      redirect_uri: VALID_REGISTER_PAYLOAD.redirect_uris[0],
      scope: 'read write',
      state: 'e2e-toggle',
      resource: 'https://mcp.neon.tech/mcp',
    });

    await page.goto(`/api/authorize?${params.toString()}`);

    const checkbox = page.locator('.scope-checkbox');
    await expect(checkbox).toBeChecked();
    const show = page.getByRole('button', { name: 'View tools' });
    if (await show.isVisible()) {
      await show.click();
    }
    await expect(page.locator('[data-access-mode]')).toHaveText(
      'Read and write',
    );

    await checkbox.uncheck();
    await expect(page.locator('[data-access-mode]')).toHaveText('Read-only');
    await expect(page.locator('[data-write-tool]').first()).toBeHidden();

    await checkbox.check();
    await expect(page.locator('[data-write-tool]').first()).toBeVisible();
  });

  test('expanded tool list keeps Approve fixed at 720px height', async ({
    page,
    request,
  }) => {
    const registerBody = await registerClient(request);
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: registerBody.client_id,
      redirect_uri: VALID_REGISTER_PAYLOAD.redirect_uris[0],
      scope: 'read write',
      state: 'e2e-scroll',
    });

    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(`/api/authorize?${params.toString()}`);
    await page.getByRole('button', { name: 'View tools' }).click();
    const approve = page.getByRole('button', {
      name: 'Approve and continue to Neon',
    });
    await expect(approve).toBeInViewport();
    await expect(page.locator('[data-tool-content]')).toHaveCSS(
      'overflow-y',
      'visible',
    );
    const bodyOverflows = await page
      .locator('.card-body')
      .evaluate((element) => element.scrollHeight > element.clientHeight + 1);
    expect(bodyOverflows).toBe(true);
    await approve.focus();
    await expect(approve).toBeFocused();
  });

  test('Cancel sends access_denied to the client redirect', async ({
    page,
    request,
  }) => {
    const registerBody = await registerClient(request);
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: registerBody.client_id,
      redirect_uri: VALID_REGISTER_PAYLOAD.redirect_uris[0],
      scope: 'read write',
      state: 'e2e-cancel',
    });
    await page.goto(`/api/authorize?${params.toString()}`);
    const responsePromise = page.waitForResponse(
      (res) =>
        res.request().method() === 'POST' &&
        res.url().includes('/api/authorize'),
    );
    await page.getByRole('button', { name: 'Cancel' }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(303);
    const location = response.headers()['location'] ?? '';
    expect(location).toContain('error=access_denied');
    expect(location).toContain('state=e2e-cancel');
  });

  test('Cancel from an empty one-project form still redirects', async ({
    page,
    request,
  }) => {
    const registerBody = await registerClient(request);
    await page.goto(
      authorizePath(registerBody, { state: 'e2e-cancel-empty-project' }),
    );
    await page.getByText('One project', { exact: true }).click();
    const responsePromise = page.waitForResponse(
      (res) =>
        res.request().method() === 'POST' &&
        res.url().includes('/api/authorize'),
    );
    await page.getByRole('button', { name: 'Cancel' }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(303);
    expect(response.headers()['location'] ?? '').toContain(
      'error=access_denied',
    );
  });

  test('Cancel after a project ID validation error still redirects', async ({
    page,
    request,
  }) => {
    const registerBody = await registerClient(request);
    await page.goto(
      authorizePath(registerBody, { state: 'e2e-cancel-after-error' }),
    );
    await page.getByText('One project', { exact: true }).click();
    await page
      .getByRole('button', { name: 'Approve and continue to Neon' })
      .click();
    await expect(
      page.getByText('Enter the project ID this connection should use.'),
    ).toBeVisible();
    const responsePromise = page.waitForResponse(
      (res) =>
        res.request().method() === 'POST' &&
        res.url().includes('/api/authorize'),
    );
    await page.getByRole('button', { name: 'Cancel' }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(303);
    expect(response.headers()['location'] ?? '').toContain(
      'error=access_denied',
    );
  });

  test('two tabs for one client keep independent cookies', async ({
    page,
    context,
    request,
  }) => {
    const client = await registerClient(request);
    await page.goto(
      authorizePath(client, {
        state: 'tab-one',
        resource: 'https://mcp.neon.tech/mcp?projectId=proj-one',
      }),
    );
    const pageTwo = await context.newPage();
    await pageTwo.goto(
      authorizePath(client, {
        state: 'tab-two',
        resource: 'https://mcp.neon.tech/mcp?projectId=proj-two',
      }),
    );
    await expect(page.getByText('proj-one')).toBeVisible();
    await expect(pageTwo.getByText('proj-two')).toBeVisible();
    const cookies = await context.cookies();
    const txCookies = cookies.filter((cookie) =>
      cookie.name.startsWith('neon_mcp_at_'),
    );
    expect(txCookies.length).toBeGreaterThanOrEqual(2);
    await pageTwo.close();
  });

  test('forged write POST on a read-only request is rejected', async ({
    page,
    request,
  }) => {
    const client = await registerClient(request);
    await page.goto(
      authorizePath(client, { scope: 'read', state: 'e2e-forge' }),
    );
    const state = await page.locator('input[name="state"]').inputValue();
    const cookie = (await page.context().cookies())
      .map((item) => `${item.name}=${item.value}`)
      .join('; ');
    const body = new URLSearchParams();
    body.append('state', state);
    body.append('action', 'approve');
    body.append('projectMode', 'all');
    body.append('scopes', 'read');
    body.append('scopes', 'write');
    const response = await request.post('/api/authorize', {
      headers: {
        cookie,
        'content-type': 'application/x-www-form-urlencoded',
      },
      data: body.toString(),
    });
    expect(response.status()).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: 'invalid_scope',
    });
  });

  test('unsigned consent state is rejected with a restart message', async ({
    request,
  }) => {
    const state = Buffer.from(
      JSON.stringify({
        responseType: 'code',
        clientId: 'client-123',
        redirectUri: VALID_REGISTER_PAYLOAD.redirect_uris[0],
        scope: ['read', 'write'],
        state: 'old',
      }),
    ).toString('base64');
    const response = await request.post('/api/authorize', {
      form: {
        state,
        action: 'approve',
      },
    });
    expect(response.status()).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: 'invalid_request',
      error_description:
        'This authorization request expired or is invalid. Start authorization again from your client.',
    });
  });

  test('authorize on 127.0.0.1 redirects to the callback host', async ({
    request,
  }) => {
    const client = await registerClient(request);
    const path = authorizePath(client, { state: 'e2e-host' });
    const port = process.env.E2E_PORT ?? '3100';
    const response = await request.get(`http://127.0.0.1:${port}${path}`, {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(302);
    const location = new URL(response.headers()['location'] ?? '');
    expect(location.origin).toBe(`http://localhost:${port}`);
    expect(location.pathname).toBe('/api/authorize');
    expect(location.searchParams.get('state')).toBe('e2e-host');
    expect(response.headers()['set-cookie'] ?? '').not.toContain(
      'neon_mcp_at_',
    );
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
    });
  }

  test('scalar HTTPS redirect is normalized to an array', async ({
    request,
  }) => {
    const redirectUri = 'https://client.example/oauth/callback';
    const registerResponse = await request.post('/api/register', {
      data: {
        ...VALID_REGISTER_PAYLOAD,
        redirect_uris: redirectUri,
      },
    });

    expect(registerResponse.status()).toBe(200);
    await expect(registerResponse.json()).resolves.toMatchObject({
      redirect_uris: [redirectUri],
    });
  });

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
