import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { GrantContext } from '../utils/grant-context';

const { getProjectSpy } = vi.hoisted(() => ({
  getProjectSpy: vi.fn(async () => ({
    content: [{ type: 'text', text: '{}' }],
  })),
}));

const mocks = vi.hoisted(() => ({
  setSpy: vi.fn(),
  getSpy: vi.fn(),
  delSpy: vi.fn(),
  connectSpy: vi.fn(),
  toolHandlers: new Map<
    string,
    (args: unknown, extra: unknown) => Promise<unknown>
  >(),
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
      initializeServer: (server: {
        registerTool: (
          name: string,
          _def: unknown,
          handler: (args: unknown, extra: unknown) => Promise<unknown>,
        ) => void;
        server: {
          setRequestHandler: () => void;
          getClientVersion: () => { name: string; version: string };
        };
      }) => void,
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
        mocks.toolHandlers.clear();
        initializeServer({
          registerTool: (name, _def, handler) => {
            mocks.toolHandlers.set(name, handler);
          },
          server: {
            setRequestHandler: () => undefined,
            getClientVersion: () => ({
              name: 'test-client',
              version: '1.0.0',
            }),
          },
        });
        config.onEvent?.({
          type: 'SESSION_STARTED',
          timestamp: Date.now(),
          sessionId: 'sess-grant',
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

vi.mock('../tools/tools', async () => {
  const actual =
    await vi.importActual<typeof import('../tools/tools')>('../tools/tools');
  return {
    ...actual,
    NEON_HANDLERS: {
      ...actual.NEON_HANDLERS,
      get_project: getProjectSpy,
    },
  };
});

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

const SCOPED_PROJECT_ID = 'proj-sse';

function buildOAuthToken(accessToken: string, grant: GrantContext) {
  return {
    accessToken,
    scope: 'read write',
    client: { id: 'client-1', client_name: 'Cursor', grants: ['*'] },
    user: { id: 'user-A', name: 'User', email: 'user-A@example.com' },
    grant,
  };
}

describe('SSE connection grant on tool invocation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setSpy.mockReset();
    mocks.getSpy.mockReset();
    mocks.delSpy.mockReset();
    mocks.connectSpy.mockReset();
    mocks.connectSpy.mockResolvedValue(undefined);
    mocks.setSpy.mockResolvedValue('OK');
    mocks.toolHandlers.clear();
    getProjectSpy.mockClear();
    process.env.KV_URL = 'redis://localhost:6379';
  });

  it('injects the SSE connection project when the message grant is empty', async () => {
    vi.mocked(model.getAccessToken).mockResolvedValue(
      buildOAuthToken('token-A', {
        projectId: SCOPED_PROJECT_ID,
        scopes: null,
      }) as never,
    );

    const response = await GET(
      new Request('http://localhost/api/sse', {
        method: 'GET',
        headers: {
          Authorization: 'Bearer token-A',
          Accept: 'text/event-stream',
        },
      }),
    );
    expect(response.status).toBe(200);
    await response.body?.cancel();

    const getProject = mocks.toolHandlers.get('get_project');
    expect(getProject).toBeDefined();

    await getProject?.(
      {},
      {
        authInfo: {
          token: 'token-A',
          clientId: 'client-1',
          extra: {
            apiKey: 'token-A',
            authMethod: 'oauth',
            account: {
              id: 'user-A',
              name: 'User',
              email: 'user-A@example.com',
            },
            grant: { projectId: null, scopes: null },
            transport: 'sse',
          },
        },
      },
    );

    expect(getProjectSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({ project_id: SCOPED_PROJECT_ID }),
      }),
      expect.anything(),
      expect.anything(),
    );
  });
});
