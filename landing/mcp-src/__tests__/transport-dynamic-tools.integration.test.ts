import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GrantContext } from '../utils/grant-context';

const { runSqlSpy } = vi.hoisted(() => ({
  runSqlSpy: vi.fn(async ({ params }: { params: Record<string, unknown> }) => ({
    content: [{ type: 'text', text: JSON.stringify(params) }],
  })),
}));

vi.mock('../oauth/model', () => ({
  model: {
    getAccessToken: vi.fn(),
  },
}));

vi.mock('../tools/index', async () => {
  const actual =
    await vi.importActual<typeof import('../tools/index')>('../tools/index');
  const actualHandlers =
    await vi.importActual<typeof import('../tools/tools')>('../tools/tools');
  return {
    ...actual,
    NEON_HANDLERS: {
      ...actualHandlers.NEON_HANDLERS,
      run_sql: runSqlSpy,
    },
  };
});

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
  grant?: GrantContext;
};

function buildOAuthToken(
  accessToken: string,
  scope: string,
  grant?: GrantContext,
): TokenShape {
  return {
    accessToken,
    scope,
    client: { id: 'client-1', client_name: 'Cursor', grants: ['*'] },
    user: { id: 'user-1', name: 'User', email: 'user@example.com' },
    grant,
  };
}

async function mcpCall(
  bearerToken: string,
  method: string,
  id: number,
  params?: unknown,
) {
  const req = new Request('http://localhost/api/mcp', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      ...(params ? { params } : {}),
    }),
  });

  const res = await POST(req);
  const raw = await res.text();
  let body: unknown = raw;
  try {
    body = JSON.parse(raw);
  } catch {
    const dataLines = raw
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => line.slice('data: '.length).trim());
    const lastDataLine = dataLines[dataLines.length - 1];
    if (lastDataLine) {
      try {
        body = JSON.parse(lastDataLine);
      } catch {
        // Keep raw text for debugging/assertions
      }
    }
  }
  return { status: res.status, body };
}

async function listToolsForToken(token: string) {
  await mcpCall(token, 'initialize', 1, {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '1.0.0' },
  });

  const list = await mcpCall(token, 'tools/list', 2, {});
  if (list.status !== 200) {
    throw new Error(
      `tools/list failed with status ${list.status}: ${JSON.stringify(list.body)}`,
    );
  }
  expect(list.status).toBe(200);
  const listBody = list.body as {
    error?: unknown;
    result: { tools: unknown[] };
  };
  expect(listBody.error).toBeUndefined();
  return listBody.result.tools as Array<{
    name: string;
    inputSchema: { properties?: Record<string, unknown> };
  }>;
}

describe('transport dynamic tool composition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runSqlSpy.mockClear();
  });

  it('keeps same tool names and enforces projectId by selected variant', async () => {
    const unscopedToken = 'oauth-unscoped';
    const scopedToken = 'oauth-scoped';

    vi.mocked(model.getAccessToken).mockImplementation(async (token) => {
      if (token === unscopedToken) {
        return buildOAuthToken(unscopedToken, 'read write', {
          projectId: null,
          scopes: null,
        });
      }
      if (token === scopedToken) {
        return buildOAuthToken(scopedToken, 'read write', {
          projectId: 'proj_123',
          scopes: null,
        });
      }
      return undefined;
    });

    const unscopedTools = await listToolsForToken(unscopedToken);
    const scopedTools = await listToolsForToken(scopedToken);

    const unscopedNames = new Set(unscopedTools.map((t) => t.name));
    const scopedNames = new Set(scopedTools.map((t) => t.name));

    expect(unscopedNames.has('run_sql')).toBe(true);
    expect(scopedNames.has('run_sql')).toBe(true);
    expect(scopedNames.has('list_projects')).toBe(false);

    // Unscoped variant still requires projectId from caller -> handler should not run.
    await mcpCall(unscopedToken, 'tools/call', 3, {
      name: 'run_sql',
      arguments: { sql: 'select 1' },
    });
    expect(runSqlSpy).toHaveBeenCalledTimes(0);

    // Project-scoped variant injects projectId from auth grant -> handler runs.
    await mcpCall(scopedToken, 'tools/call', 4, {
      name: 'run_sql',
      arguments: { sql: 'select 1' },
    });
    expect(runSqlSpy).toHaveBeenCalledTimes(1);
  });

  it('isolates cached handlers by auth context key', async () => {
    const fullAccessToken = 'oauth-full';
    const readOnlyToken = 'oauth-read-only';

    vi.mocked(model.getAccessToken).mockImplementation(async (token) => {
      if (token === fullAccessToken) {
        return buildOAuthToken(fullAccessToken, 'read write');
      }
      if (token === readOnlyToken) {
        return buildOAuthToken(readOnlyToken, 'read');
      }
      return undefined;
    });

    const fullAccessTools = await listToolsForToken(fullAccessToken);
    const readOnlyTools = await listToolsForToken(readOnlyToken);

    const fullNames = new Set(fullAccessTools.map((t) => t.name));
    const readOnlyNames = new Set(readOnlyTools.map((t) => t.name));

    expect(fullNames.has('create_project')).toBe(true);
    expect(readOnlyNames.has('create_project')).toBe(false);
    expect(readOnlyNames.has('list_projects')).toBe(true);
  });
});
