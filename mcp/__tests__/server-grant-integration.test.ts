import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
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
    authMethod: 'api_key_user',
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
    expect(names).toContain('compare_database_schema');
    expect(names).not.toContain('reset_from_parent');
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
    expect(names).toContain('compare_database_schema');
    expect(names).not.toContain('reset_from_parent');
  });

  it('does not register get_connection_string in readOnly context', async () => {
    // The tool returns a URI carrying the branch owner role's password, which
    // authenticates against the read-write compute.
    const server = await createMcpServer(buildContext({ readOnly: true }));

    expect(getRegisteredToolNames(server)).not.toContain(
      'get_connection_string',
    );
  });

  it('registers get_connection_string in write mode', async () => {
    const server = await createMcpServer(buildContext());

    expect(getRegisteredToolNames(server)).toContain('get_connection_string');
  });

  it('puts access-control notices on initialize instructions', async () => {
    const mcpServer = await createMcpServer(
      buildContext({
        grant: { projectId: 'proj-123', scopes: null },
        readOnly: true,
      }),
    );
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await mcpServer.connect(serverTransport);
      await client.connect(clientTransport);
      const instructions = client.getInstructions() ?? '';
      expect(instructions).toContain('read-only permissions');
      expect(instructions).toContain('scoped to one project only (proj-123)');
      const listed = await client.listTools();
      for (const tool of listed.tools) {
        expect(tool.description ?? '').not.toContain('read-only permissions');
      }
    } finally {
      await Promise.allSettled([client.close(), mcpServer.close()]);
    }
  });
});
