/**
 * Integration coverage for HEAD requests to the MCP transport route.
 *
 * Production regression: `HEAD /mcp` returned 504 after burning the full 800s
 * Fluid Compute ceiling, once per uptime probe. The cause is a gap between two
 * layers — Next.js answers HEAD with the GET export, and mcp-handler's
 * streamable-HTTP branch writes a response only for GET, DELETE, and POST. A HEAD
 * matched the `/api/mcp` pathname, fell through every method branch, and returned
 * without ever writing a response, so the promise never settled:
 *
 *   HEAD /mcp  →  verifyToken called (API key cache hit, auth OK)
 *              →  Vercel Runtime Timeout Error: Task timed out after 800 seconds
 *
 * mcp-handler is deliberately NOT mocked here: the whole bug lives in how that
 * library dispatches by method, so a test that stubs it would prove nothing. Only
 * the OAuth token store (Postgres-backed) and the logger are replaced.
 *
 * Every assertion runs under a response-time budget, because the failure mode
 * under test is "never answers" rather than "answers wrongly".
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../oauth/model', () => ({
  model: {
    getAccessToken: vi.fn(),
  },
}));

vi.mock('../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    silent: false,
  },
}));

const { model } = await import('../oauth/model');
const { HEAD, GET } = await import('../../app/api/[transport]/route');

/**
 * A hanging request is the bug, so waiting for vitest's default timeout would
 * report it as a generic slow test. This budget names the failure instead.
 */
const RESPONSE_BUDGET_MS = 2_000;

const BEARER_TOKEN = 'oauth-token-head';

function buildOAuthToken() {
  return {
    accessToken: BEARER_TOKEN,
    scope: 'read write',
    client: { id: 'client-1', client_name: 'uptime-probe', grants: ['*'] },
    user: {
      id: 'user-A',
      name: 'User',
      email: 'user-a@example.com',
      isOrg: false,
    },
  };
}

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
              'runs to the 800s maxDuration and returns 504.',
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
  beforeEach(() => {
    vi.mocked(model.getAccessToken).mockReset();
  });

  it('answers an authenticated HEAD instead of hanging until the function times out', async () => {
    // The exact production request: a valid credential, then 800s of silence.
    vi.mocked(model.getAccessToken).mockResolvedValue(
      buildOAuthToken() as never,
    );

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
    vi.mocked(model.getAccessToken).mockResolvedValue(
      buildOAuthToken() as never,
    );

    const response = await sendHead('https://mcp.neon.tech/mcp', authorized());

    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST');
  });

  it('answers an anonymous docs-only HEAD, which bypasses auth entirely', async () => {
    // ?category=docs skips the auth wrapper, so without a HEAD branch an
    // unauthenticated probe could burn 800s of compute with no credential at all.
    const response = await sendHead(
      'https://mcp.neon.tech/api/mcp?category=docs',
    );

    expect(response.status).toBe(405);
    expect(model.getAccessToken).not.toHaveBeenCalled();
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

  it('advertises the SSE endpoint without opening a stream', async () => {
    // A HEAD cannot carry the stream, and opening one would hold the invocation
    // open for the full SSE duration.
    vi.mocked(model.getAccessToken).mockResolvedValue(
      buildOAuthToken() as never,
    );

    const response = await sendHead(
      'https://mcp.neon.tech/api/sse',
      authorized(),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(response.body).toBeNull();
  });

  it('leaves GET dispatch to mcp-handler', async () => {
    // Guards the fix's blast radius: GET must still reach the real library, which
    // is what produces the JSON-RPC 405 body for the POST-only transport.
    vi.mocked(model.getAccessToken).mockResolvedValue(
      buildOAuthToken() as never,
    );

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
