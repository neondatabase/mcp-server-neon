import { beforeEach, describe, expect, it, vi } from 'vitest';

// Shared spies used by the mocked Redis client. The `redis` mock below closes
// over them so the route's session-binding lookups can be steered per-test.
const setSpy = vi.fn();
const getSpy = vi.fn();
const delSpy = vi.fn();
const connectSpy = vi.fn();

vi.mock('redis', () => ({
  createClient: vi.fn(() => ({
    on: vi.fn(),
    connect: connectSpy,
    set: setSpy,
    get: getSpy,
    del: delSpy,
  })),
}));

vi.mock('../oauth/model', () => ({
  model: {
    getAccessToken: vi.fn(),
  },
}));

vi.mock('../analytics/analytics', () => ({
  track: vi.fn(),
  flushAnalytics: vi.fn().mockResolvedValue(undefined),
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
const { POST } = await import('../../app/api/[transport]/route');

type TokenShape = {
  accessToken: string;
  scope: string;
  client: { id: string; client_name: string; grants: string[] };
  user: { id: string; name: string; email: string };
};

function buildOAuthToken(accessToken: string, userId = 'user-A'): TokenShape {
  return {
    accessToken,
    scope: 'read write',
    client: { id: 'client-1', client_name: 'Cursor', grants: ['*'] },
    user: { id: userId, name: 'User', email: `${userId}@example.com` },
  };
}

async function postMessage(token: string, sessionId: string) {
  const url = `http://localhost/api/message?sessionId=${encodeURIComponent(
    sessionId,
  )}`;
  const req = new Request(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    }),
  });
  const res = await POST(req);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

describe('route session-binding wiring (POST /api/message)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSpy.mockReset();
    getSpy.mockReset();
    delSpy.mockReset();
    connectSpy.mockReset();
    connectSpy.mockResolvedValue(undefined);
    process.env.KV_URL = 'redis://localhost:6379';
  });

  it('returns 403 with code session_not_owned when no binding exists for the sessionId', async () => {
    vi.mocked(model.getAccessToken).mockResolvedValue(
      buildOAuthToken('token-A', 'user-A') as never,
    );
    // Both the initial lookup and the retry return null (no binding).
    getSpy.mockResolvedValue(null);

    const { status, body } = await postMessage('token-A', 'sess-unbound');

    expect(status).toBe(403);
    expect(body).toEqual({
      error: 'Session binding not found',
      code: 'session_not_owned',
    });
  });

  it('returns 403 with code session_not_owned when the bound owner is a different caller', async () => {
    // caller B calls a session that's bound to caller A's identity
    vi.mocked(model.getAccessToken).mockResolvedValue(
      buildOAuthToken('token-B', 'user-B') as never,
    );
    getSpy.mockResolvedValue('some-other-identity-fingerprint-32');

    const { status, body } = await postMessage('token-B', 'sess-victim');

    expect(status).toBe(403);
    const json = body as { error?: string; code?: string };
    expect(json.code).toBe('session_not_owned');
    expect(typeof json.error).toBe('string');
  });

  it('returns 503 with code session_verification_unavailable when redis throws', async () => {
    vi.mocked(model.getAccessToken).mockResolvedValue(
      buildOAuthToken('token-A', 'user-A') as never,
    );
    getSpy.mockRejectedValue(new Error('redis-down'));

    const { status, body } = await postMessage('token-A', 'sess-error');

    expect(status).toBe(503);
    expect(body).toEqual({
      error: 'Session verification unavailable',
      code: 'session_verification_unavailable',
    });
  });

  it('returns 401 with code caller_identity_unavailable when verifyToken cannot derive an identity', async () => {
    // No OAuth token + no API key path → verifyToken returns undefined →
    // withMcpAuth normally yields 401. But since `checkSessionOwnership`
    // runs *after* withMcpAuth has authenticated, this scenario only fires
    // when token verification succeeds yet the resulting authInfo is missing
    // the fields deriveIdentity needs. We simulate that with a token whose
    // user/apiKey combo deriveIdentity rejects.
    vi.mocked(model.getAccessToken).mockResolvedValue({
      accessToken: 'token-x',
      scope: 'read write',
      client: { id: 'c', client_name: 'Cursor', grants: ['*'] },
      // user.id is empty → deriveIdentity returns null
      user: { id: '', name: '', email: '' },
    } as never);

    const { status, body } = await postMessage('token-x', 'sess-id');

    // When identity is null and the path is POST /message with a sessionId,
    // evaluateMessageOwnership returns 401.
    expect(status).toBe(401);
    expect(body).toEqual({
      error: 'Caller identity unavailable',
      code: 'caller_identity_unavailable',
    });
  });
});
