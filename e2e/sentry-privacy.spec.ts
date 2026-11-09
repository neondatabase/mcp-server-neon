/**
 * OAuth credentials and codes must never reach Sentry. The routes receive
 * them in the Authorization header (client_secret_basic, bearer tokens), in
 * form bodies (refresh tokens, PKCE verifiers), and in the query string
 * (authorization codes, state). Each request carries a unique canary, and no
 * envelope the server sends may contain one.
 */

import { test, expect } from '@playwright/test';
import {
  SENTRY_FIXTURE_ITEMS_URL,
  type EnvelopeItem,
} from './sentry-fixture.js';

function randomHex(bytes: number): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString(
    'hex',
  );
}

// The server continues an incoming `sentry-trace`, so each request's
// transaction can be found by a trace id the test chose.
function newTrace() {
  const traceId = randomHex(16);
  return { traceId, header: `${traceId}-${randomHex(8)}-1` };
}

function traceIdOf(item: EnvelopeItem): unknown {
  const payload = item.payload;
  if (typeof payload !== 'object' || payload === null) return undefined;
  const contexts = 'contexts' in payload ? payload.contexts : undefined;
  if (typeof contexts !== 'object' || contexts === null) return undefined;
  const trace = 'trace' in contexts ? contexts.trace : undefined;
  if (typeof trace !== 'object' || trace === null) return undefined;
  return 'trace_id' in trace ? trace.trace_id : undefined;
}

async function sentryItems(): Promise<EnvelopeItem[]> {
  const response = await fetch(SENTRY_FIXTURE_ITEMS_URL);
  expect(response.ok).toBe(true);
  return (await response.json()) as EnvelopeItem[];
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
  const traces = [newTrace(), newTrace(), newTrace()];

  // The docs-only route answers 200 without checking the bearer, so the
  // request is traced without reaching the Neon API. The SDK drops
  // transactions for 401 to 404 responses.
  await request.post('/mcp?category=docs', {
    headers: {
      Authorization: `Bearer ${bearer}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'sentry-trace': traces[0].header,
    },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
  });
  await request.post('/api/token', {
    headers: {
      Authorization: `Basic ${basic}`,
      'sentry-trace': traces[1].header,
    },
    form: {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      code_verifier: verifier,
    },
  });
  await request.get(`/callback?code=${code}&state=${state}`, {
    headers: { 'sentry-trace': traces[2].header },
    maxRedirects: 0,
  });

  await expect
    .poll(
      async () => {
        const arrived = new Set(
          (await sentryItems())
            .filter((item) => item.type === 'transaction')
            .map(traceIdOf),
        );
        return traces.every(({ traceId }) => arrived.has(traceId));
      },
      { timeout: 20_000 },
    )
    .toBe(true);

  const sent = JSON.stringify(await sentryItems());
  const secrets = { bearer, basic, refreshToken, verifier, code, state };
  const leaked = Object.entries(secrets)
    .filter(([, secret]) => sent.includes(secret))
    .map(([name]) => name);
  expect(leaked).toEqual([]);
});
