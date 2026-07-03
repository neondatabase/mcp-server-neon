import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

const mocks = vi.hoisted(() => ({
  setSpy: vi.fn(),
  getSpy: vi.fn(),
  delSpy: vi.fn(),
  connectSpy: vi.fn(),
}));

vi.mock('redis', () => ({
  createClient: vi.fn(() => ({
    on: vi.fn(),
    connect: mocks.connectSpy,
    set: mocks.setSpy,
    get: mocks.getSpy,
    del: mocks.delSpy,
  })),
}));

vi.mock('mcp-handler', () => ({
  createMcpHandler: vi.fn(
    (
      _initializeServer: unknown,
      _serverOptions: unknown,
      config: {
        onEvent?: (event: {
          type: 'SESSION_STARTED';
          timestamp: number;
          sessionId: string;
          transport: 'SSE';
        }) => void;
      },
    ) =>
      async () => {
        config.onEvent?.({
          type: 'SESSION_STARTED',
          timestamp: Date.now(),
          sessionId: 'sess-test',
          transport: 'SSE',
        });
        return new Response(new ReadableStream(), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      },
  ),
  withMcpAuth: vi.fn(
    (
      handler: (req: Request) => Response | Promise<Response>,
      verifyToken: (
        req: Request,
        bearerToken?: string,
      ) => unknown | Promise<unknown>,
    ) =>
      async (req: Request) => {
        const authHeader = req.headers.get('Authorization');
        const [type, token] = authHeader?.split(' ') ?? [];
        const authInfo = (await verifyToken(
          req,
          type?.toLowerCase() === 'bearer' ? token : undefined,
        )) as AuthInfo | undefined;
        if (!authInfo) return new Response(null, { status: 401 });
        (req as Request & { auth?: AuthInfo }).auth = authInfo;
        return handler(req);
      },
  ),
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
const { GET } = await import('../../app/api/[transport]/route');

const ROUTE_PATHS = {
  canonicalSse: '/api/sse',
  legacySse: '/sse',
} as const;

const SESSION_BINDING_UNAVAILABLE_RESPONSE = {
  error: 'Session binding unavailable',
  code: 'session_binding_unavailable',
} as const;

function buildOAuthToken(accessToken: string, userId = 'user-A') {
  return {
    accessToken,
    scope: 'read write',
    client: { id: 'client-1', client_name: 'Cursor', grants: ['*'] },
    user: { id: userId, name: 'User', email: `${userId}@example.com` },
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function openSse(
  token: string,
  path: string = ROUTE_PATHS.canonicalSse,
): Promise<Response> {
  return await GET(
    new Request(`http://localhost${path}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'text/event-stream',
      },
    }),
  );
}

describe('route SSE session binding gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setSpy.mockReset();
    mocks.getSpy.mockReset();
    mocks.delSpy.mockReset();
    mocks.connectSpy.mockReset();
    mocks.connectSpy.mockResolvedValue(undefined);
    mocks.setSpy.mockResolvedValue('OK');
    process.env.KV_URL = 'redis://localhost:6379';
  });

  it('does not return the SSE response until the session binding is stored', async () => {
    vi.mocked(model.getAccessToken).mockResolvedValue(
      buildOAuthToken('token-A') as never,
    );
    const binding = createDeferred<string>();
    mocks.setSpy.mockReturnValue(binding.promise);

    let settled = false;
    const responsePromise = openSse('token-A').then((response) => {
      settled = true;
      return response;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mocks.setSpy).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    binding.resolve('OK');
    const response = await responsePromise;

    expect(settled).toBe(true);
    expect(response.status).toBe(200);
    await response.body?.cancel();
  });

  it('applies the binding gate to the legacy /sse path', async () => {
    vi.mocked(model.getAccessToken).mockResolvedValue(
      buildOAuthToken('token-A') as never,
    );

    const response = await openSse('token-A', ROUTE_PATHS.legacySse);

    expect(mocks.setSpy).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    await response.body?.cancel();
  });

  it('returns 503 instead of opening SSE when the session binding cannot be stored', async () => {
    vi.mocked(model.getAccessToken).mockResolvedValue(
      buildOAuthToken('token-A') as never,
    );
    mocks.setSpy.mockRejectedValue(new Error('redis-down'));

    const response = await openSse('token-A');

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual(
      SESSION_BINDING_UNAVAILABLE_RESPONSE,
    );
  });
});
