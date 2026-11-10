/**
 * A grant can pin the Postgres role that every SQL connection logs in as
 * (`?roleName=`). `invokeTool`, the path both servers use, hands the pin to
 * `@neon/tools` as `postgresRole`, so these tests drive real tool handlers and
 * check which role the Neon API was asked for and which role the SQL ran as.
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNeonClient } from '../server/api';
import { handleToolError } from '../server/errors';
import { invokeTool } from '../tools/registration';
import {
  getAccessControlNotices,
  getAvailableTools,
} from '../tools/grant-filter';
import type { ToolHandlerExtraParams } from '../tools/types';
import type { GrantContext } from '../utils/grant-context';
import {
  connectionUriFor,
  FAKE_PASSWORD,
  stubFakeNeon,
  type FakeNeon,
  type FakeNeonOptions,
} from './helpers/fake-neon';

const PROJECT_ID = 'example-project-123';
const BRANCH_ID = 'br-example-123';
const DATABASE = 'app_db';
const OWNER = 'app_db_owner';
const PINNED = 'mcp_pinned_reader';
const API_KEY = 'napi_test';

// One row shaped to satisfy every tool's precondition queries (table exists,
// extension installed), so each tool reaches its connection.
const FAKE: FakeNeonOptions = {
  projectId: PROJECT_ID,
  branchId: BRANCH_ID,
  database: DATABASE,
  owner: OWNER,
  rows: () => [
    {
      session_user: PINNED,
      relation_name: 'public.t',
      extension_exists: true,
    },
  ],
};

const PINNED_GRANT: GrantContext = {
  projectId: null,
  scopes: null,
  roleName: PINNED,
};
const UNPINNED_GRANT: GrantContext = { projectId: null, scopes: null };

let neon: FakeNeon;

beforeEach(() => {
  neon = stubFakeNeon(FAKE);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function extra(readOnly: boolean): ToolHandlerExtraParams {
  return {
    readOnly,
    account: { id: 'user-1', name: 'Test' },
    clientApplication: 'unknown',
    apiKey: API_KEY,
    signal: new AbortController().signal,
  };
}

async function call(
  tool: string,
  args: Record<string, unknown>,
  grant: GrantContext,
  readOnly = false,
) {
  return invokeTool(
    tool,
    args,
    grant,
    createNeonClient(API_KEY),
    extra(readOnly),
  );
}

// The tool result, or the error response the server would send.
async function settle(
  result: Promise<CallToolResult>,
): Promise<CallToolResult> {
  return result.catch((error: unknown) =>
    handleToolError(error, {}, undefined, {
      clientName: 'test',
      clientApplication: 'unknown',
    }),
  );
}

function resultText(result: CallToolResult): string {
  return JSON.stringify(result.content);
}

// Every tool that opens a Postgres connection, with arguments that let it
// reach that connection.
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

describe('pinned Postgres role', () => {
  it.each(SQL_TOOL_CALLS)(
    '%s connects as the pinned role and never looks up the owner',
    async (tool, args) => {
      await settle(call(tool, args, PINNED_GRANT));

      expect(neon.connectionUriRequests().length).toBeGreaterThan(0);
      expect(new Set(neon.requestedRoles())).toEqual(new Set([PINNED]));
      expect(neon.ownerLookups()).toEqual([]);
      for (const request of neon.sql) {
        expect(request.role).toBe(PINNED);
      }
    },
  );

  it.each(SQL_TOOL_CALLS)(
    '%s still connects as the database owner without a pin',
    async (tool, args) => {
      await settle(call(tool, args, UNPINNED_GRANT));

      expect(new Set(neon.requestedRoles())).toEqual(new Set([OWNER]));
    },
  );

  it('accepts a role_name equal to the pinned role', async () => {
    const result = await call(
      'run_sql',
      { sql: 'SELECT 1', project_id: PROJECT_ID, role_name: PINNED },
      PINNED_GRANT,
    );
    expect(result.isError).not.toBe(true);
    expect(neon.requestedRoles()).toEqual([PINNED]);
  });

  it.each(['run_sql', 'run_sql_transaction'])(
    '%s rejects a role_name that differs from the pinned role before connecting',
    async (tool) => {
      const args =
        tool === 'run_sql'
          ? { sql: 'SELECT 1', project_id: PROJECT_ID, role_name: OWNER }
          : {
              sql_statements: ['SELECT 1'],
              project_id: PROJECT_ID,
              role_name: OWNER,
            };

      const error = await call(tool, args, PINNED_GRANT).catch(
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(Error);
      expect(error).toHaveProperty('name', 'NeonClientError');
      expect(error).toHaveProperty('message', expect.stringContaining(PINNED));
      expect(neon.connectionUriRequests()).toEqual([]);
      expect(neon.sql).toEqual([]);

      const response = await settle(Promise.reject(error));
      expect(response.isError).toBe(true);
      expect(resultText(response)).not.toContain(FAKE_PASSWORD);
      expect(resultText(response)).not.toMatch(/postgres(ql)?:\/\//);
    },
  );

  it.each(['read_only', 'read_write'])(
    'create_postgres_role refuses access %s on a pinned connection, whose SQL would run as the owner',
    async (access) => {
      const error = await call(
        'create_postgres_role',
        {
          project_id: PROJECT_ID,
          branch_id: BRANCH_ID,
          name: 'app_reader',
          access,
        },
        PINNED_GRANT,
      ).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(Error);
      expect(error).toHaveProperty('name', 'InvalidArgumentError');
      expect(error).toHaveProperty('message', expect.stringContaining(PINNED));
      expect(error).toHaveProperty('message', expect.stringContaining(access));
      expect(neon.api).toEqual([]);
    },
  );

  it('fails closed when Neon cannot resolve the pinned role', async () => {
    neon = stubFakeNeon({
      ...FAKE,
      connectionUri: () =>
        Response.json({ message: 'role not found' }, { status: 404 }),
    });

    await expect(
      call(
        'run_sql',
        { sql: 'SELECT 1', project_id: PROJECT_ID },
        PINNED_GRANT,
      ),
    ).rejects.toThrow('role not found');

    // One attempt, as the pinned role, and no SQL.
    expect(neon.requestedRoles()).toEqual([PINNED]);
    expect(neon.ownerLookups()).toEqual([]);
    expect(neon.sql).toEqual([]);
  });

  it('fails closed when Postgres refuses the pinned login', async () => {
    neon = stubFakeNeon({
      ...FAKE,
      sqlResponse: () =>
        Response.json(
          {
            message: `password authentication failed for user "${PINNED}"`,
            code: '28P01',
          },
          { status: 400 },
        ),
    });

    await expect(
      call(
        'run_sql',
        { sql: 'SELECT 1', project_id: PROJECT_ID },
        PINNED_GRANT,
      ),
    ).rejects.toThrow('password authentication failed');
    expect(neon.requestedRoles()).toEqual([PINNED]);
  });

  it('runs pinned read-only run_sql in a READ ONLY transaction', async () => {
    await call(
      'run_sql',
      { sql: 'SELECT 1', project_id: PROJECT_ID },
      PINNED_GRANT,
      true,
    );

    expect(neon.sql).toEqual([
      expect.objectContaining({
        role: PINNED,
        transaction: true,
        readOnly: true,
        queries: ['SELECT 1'],
      }),
    ]);
  });

  it('refuses run_sql_transaction in read-only mode before connecting', async () => {
    // Read-only servers never register the tool; the package refuses as well.
    await expect(
      call(
        'run_sql_transaction',
        { sql_statements: ['COMMIT', 'DROP TABLE t'], project_id: PROJECT_ID },
        PINNED_GRANT,
        true,
      ),
    ).rejects.toThrow('unavailable in read-only mode');
    expect(neon.api).toEqual([]);
    expect(neon.sql).toEqual([]);
  });

  it('takes the pin from the grant only, not from the caller-supplied extra', async () => {
    await invokeTool(
      'run_sql',
      { sql: 'SELECT 1', project_id: PROJECT_ID },
      PINNED_GRANT,
      createNeonClient(API_KEY),
      { ...extra(false), pinnedRoleName: 'someone_else' },
    );
    expect(neon.requestedRoles()).toEqual([PINNED]);

    neon = stubFakeNeon(FAKE);
    await invokeTool(
      'run_sql',
      { sql: 'SELECT 1', project_id: PROJECT_ID },
      UNPINNED_GRANT,
      createNeonClient(API_KEY),
      { ...extra(false), pinnedRoleName: 'someone_else' },
    );
    expect(neon.requestedRoles()).toEqual([OWNER]);
  });

  it.each(SQL_TOOL_CALLS.filter(([tool]) => tool !== 'get_connection_string'))(
    '%s returns no URI or password',
    async (tool, args) => {
      const text = resultText(await settle(call(tool, args, PINNED_GRANT)));
      expect(text).not.toContain(FAKE_PASSWORD);
      expect(text).not.toMatch(/postgres(ql)?:\/\//);
    },
  );

  it('get_connection_string on a pinned grant returns the pinned role URI', async () => {
    const result = await call(
      'get_connection_string',
      { project_id: PROJECT_ID, database_name: DATABASE },
      PINNED_GRANT,
    );
    expect(resultText(result)).toContain(connectionUriFor(PINNED, DATABASE));
  });

  it('per-call role_name and compute_id reach the resolver without a pin', async () => {
    await call(
      'run_sql_transaction',
      {
        sql_statements: ['SELECT 1'],
        project_id: PROJECT_ID,
        role_name: 'restricted_writer',
        compute_id: 'ep-example-456',
      },
      UNPINNED_GRANT,
    );
    const [request] = neon.connectionUriRequests();
    expect(request?.search.get('role_name')).toBe('restricted_writer');
    expect(request?.search.get('endpoint_id')).toBe('ep-example-456');
    expect(neon.ownerLookups()).toEqual([]);
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
