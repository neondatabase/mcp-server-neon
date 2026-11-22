/**
 * Vercel can freeze a function once its response ends, so every path that
 * leaves Sentry data behind must keep the function alive until it is sent.
 * Real routes and the real Sentry SDK, sending to the e2e Sentry stand-in, with
 * Vercel's request context collecting what each request hands to `waitUntil`.
 */
import { once } from 'node:events';
import { flush, httpIntegration, init } from '@sentry/node';
import { Effect } from 'effect';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ensureTestOauthDatabase } from './ensure-test-oauth-database';

process.env.E2E_SENTRY_PORT = '3124';

const {
  SENTRY_FIXTURE_DSN,
  SENTRY_FIXTURE_ITEMS_URL,
  startSentryFixtureServer,
} = await import('../../e2e/sentry-fixture');

await ensureTestOauthDatabase();

const { app } = await import('../../lib/http/app');
const { mcpApp } = await import('../../lib/http/mcp-app');
const { SERVER_HOST } = await import('../../lib/config');
const { reportServerFailure } = await import('../sentry/effect');
const { flushAfterResponse } = await import('../sentry/flush');
const { runSdkCallback } = await import('../server/tool-call');

const keepalives: Promise<unknown>[] = [];
const requestContext = Symbol.for('@vercel/request-context');

Object.defineProperty(globalThis, requestContext, {
  value: {
    get: () => ({
      waitUntil: (promise: Promise<unknown>) => keepalives.push(promise),
    }),
  },
  configurable: true,
});

const fixture = await startSentryFixtureServer();

// The fixture's own HTTP requests would otherwise become transactions too.
init({
  dsn: SENTRY_FIXTURE_DSN,
  tracesSampleRate: 1,
  integrations: [httpIntegration({ ignoreIncomingRequests: () => true })],
});

const Items = z.array(z.object({ type: z.string(), payload: z.unknown() }));

const ErrorEvent = z.object({
  exception: z.object({ values: z.array(z.object({ value: z.string() })) }),
});

const errorEventsWith = async (message: string) => {
  await flush(5000);

  const response = await fetch(SENTRY_FIXTURE_ITEMS_URL);

  return Items.parse(await response.json())
    .filter((item) => item.type === 'event')
    .map((item) => ErrorEvent.parse(item.payload))
    .filter((event) =>
      event.exception.values.some(({ value }) => value === message),
    );
};

const oauthRequest = async (path: string, body: string, contentType: string) =>
  app.handler(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': contentType },
      body,
    }),
  );

const docsOnlyToolsList = async () =>
  mcpApp.handler(
    new Request(`${SERVER_HOST}/mcp?category=docs`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-method': 'tools/list',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientInfo': {
              name: 'sentry-lifetime',
              version: '1.0.0',
            },
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      }),
    }),
  );

describe('Sentry delivery lifetime', () => {
  beforeEach(() => {
    keepalives.length = 0;
  });

  afterAll(async () => {
    Reflect.deleteProperty(globalThis, requestContext);
    await Promise.all([app.dispose(), mcpApp.dispose()]);
    fixture.close();
    await once(fixture, 'close');
  });

  it('keeps the function alive after an OAuth request that succeeds', async () => {
    const response = await oauthRequest(
      '/api/register',
      JSON.stringify({
        client_name: 'Codex',
        redirect_uris: ['http://127.0.0.1:55555/callback'],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'client_secret_post',
      }),
      'application/json',
    );

    expect(response.status).toBe(200);
    expect(keepalives).toHaveLength(1);
    await Promise.all(keepalives);
  });

  it('keeps the function alive after an OAuth request that fails', async () => {
    const response = await oauthRequest(
      '/api/token',
      new URLSearchParams({ grant_type: 'password' }).toString(),
      'application/x-www-form-urlencoded',
    );

    expect(response.status).toBe(400);
    expect(keepalives).toHaveLength(1);
    await Promise.all(keepalives);
  });

  it('keeps the function alive once an MCP response body is sent', async () => {
    const response = await docsOnlyToolsList();

    expect(response.status).toBe(200);
    expect(keepalives).toHaveLength(0);

    await response.text();

    expect(keepalives).toHaveLength(1);
    await Promise.all(keepalives);
  });

  it('keeps the function alive when the client cancels an MCP response body', async () => {
    const response = await docsOnlyToolsList();

    expect(response.status).toBe(200);
    expect(keepalives).toHaveLength(0);

    await response.body?.cancel();

    expect(keepalives).toHaveLength(1);
    await Promise.all(keepalives);
  });

  it('keeps the function alive when an MCP response body fails while streaming', async () => {
    const response = await Effect.runPromise(
      flushAfterResponse(
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.error(new Error('stream write failed'));
            },
          }),
        ),
      ),
    );

    await expect(response.text()).rejects.toThrow('stream write failed');

    expect(keepalives).toHaveLength(1);
    await Promise.all(keepalives);
  });

  it('reports a defect in an SDK callback once and keeps the function alive', async () => {
    runSdkCallback(Effect.die(new Error('sdk-callback-defect-canary')));

    expect(keepalives).toHaveLength(1);
    await Promise.all(keepalives);

    await expect(
      errorEventsWith('sdk-callback-defect-canary'),
    ).resolves.toHaveLength(1);
  });

  it('does not report an error an SDK callback already reported again when it dies with it', async () => {
    const error = new Error('sdk-callback-reported-canary');

    runSdkCallback(
      reportServerFailure(error, {}).pipe(Effect.andThen(Effect.die(error))),
    );
    await Promise.all(keepalives);

    await expect(
      errorEventsWith('sdk-callback-reported-canary'),
    ).resolves.toHaveLength(1);
  });
});
