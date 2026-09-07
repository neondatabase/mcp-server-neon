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

  test('authorize HTML includes the resource project and categories', async ({
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
      'This connection requested read-only access. You can allow writes for this authorization.',
    );
    const writeCheckbox = extractWriteCheckbox(body);
    expect(writeCheckbox).not.toContain('checked');
  });

  test('toggling Allow writes hides write tools and drops write from the form', async ({
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
      resource:
        'https://mcp.neon.tech/mcp?projectId=proj-e2e&category=querying,schema',
    });

    await page.goto(`/api/authorize?${params.toString()}`);

    const checkbox = page.locator('.scope-checkbox');
    await expect(checkbox).toBeChecked();
    await expect(page.locator('[data-access-mode]')).toHaveText(
      'Read and write',
    );
    await expect(page.locator('[data-tools-summary]')).toContainText(
      'read and write',
    );
    await expect(page.locator('[data-write-tool]').first()).toBeVisible();

    await checkbox.uncheck();
    await expect(page.locator('[data-access-mode]')).toHaveText('Read-only');
    await expect(page.locator('[data-tools-summary]')).toContainText(
      'read-only',
    );
    await expect(page.locator('[data-write-tool]').first()).toBeHidden();

    const scopesOff = await page
      .locator('input[name="scopes"]')
      .evaluateAll((inputs) =>
        inputs.flatMap((input) => {
          if (!(input instanceof HTMLInputElement)) {
            return [];
          }
          if (input.type === 'hidden' || input.checked) {
            return [input.value];
          }
          return [];
        }),
      );
    expect(scopesOff).toEqual(['read']);

    await checkbox.check();
    await expect(page.locator('[data-write-tool]').first()).toBeVisible();
    const scopesOn = await page
      .locator('input[name="scopes"]')
      .evaluateAll((inputs) =>
        inputs.flatMap((input) => {
          if (!(input instanceof HTMLInputElement)) {
            return [];
          }
          if (input.type === 'hidden' || input.checked) {
            return [input.value];
          }
          return [];
        }),
      );
    expect(scopesOn).toEqual(['read', 'write']);
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
