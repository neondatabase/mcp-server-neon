/**
 * OAuth credentials and codes must never reach Sentry. The routes receive
 * them in the Authorization header (client_secret_basic, bearer tokens), in
 * form bodies (refresh tokens, PKCE verifiers), and in the query string
 * (authorization codes, state). Each request carries a unique canary, and no
 * envelope the server sends may contain one.
 */

import { test, expect } from '@playwright/test';
import { SENTRY_FIXTURE_ITEMS_URL } from './sentry-fixture.js';

async function sentryText(): Promise<string> {
  const response = await fetch(SENTRY_FIXTURE_ITEMS_URL);
  expect(response.ok).toBe(true);
  return response.text();
}

test('OAuth credentials and codes stay out of Sentry', async ({ request }) => {
  const canary = (name: string) => `${name}-${crypto.randomUUID()}`;
  const bearer = canary('bearer');
  const basic = Buffer.from(`${canary('client')}:${canary('secret')}`).toString(
    'base64',
  );
  const refreshToken = canary('refresh');
  const verifier = canary('verifier');
  const code = canary('code');
  const state = canary('state');

  await request.post('/mcp', {
    headers: {
      Authorization: `Bearer ${bearer}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
  });
  await request.post('/api/token', {
    headers: { Authorization: `Basic ${basic}` },
    form: {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      code_verifier: verifier,
    },
  });
  await request.get(`/callback?code=${code}&state=${state}`, {
    maxRedirects: 0,
  });

  // A transaction for each request has arrived once the callback's has.
  await expect
    .poll(async () => (await sentryText()).includes('/callback'), {
      timeout: 20_000,
    })
    .toBe(true);
  const sent = await sentryText();
  const secrets = { bearer, basic, refreshToken, verifier, code, state };
  const leaked = Object.entries(secrets)
    .filter(([, secret]) => sent.includes(secret))
    .map(([name]) => name);
  expect(leaked).toEqual([]);
});
