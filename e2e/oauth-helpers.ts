import { expect, type APIRequestContext } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';

export const VALID_REGISTER_PAYLOAD = {
  client_name: 'E2E OAuth Client',
  client_uri: 'https://example.com',
  redirect_uris: ['http://127.0.0.1:55667/callback'],
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  token_endpoint_auth_method: 'none',
};

type RegisterResponse = {
  client_id: string;
  client_secret: string;
};

export function authorizePath(
  client: RegisterResponse,
  extra: Record<string, string> = {},
): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: client.client_id,
    redirect_uri: VALID_REGISTER_PAYLOAD.redirect_uris[0],
    scope: extra.scope ?? 'read write',
    state: extra.state ?? 'e2e-state',
    ...Object.fromEntries(
      Object.entries(extra).filter(
        ([key]) => key !== 'scope' && key !== 'state',
      ),
    ),
  });
  return `/api/authorize?${params.toString()}`;
}

export async function registerClient(
  request: APIRequestContext,
  headers: Record<string, string> = {},
  payload = VALID_REGISTER_PAYLOAD,
): Promise<RegisterResponse> {
  const registerResponse = await request.post('/api/register', {
    data: payload,
    headers,
  });
  expect(registerResponse.status()).toBe(200);
  return (await registerResponse.json()) as RegisterResponse;
}

export async function openAuthorize(
  page: Page,
  request: APIRequestContext,
  extra: Record<string, string> = {},
  registerHeaders: Record<string, string> = {},
): Promise<RegisterResponse> {
  const client = await registerClient(request, registerHeaders);
  await page.goto(authorizePath(client, extra));
  return client;
}

const SHOT_DIRS = [
  path.join(import.meta.dirname, 'consent-screenshots'),
  path.join(
    process.env.HOME ?? '',
    'workspaces/tests/oauth-consent-screenshots',
  ),
];

export async function capture(
  page: Page,
  name: string,
  fullPage = false,
): Promise<void> {
  for (const dir of SHOT_DIRS) {
    mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage });
  }
}
