/**
 * A grant can pin the Postgres role that every SQL connection logs in as
 * (`?roleName=`). The pin is enforced in `handleGetConnectionString`, so these
 * tests drive real tool handlers through `invokeTool` — the path both servers
 * use — and check which role the Neon API was asked for.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Api } from '../neon-client';
import type { ToolHandlerExtraParams } from '../tools/types';
import type { GrantContext } from '../utils/grant-context';

const { neonSpy, querySpy, transactionSpy } = vi.hoisted(() => {
  // One row shaped to satisfy every tool's precondition queries (table
  // exists, extension installed), so each tool runs to completion.
  const querySpy = vi.fn<(sql: string, params?: unknown[]) => Promise<unknown>>(
    async () => [
      {
        session_user: 'mcp_pinned_reader',
        relation_name: 'public.t',
        extension_exists: true,
      },
    ],
  );
  const transactionSpy = vi.fn<
    (queries: unknown[], options?: { readOnly?: boolean }) => Promise<unknown>
  >(async (queries) => queries.map(() => [{ ok: true }]));
  const neonSpy = vi.fn((uri: string) => ({
    uri,
    query: (sql: string, params?: unknown[]) => querySpy(sql, params),
    transaction: transactionSpy,
  }));
  return { neonSpy, querySpy, transactionSpy };
});

vi.mock('@neondatabase/serverless', async () => {
  const actual = await vi.importActual<
    typeof import('@neondatabase/serverless')
  >('@neondatabase/serverless');
  return { ...actual, neon: neonSpy };
});

const { invokeTool } = await import('../tools/registration');
const { handleToolError } = await import('../server/errors');
const { getAvailableTools, getAccessControlNotices } =
  await import('../tools/grant-filter');

const PROJECT_ID = 'example-project-123';
const BRANCH_ID = 'br-example-123';
const DATABASE = 'app_db';
const OWNER = 'app_db_owner';
const PINNED = 'mcp_pinned_reader';
const PASSWORD = 'FAKE_TEST_PASSWORD_123';

function uriFor(role: string) {
  return `postgresql://${role}:${PASSWORD}@ep-example-123.example.test/${DATABASE}?sslmode=require`;
}

function fakeNeonClient() {
  return {
    listProjectBranches: vi.fn(async () => ({
      data: { branches: [{ id: BRANCH_ID, default: true }] },
    })),
    getProjectBranch: vi.fn(async () => ({
      data: {
        branch: { id: BRANCH_ID, name: 'main', project_id: PROJECT_ID },
      },
    })),
    listProjectBranchDatabases: vi.fn(async () => ({
      data: { databases: [{ name: DATABASE, owner_name: OWNER }] },
    })),
    getProjectBranchDatabase: vi.fn(async () => ({
      data: { database: { name: DATABASE, owner_name: OWNER } },
    })),
    getConnectionUri: vi.fn(async ({ role_name }: { role_name: string }) => ({
      data: { uri: uriFor(role_name) },
    })),
  };
}

type FakeClient = ReturnType<typeof fakeNeonClient>;

const PINNED_GRANT: GrantContext = {
  projectId: null,
  scopes: null,
  roleName: PINNED,
};
const UNPINNED_GRANT: GrantContext = { projectId: null, scopes: null };

function extra(readOnly: boolean): ToolHandlerExtraParams {
  return {
    readOnly,
    account: { id: 'user-1', name: 'Test' },
    clientApplication: 'unknown',
    signal: new AbortController().signal,
  } as unknown as ToolHandlerExtraParams;
}

async function call(
  tool: string,
  args: Record<string, unknown>,
  grant: GrantContext,
  client: FakeClient,
  readOnly = false,
) {
  return invokeTool(
    tool,
    args,
    grant,
    client as unknown as Api<unknown>,
    extra(readOnly),
  );
}

function requestedRoles(client: FakeClient): string[] {
  return client.getConnectionUri.mock.calls.map(([params]) => params.role_name);
}

function resultText(result: { content: unknown[] }): string {
  return JSON.stringify(result.content);
}

// Every host tool that opens a Postgres connection through
// handleGetConnectionString, with arguments that let it reach that call.
const SQL_TOOL_CALLS: Array<[string, Record<string, unknown>]> = [
  ['run_sql', { sql: 'SELECT 1', project_id: PROJECT_ID }],
  [
    'run_sql_transaction',
    { sql_statements: ['SELECT 1'], project_id: PROJECT_ID },
  ],
  ['explain_sql_statement', { sql: 'SELECT 1', project_id: PROJECT_ID }],
  ['get_database_tables', { project_id: PROJECT_ID }],
  ['describe_table_schema', { project_id: PROJECT_ID, table_name: 'public.t' }],
  ['describe_branch', { project_id: PROJECT_ID, branch_id: BRANCH_ID }],
  ['list_slow_queries', { project_id: PROJECT_ID }],
  ['inspect_database', { project_id: PROJECT_ID, check: 'table-sizes' }],
  ['get_connection_string', { project_id: PROJECT_ID }],
];

beforeEach(() => {
  neonSpy.mockClear();
  querySpy.mockClear();
  transactionSpy.mockClear();
});

describe('pinned Postgres role', () => {
  it.each(SQL_TOOL_CALLS)(
    '%s connects as the pinned role and never looks up the owner',
    async (tool, args) => {
      const client = fakeNeonClient();
      await call(tool, args, PINNED_GRANT, client);

      expect(client.getConnectionUri).toHaveBeenCalled();
      expect(new Set(requestedRoles(client))).toEqual(new Set([PINNED]));
      expect(client.getProjectBranchDatabase).not.toHaveBeenCalled();
      for (const [uri] of neonSpy.mock.calls) {
        expect(uri).toBe(uriFor(PINNED));
      }
    },
  );

  it.each(SQL_TOOL_CALLS)(
    '%s still connects as the database owner without a pin',
    async (tool, args) => {
      const client = fakeNeonClient();
      await call(tool, args, UNPINNED_GRANT, client);

      expect(new Set(requestedRoles(client))).toEqual(new Set([OWNER]));
    },
  );

  it('accepts a role_name equal to the pinned role', async () => {
    const client = fakeNeonClient();
    await call(
      'run_sql',
      { sql: 'SELECT 1', project_id: PROJECT_ID, role_name: PINNED },
      PINNED_GRANT,
      client,
    );
    expect(requestedRoles(client)).toEqual([PINNED]);
  });

  it.each(['run_sql', 'run_sql_transaction'])(
    '%s rejects a role_name that differs from the pinned role before connecting',
    async (tool) => {
      const client = fakeNeonClient();
      const args =
        tool === 'run_sql'
          ? { sql: 'SELECT 1', project_id: PROJECT_ID, role_name: OWNER }
          : {
              sql_statements: ['SELECT 1'],
              project_id: PROJECT_ID,
              role_name: OWNER,
            };

      const error = await call(tool, args, PINNED_GRANT, client).catch(
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).name).toBe('InvalidArgumentError');
      expect((error as Error).message).toContain(PINNED);
      expect(client.getConnectionUri).not.toHaveBeenCalled();
      expect(neonSpy).not.toHaveBeenCalled();

      const response = handleToolError(error, {}, undefined, {
        clientName: 'test',
        clientApplication: 'unknown',
      });
      expect(response.isError).toBe(true);
      expect(resultText(response)).not.toContain(PASSWORD);
      expect(resultText(response)).not.toMatch(/postgres(ql)?:\/\//);
    },
  );

  it('fails closed when Neon cannot resolve the pinned role', async () => {
    const client = fakeNeonClient();
    client.getConnectionUri.mockRejectedValueOnce(
      Object.assign(new Error('role "mcp_pinned_reader" not found'), {
        kind: 'not_found',
        status: 404,
        body: { message: 'role not found' },
      }),
    );

    await expect(
      call(
        'run_sql',
        { sql: 'SELECT 1', project_id: PROJECT_ID },
        PINNED_GRANT,
        client,
      ),
    ).rejects.toThrow('not found');

    // One attempt, as the pinned role, and no SQL.
    expect(requestedRoles(client)).toEqual([PINNED]);
    expect(client.getProjectBranchDatabase).not.toHaveBeenCalled();
    expect(querySpy).not.toHaveBeenCalled();
    expect(transactionSpy).not.toHaveBeenCalled();
  });

  it('fails closed when Postgres refuses the pinned login', async () => {
    const client = fakeNeonClient();
    querySpy.mockRejectedValueOnce(
      new Error(`password authentication failed for user "${PINNED}"`),
    );

    await expect(
      call(
        'run_sql',
        { sql: 'SELECT 1', project_id: PROJECT_ID },
        PINNED_GRANT,
        client,
      ),
    ).rejects.toThrow('password authentication failed');
    expect(requestedRoles(client)).toEqual([PINNED]);
  });

  it('keeps the read-only transaction for pinned run_sql and run_sql_transaction', async () => {
    const client = fakeNeonClient();
    await call(
      'run_sql',
      { sql: 'SELECT 1', project_id: PROJECT_ID },
      PINNED_GRANT,
      client,
      true,
    );
    await call(
      'run_sql_transaction',
      { sql_statements: ['SELECT 1', 'SELECT 2'], project_id: PROJECT_ID },
      PINNED_GRANT,
      client,
      true,
    );

    expect(transactionSpy).toHaveBeenCalledTimes(2);
    for (const [, options] of transactionSpy.mock.calls) {
      expect(options).toEqual({ readOnly: true });
    }
    expect(requestedRoles(client)).toEqual([PINNED, PINNED]);
  });

  it('takes the pin from the grant only, not from the caller-supplied extra', async () => {
    const client = fakeNeonClient();
    await invokeTool(
      'run_sql',
      { sql: 'SELECT 1', project_id: PROJECT_ID },
      PINNED_GRANT,
      client as unknown as Api<unknown>,
      { ...extra(false), pinnedRoleName: 'someone_else' },
    );
    expect(requestedRoles(client)).toEqual([PINNED]);
  });

  it.each(SQL_TOOL_CALLS.filter(([tool]) => tool !== 'get_connection_string'))(
    '%s returns no URI or password',
    async (tool, args) => {
      const client = fakeNeonClient();
      const result = await call(tool, args, PINNED_GRANT, client).catch(
        (error: unknown) =>
          handleToolError(error, {}, undefined, {
            clientName: 'test',
            clientApplication: 'unknown',
          }),
      );
      const text = resultText(result);
      expect(text).not.toContain(PASSWORD);
      expect(text).not.toMatch(/postgres(ql)?:\/\//);
    },
  );

  it('per-call role_name and compute_id reach the resolver without a pin', async () => {
    const client = fakeNeonClient();
    await call(
      'run_sql_transaction',
      {
        sql_statements: ['SELECT 1'],
        project_id: PROJECT_ID,
        role_name: 'restricted_writer',
        compute_id: 'ep-example-456',
      },
      UNPINNED_GRANT,
      client,
    );
    expect(client.getConnectionUri).toHaveBeenCalledWith(
      expect.objectContaining({
        role_name: 'restricted_writer',
        endpoint_id: 'ep-example-456',
      }),
    );
    expect(client.getProjectBranchDatabase).not.toHaveBeenCalled();
  });
});

describe('pinned role tool surface', () => {
  it('withholds get_connection_string on a pinned connection', () => {
    const pinned = getAvailableTools(PINNED_GRANT, false).map((t) => t.name);
    const unpinned = getAvailableTools(UNPINNED_GRANT, false).map(
      (t) => t.name,
    );
    expect(unpinned).toContain('get_connection_string');
    expect(pinned).not.toContain('get_connection_string');
    expect(pinned).toContain('run_sql');
    expect(pinned).toContain('prepare_database_migration');
  });

  it('tells the client which role SQL runs as', () => {
    const notices = getAccessControlNotices(PINNED_GRANT, true);
    expect(notices.some((notice) => notice.includes(`"${PINNED}"`))).toBe(true);
    expect(
      getAccessControlNotices(UNPINNED_GRANT, true).some((notice) =>
        notice.includes('pinned'),
      ),
    ).toBe(false);
  });
});
