import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GrantContext } from '../utils/grant-context';
import type { ServerContext } from '../types/context';
import { NEON_TOOLS } from '../tools/definitions';

vi.mock('../analytics/analytics', () => ({
  track: vi.fn(),
}));

vi.mock('@sentry/node', () => ({
  captureException: vi.fn(),
  startSpan: vi.fn((_opts: unknown, fn: (span: unknown) => unknown) =>
    fn({ setStatus: vi.fn() }),
  ),
}));

vi.mock('../sentry/utils', () => ({
  setSentryTags: vi.fn(),
}));

vi.mock('../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    silent: false,
  },
}));

vi.mock('../server/api', () => ({
  createNeonClient: () => ({}),
}));

const { createMcpServer } = await import('../server/index');

function buildContext(overrides: Partial<ServerContext> = {}): ServerContext {
  return {
    apiKey: 'test-api-key',
    account: {
      id: 'acc-1',
      name: 'Test',
      email: 'test@example.com',
    },
    app: {
      name: 'test-app',
      transport: 'stream',
      environment: 'development',
      version: '0.0.0-test',
    },
    ...overrides,
  };
}

function getRegisteredToolNames(
  server: Awaited<ReturnType<typeof createMcpServer>>,
): string[] {
  const registeredTools = (server as unknown as Record<string, unknown>)
    ._registeredTools as Record<string, { enabled: boolean }>;
  return Object.keys(registeredTools);
}

describe('createMcpServer grant + read-only integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers all tools with default grant', async () => {
    const server = await createMcpServer(buildContext());
    expect(getRegisteredToolNames(server)).toHaveLength(NEON_TOOLS.length);
  });

  it('filters by scopes when provided', async () => {
    const grant: GrantContext = {
      projectId: null,
      scopes: ['schema', 'docs'],
    };
    const server = await createMcpServer(buildContext({ grant }));
    const names = getRegisteredToolNames(server);

    expect(names).toContain('describe_table_schema');
    expect(names).toContain('get_database_tables');
    expect(names).toContain('list_docs_resources');
    expect(names).toContain('get_doc_resource');
    expect(names).toContain('search');
    expect(names).toContain('fetch');
    expect(names).not.toContain('create_project');
  });

  it('hides project-agnostic tools in project-scoped mode', async () => {
    const grant: GrantContext = {
      projectId: 'proj-123',
      scopes: null,
    };
    const server = await createMcpServer(buildContext({ grant }));
    const names = getRegisteredToolNames(server);

    expect(names).not.toContain('list_projects');
    expect(names).not.toContain('create_project');
    expect(names).toContain('describe_project');
    expect(names).toContain('run_sql');
  });

  it('readOnly context filters to readOnlySafe tools', async () => {
    const server = await createMcpServer(buildContext({ readOnly: true }));
    const names = getRegisteredToolNames(server);
    const readOnlyTools = NEON_TOOLS.filter((t) => t.readOnlySafe);
    expect(names).toHaveLength(readOnlyTools.length);
  });
});
