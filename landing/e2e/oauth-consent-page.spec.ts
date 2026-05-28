import { test, expect } from '@playwright/test';

const REGISTER_PAYLOAD = {
  client_name: 'E2E Consent Client',
  client_uri: 'https://example.com',
  redirect_uris: ['http://127.0.0.1:55667/callback'],
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  token_endpoint_auth_method: 'none',
};

type Registered = { client_id: string; client_secret: string };

async function registerAndStartAuthorize(
  request: import('@playwright/test').APIRequestContext,
  authorizeParams: Record<string, string> = {},
): Promise<{ client: Registered; consentUrl: string }> {
  const reg = await request.post('/api/register', {
    data: REGISTER_PAYLOAD,
  });
  expect(reg.status()).toBe(200);
  const client = (await reg.json()) as Registered;

  const baseParams: Record<string, string> = {
    response_type: 'code',
    client_id: client.client_id,
    redirect_uri: REGISTER_PAYLOAD.redirect_uris[0],
    scope: 'read write',
    state: 'consent-spec',
  };
  const params = { ...baseParams, ...authorizeParams };
  const authorize = await request.get('/api/authorize', {
    params,
    maxRedirects: 0,
  });
  expect([302, 307].includes(authorize.status())).toBeTruthy();
  const location = authorize.headers()['location'];
  expect(location).toBeTruthy();
  expect(location).toContain('/oauth/consent');
  return { client, consentUrl: location };
}

test.describe('OAuth consent page', () => {
  test('renders the configurator with all expected sections', async ({
    page,
    request,
  }) => {
    const { consentUrl } = await registerAndStartAuthorize(request);
    await page.goto(consentUrl);

    await expect(
      page.getByRole('heading', { name: /Authorize E2E Consent Client/i }),
    ).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Read-only' })).toBeVisible();
    await expect(
      page.getByRole('radio', { name: 'Full access' }),
    ).toBeVisible();
    await expect(page.getByLabel('Project ID')).toBeVisible();

    // Each tool category surfaces a checkbox.
    await expect(
      page.getByRole('checkbox', { name: /Projects/ }),
    ).toBeVisible();
    await expect(
      page.getByRole('checkbox', { name: /Branches/ }),
    ).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /Schema/ })).toBeVisible();
    await expect(
      page.getByRole('checkbox', { name: /Querying/ }),
    ).toBeVisible();
    await expect(
      page.getByRole('checkbox', { name: /Neon Auth/ }),
    ).toBeVisible();
    await expect(
      page.getByRole('checkbox', { name: /Data API/ }),
    ).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /Docs/ })).toBeVisible();

    await expect(page.getByRole('button', { name: /Approve/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Cancel/ })).toBeVisible();
  });

  test('live tools preview updates when categories are toggled', async ({
    page,
    request,
  }) => {
    const { consentUrl } = await registerAndStartAuthorize(request);
    await page.goto(consentUrl);

    const toolCount = page.getByText(/\d+ tools available/);
    await expect(toolCount).toBeVisible();
    const initialText = await toolCount.textContent();
    expect(initialText).toMatch(/\d+ tools available/);

    // Clear all categories — the count should drop.
    await page.getByRole('button', { name: 'Clear all' }).click();
    await expect(toolCount).not.toHaveText(initialText ?? '');

    // Re-select all — the count should match the unconstrained baseline.
    await page.getByRole('button', { name: 'Select all' }).click();
    await expect(toolCount).toHaveText(initialText ?? '', { timeout: 5000 });
  });

  test('clickjacking-prevention headers are set on the consent page', async ({
    request,
  }) => {
    const { consentUrl } = await registerAndStartAuthorize(request);
    const response = await request.get(consentUrl, { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    const headers = response.headers();
    expect(headers['x-frame-options']?.toLowerCase()).toBe('deny');
    expect(headers['content-security-policy']).toContain(
      "frame-ancestors 'none'",
    );
  });

  test('GET /api/authorize sets clickjacking-prevention headers on the redirect', async ({
    request,
  }) => {
    const reg = await request.post('/api/register', {
      data: REGISTER_PAYLOAD,
    });
    expect(reg.status()).toBe(200);
    const client = (await reg.json()) as Registered;
    const response = await request.get('/api/authorize', {
      params: {
        response_type: 'code',
        client_id: client.client_id,
        redirect_uri: REGISTER_PAYLOAD.redirect_uris[0],
        scope: 'read write',
        state: 'csp-spec',
      },
      maxRedirects: 0,
    });
    expect([302, 307].includes(response.status())).toBeTruthy();
    const headers = response.headers();
    expect(headers['x-frame-options']?.toLowerCase()).toBe('deny');
    expect(headers['content-security-policy']).toContain(
      "frame-ancestors 'none'",
    );
  });

  test('client-pinned project ID is shown locked on the form', async ({
    page,
    request,
  }) => {
    const { consentUrl } = await registerAndStartAuthorize(request, {
      resource: 'https://mcp.neon.tech/mcp?projectId=prj-xyz',
    });
    await page.goto(consentUrl);
    const projectInput = page.getByLabel('Project ID');
    await expect(projectInput).toBeVisible();
    await expect(projectInput).toHaveValue('prj-xyz');
    await expect(projectInput).toBeDisabled();
    await expect(page.getByText(/Locked by client/)).toBeVisible();
  });

  test('client-pinned categories restrict the form to that subset', async ({
    page,
    request,
  }) => {
    const { consentUrl } = await registerAndStartAuthorize(request, {
      resource: 'https://mcp.neon.tech/mcp?category=querying&category=schema',
    });
    await page.goto(consentUrl);

    await expect(
      page.getByRole('checkbox', { name: /Querying/ }),
    ).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /Schema/ })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /Branches/ })).toHaveCount(
      0,
    );
    await expect(page.getByRole('checkbox', { name: /Projects/ })).toHaveCount(
      0,
    );
  });

  test('readonly query param locks the access mode to Read-only', async ({
    page,
    request,
  }) => {
    const { consentUrl } = await registerAndStartAuthorize(request, {
      resource: 'https://mcp.neon.tech/mcp?readonly=true',
      scope: 'read',
    });
    await page.goto(consentUrl);

    const readOnly = page.getByRole('radio', { name: 'Read-only' });
    const fullAccess = page.getByRole('radio', { name: 'Full access' });
    await expect(readOnly).toHaveAttribute('aria-checked', 'true');
    await expect(fullAccess).toBeDisabled();
  });
});
