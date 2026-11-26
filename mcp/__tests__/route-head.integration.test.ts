/**
 * Integration coverage for HEAD requests to the MCP transport route.
 *
 * Production regression: `HEAD /mcp` returned 504 after burning the full
 * function runtime ceiling, once per uptime probe. The cause was a gap between two
 * layers — Next.js answers HEAD with the GET export, and mcp-handler's
 * streamable-HTTP branch writes a response only for GET, DELETE, and POST. A HEAD
 * matched the `/api/mcp` pathname, fell through every method branch, and returned
 * without ever writing a response, so the promise never settled:
 *
 *   HEAD /mcp  →  verifyToken called (API key cache hit, auth OK)
 *              →  Vercel Runtime Timeout Error
 *
 * mcp-handler is deliberately NOT mocked here: the whole bug lives in how that
 * library dispatches by method, so a test that stubs it would prove nothing. The
 * route runs on its real services; the OAuth token is stored in the test Postgres
 * database.
 *
 * Every assertion runs under a response-time budget, because the failure mode
 * under test is "never answers" rather than "answers wrongly".
 */

import { Effect } from 'effect';
import { beforeAll, describe, expect, it } from 'vitest';
import { GET, HEAD } from '../../app/api/[transport]/route';
import { OAuthStore } from '../oauth/oauth-store';
import { ensureTestOauthDatabase } from './ensure-test-oauth-database';

/**
 * A hanging request is the bug, so waiting for vitest's default timeout would
 * report it as a generic slow test. This budget names the failure instead.
 */
const RESPONSE_BUDGET_MS = 2_000;

const BEARER_TOKEN = `oauth-token-head-${crypto.randomUUID()}`;

const saveOAuthToken = async () =>
  Effect.runPromise(
    OAuthStore.pipe(
      Effect.flatMap((store) =>
        store.saveTokenPair({
          token: {
            accessToken: BEARER_TOKEN,
            scope: 'read write',
            client: {
              id: 'client-1',
              client_name: 'uptime-probe',
              grants: ['*'],
            },
            user: {
              id: 'user-A',
              name: 'User',
              email: 'user-a@example.com',
              isOrg: false,
            },
          },
          refreshToken: `${BEARER_TOKEN}-refresh`,
        }),
      ),
      Effect.provide(OAuthStore.layer),
    ),
  );

async function withinBudget(
  work: Promise<Response> | Response,
): Promise<Response> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `No response within ${RESPONSE_BUDGET_MS}ms. On Vercel this request ` +
              'runs to the function timeout and returns 504.',
          ),
        ),
      RESPONSE_BUDGET_MS,
    );
  });
  try {
    return await Promise.race([Promise.resolve(work), budget]);
  } finally {
    clearTimeout(timer);
  }
}

function authorized(): Record<string, string> {
  return { Authorization: `Bearer ${BEARER_TOKEN}` };
}

function sendHead(
  url: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  return withinBudget(HEAD(new Request(url, { method: 'HEAD', headers })));
}

describe('HEAD on the MCP transport route', () => {
  beforeAll(async () => {
    await ensureTestOauthDatabase();
    await saveOAuthToken();
  });

  it('answers an authenticated HEAD instead of hanging until the function times out', async () => {
    // The exact production request: a valid credential, then no response.
    const response = await sendHead(
      'https://mcp.neon.tech/api/mcp',
      authorized(),
    );

    // Mirrors what GET returns for the POST-only streamable transport.
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST');
    await expect(response.text()).resolves.toBe('');
  });

  it('answers a HEAD on the legacy /mcp path', async () => {
    // The 504s were on /mcp, which is rewritten to /api/mcp before dispatch.
    const response = await sendHead('https://mcp.neon.tech/mcp', authorized());

    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST');
  });

  it('answers an anonymous docs-only HEAD, which bypasses auth entirely', async () => {
    // ?category=docs skips the auth wrapper, so without a HEAD branch an
    // unauthenticated probe could burn the full function runtime. Without
    // that skip, this credential-less request would get the 401 challenge.
    const response = await sendHead(
      'https://mcp.neon.tech/api/mcp?category=docs',
    );

    expect(response.status).toBe(405);
    expect(response.headers.get('WWW-Authenticate')).toBeNull();
    await expect(response.text()).resolves.toBe('');
  });

  it('keeps the OAuth challenge for an unauthenticated HEAD', async () => {
    // MCP clients discover the authorization server from this 401, so HEAD must
    // not become an unauthenticated 200.
    const response = await sendHead('https://mcp.neon.tech/api/mcp');

    expect(response.status).toBe(401);
    expect(response.headers.get('WWW-Authenticate')).toContain(
      'resource_metadata=',
    );
    await expect(response.text()).resolves.toBe('');
  });

  it('leaves GET dispatch to mcp-handler', async () => {
    // Guards the fix's blast radius: GET must still reach the real library, which
    // is what produces the JSON-RPC 405 body for the POST-only transport.
    const response = await withinBudget(
      GET(
        new Request('https://mcp.neon.tech/api/mcp', {
          method: 'GET',
          headers: authorized(),
        }),
      ),
    );

    expect(response.status).toBe(405);
    const body = await response.json();
    expect(body).toMatchObject({
      jsonrpc: '2.0',
      error: { message: 'Method not allowed.' },
    });
  });
});
