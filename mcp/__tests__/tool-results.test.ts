/**
 * How `@neon/tools` results reach MCP content, and the arguments
 * `get_connection_string` keeps at the MCP boundary. The Neon API and the SQL
 * endpoint are answered by a stubbed `fetch`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { createNeonClient } from '../server/api';
import { NEON_HANDLERS } from '../tools/tools';
import type { ToolHandlerExtraParams } from '../tools/types';
import {
  connectionUriFor,
  stubFakeNeon,
  type FakeNeon,
} from './helpers/fake-neon';
import { jsonContent, textContent } from './helpers/tool-result';

const PROJECT_ID = 'example-project-123';
const BRANCH_ID = 'br-example-123';
const DATABASE = 'app_db';
const OWNER = 'app_db_owner';
const API_KEY = 'napi_test';

const TARGET = {
  project_id: PROJECT_ID,
  branch_id: BRANCH_ID,
  database_name: DATABASE,
};

const extra: ToolHandlerExtraParams = {
  account: { id: 'user-1', name: 'Test' },
  clientApplication: 'unknown',
  apiKey: API_KEY,
};

function rowsFor(sql: string) {
  const count = Number(/^SELECT (\d+) ROWS/.exec(sql)?.[1] ?? '1');
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    password: `hash-${index + 1}`,
  }));
}

let neon: FakeNeon;

beforeEach(() => {
  neon = stubFakeNeon({
    projectId: PROJECT_ID,
    branchId: BRANCH_ID,
    database: DATABASE,
    owner: OWNER,
    rows: rowsFor,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function call(name: string, params: Record<string, unknown>) {
  const handler = NEON_HANDLERS[name];
  if (!handler) throw new Error(`No handler for ${name}`);
  return handler({ params }, createNeonClient(API_KEY), extra);
}

describe('run_sql content', () => {
  it('returns the bare rows when they fit', async () => {
    const result = await call('run_sql', {
      ...TARGET,
      sql: 'SELECT 2 ROWS',
    });

    expect(result.content).toHaveLength(1);
    expect(jsonContent(result)).toEqual([
      { id: 1, password: 'hash-1' },
      { id: 2, password: 'hash-2' },
    ]);
  });

  it('adds a summary block when the rows were cut at max_rows', async () => {
    const result = await call('run_sql', {
      ...TARGET,
      sql: 'SELECT 3 ROWS',
      max_rows: 2,
    });

    expect(result.content).toHaveLength(2);
    expect(jsonContent(result, 0)).toEqual([
      { id: 1, password: 'hash-1' },
      { id: 2, password: 'hash-2' },
    ]);
    expect(jsonContent(result, 1)).toEqual({
      totalRowCount: 3,
      truncated: true,
      note: expect.stringContaining('Showing the first 2 of 3 rows.'),
    });
  });
});

describe('run_sql_transaction content', () => {
  it('returns one row array per statement when every statement fits', async () => {
    const result = await call('run_sql_transaction', {
      ...TARGET,
      sql_statements: ['SELECT 1 ROWS', 'SELECT 2 ROWS'],
    });

    expect(result.content).toHaveLength(1);
    expect(jsonContent(result)).toEqual([
      [{ id: 1, password: 'hash-1' }],
      [
        { id: 1, password: 'hash-1' },
        { id: 2, password: 'hash-2' },
      ],
    ]);
  });

  it('summarizes every statement when one was cut', async () => {
    const result = await call('run_sql_transaction', {
      ...TARGET,
      sql_statements: ['SELECT 1 ROWS', 'SELECT 3 ROWS'],
      max_rows: 2,
    });

    expect(result.content).toHaveLength(2);
    expect(jsonContent(result, 1)).toEqual([
      { totalRowCount: 1, truncated: false },
      {
        totalRowCount: 3,
        truncated: true,
        note: expect.stringContaining('Showing the first 2 of 3 rows.'),
      },
    ]);
  });
});

describe('get_connection_string', () => {
  it('sends compute_id as endpoint_id and asks for the pooled URI', async () => {
    await call('get_connection_string', {
      ...TARGET,
      compute_id: 'ep-example-456',
    });

    const [request] = neon.connectionUriRequests();
    expect(request?.search.get('endpoint_id')).toBe('ep-example-456');
    expect(request?.search.get('pooled')).toBe('true');
    expect(request?.search.get('role_name')).toBe(OWNER);
  });

  it('renders the connection details with the database and role from the URI', async () => {
    const result = await call('get_connection_string', {
      ...TARGET,
      compute_id: 'ep-example-456',
    });

    expect(result.content).toEqual([
      {
        type: 'text',
        text: [
          'Connection string details:',
          `URI: ${connectionUriFor(OWNER, DATABASE)}`,
          `Project ID: ${PROJECT_ID}`,
          `Database: ${DATABASE}`,
          `Role: ${OWNER}`,
          `Branch ID: ${BRANCH_ID}`,
          'Compute ID: ep-example-456',
          '',
          'You can use this connection string with any PostgreSQL client to connect to your Neon database.',
        ].join('\n'),
      },
    ]);
  });

  it('says it used the default branch and compute when neither was passed', async () => {
    const text = textContent(
      await call('get_connection_string', { project_id: PROJECT_ID }),
    );

    expect(text).toContain(`Database: ${DATABASE}`);
    expect(text).toContain(`Role: ${OWNER}`);
    expect(text).toContain('Using default branch');
    expect(text).toContain('Using default compute');
  });

  it.each([{ endpoint_id: 'ep-example-456' }, { pooled: true }])(
    'rejects %o, which it never accepted',
    async (argument) => {
      await expect(
        call('get_connection_string', { ...TARGET, ...argument }),
      ).rejects.toThrow(ZodError);
      expect(neon.api).toEqual([]);
    },
  );
});

describe('complete_database_migration content', () => {
  const MIGRATION = {
    migration_id: 'migration-1',
    migration_sql: 'SELECT 1 ROWS',
    database_name: DATABASE,
    project_id: PROJECT_ID,
    temporary_branch_id: 'br-temporary-123',
    parent_branch_id: BRANCH_ID,
  };
  const RESULT = JSON.stringify([[{ id: 1, password: 'hash-1' }]], null, 2);
  const CLEANUP_WARNING =
    '⚠️ Warning: Failed to delete temporary branch. Manual cleanup may be required. Error: branch is protected';

  function failDelete() {
    neon = stubFakeNeon({
      projectId: PROJECT_ID,
      branchId: BRANCH_ID,
      database: DATABASE,
      owner: OWNER,
      rows: rowsFor,
      deleteBranch: () =>
        Response.json({ message: 'branch is protected' }, { status: 409 }),
    });
  }

  it('reports an applied migration and the deleted branch', async () => {
    const text = textContent(
      await call('complete_database_migration', MIGRATION),
    );
    expect(text).toBe(
      `Migration applied successfully to parent branch. Temporary branch br-temporary-123 deleted.\n\nResult: ${RESULT}`,
    );
  });

  it('warns when an applied migration left the temporary branch', async () => {
    failDelete();
    const text = textContent(
      await call('complete_database_migration', MIGRATION),
    );
    expect(text).toBe(
      `Migration applied successfully to parent branch.\n\n${CLEANUP_WARNING}\n\nResult: ${RESULT}`,
    );
  });

  it('reports a cancelled migration and the deleted branch', async () => {
    const text = textContent(
      await call('complete_database_migration', {
        ...MIGRATION,
        apply_changes: false,
      }),
    );
    expect(text).toBe(
      'Migration cancelled. Temporary branch br-temporary-123 deleted without applying changes.',
    );
    expect(neon.sql).toEqual([]);
  });

  it('warns when a cancelled migration left the temporary branch', async () => {
    failDelete();
    const text = textContent(
      await call('complete_database_migration', {
        ...MIGRATION,
        apply_changes: false,
      }),
    );
    expect(text).toBe(`Migration cancelled.\n\n${CLEANUP_WARNING}`);
  });
});

describe('complete_query_tuning errors', () => {
  it('reports a failed completion as a server error with the completion prefix', async () => {
    neon = stubFakeNeon({
      projectId: PROJECT_ID,
      branchId: BRANCH_ID,
      database: DATABASE,
      owner: OWNER,
      rows: rowsFor,
      deleteBranch: () =>
        Response.json({ message: 'branch is protected' }, { status: 409 }),
    });

    const failure = call('complete_query_tuning', {
      suggested_sql_statements: [],
      tuning_id: 'tuning-123',
      database_name: DATABASE,
      project_id: PROJECT_ID,
      temporary_branch_id: 'br-temporary-123',
      should_delete_temporary_branch: true,
    });

    await expect(failure).rejects.toThrow(
      /^Failed to complete query tuning: .*branch is protected/,
    );
    await expect(failure).rejects.not.toHaveProperty('status');
  });
});
