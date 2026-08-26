import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { config as loadEnv } from 'dotenv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { neon } from '@neondatabase/serverless';
import { z } from 'zod';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { NeonApiClient } from '../../neon-client';
import {
  INSPECT_CHECKS,
  INSPECT_QUERIES,
  type InspectCheck,
} from '../../inspect/queries';

loadEnv({ path: '.env.test', quiet: true });

// Live tests should not emit product analytics or Sentry events.
process.env.ANALYTICS_WRITE_KEY = '';
process.env.SENTRY_DSN = '';

const PROJECT_PREFIX = 'smoke-mcp-live';
const LIVE_TEST_TIMEOUT_MS = 120_000;
const OTHER_DATABASE = 'mcp_scope_other';
const DEFAULT_LOCK_TABLE = 'mcp_scope_default_lock';
const OTHER_LOCK_TABLE = 'mcp_scope_other_lock';
const DEFAULT_LOCK_MARKER = 'mcp_scope_default_session';
const OTHER_LOCK_MARKER = 'mcp_scope_other_session';
const LOCK_HOLD_SECONDS = 15;

const toolResultSchema = z.object({
  content: z.array(z.unknown()),
  isError: z.boolean().optional(),
});

const textContentSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
});

const tableDescriptionSchema = z.object({
  raw: z.object({
    columns: z.array(z.object({ name: z.string() })),
    indexes: z.array(
      z.object({
        name: z.string(),
        definition: z.string(),
        size: z.string(),
      }),
    ),
    constraints: z.array(
      z.object({
        name: z.string(),
        type: z.string(),
        definition: z.string(),
      }),
    ),
    tableSize: z.string(),
    indexSize: z.string(),
    totalSize: z.string(),
  }),
  formatted: z.string(),
});

const inspectResultSchema = z.object({
  check: z.enum(INSPECT_CHECKS),
  describe: z.string(),
  projectId: z.string(),
  branchId: z.string(),
  databaseName: z.string().optional(),
  databases: z.array(z.string()),
  fields: z.array(z.string()),
  totalRowCount: z.number(),
  rows: z.array(z.record(z.string(), z.unknown())),
  truncated: z.boolean(),
  note: z.string().optional(),
});

const lockResultSchema = inspectResultSchema.extend({
  check: z.literal('locks'),
  rows: z.array(
    z.object({
      database: z.string().optional(),
      relname: z.string().nullable(),
      locktype: z.string(),
      query: z.string(),
    }),
  ),
});

/**
 * A check whose SQL carries its own `LIMIT` must say so once it reaches that
 * ceiling, otherwise a capped result reads as the complete one.
 */
function expectSqlCapDisclosed(
  check: InspectCheck,
  report: z.infer<typeof inspectResultSchema>,
) {
  const { sqlLimit } = INSPECT_QUERIES[check];
  if (sqlLimit === undefined || report.totalRowCount !== sqlLimit) return;
  expect(report.note).toContain(`at most ${sqlLimit} rows`);
}

function requireApiKey(): string {
  const name = 'NEON_API_KEY';
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `${name} is required. Copy .env.test.example to the repository-local .env.test.`,
    );
  }
  return value;
}

function textContent(result: unknown): string {
  const parsedResult = toolResultSchema.parse(result);
  for (const item of parsedResult.content) {
    const parsedContent = textContentSchema.safeParse(item);
    if (parsedContent.success) return parsedContent.data.text;
  }
  throw new Error('Expected the MCP tool to return text content.');
}

function assertToolSucceeded(toolName: string, result: unknown): string {
  const parsedResult = toolResultSchema.parse(result);
  const text = textContent(result);
  if (parsedResult.isError) {
    throw new Error(`${toolName} failed: ${text}`);
  }
  return text;
}

function holdTableLock(uri: string, table: string, marker: string) {
  const sql = neon(uri);
  return sql.transaction([
    sql.query(`LOCK TABLE ${table} IN ACCESS EXCLUSIVE MODE`),
    sql.query('SELECT pg_current_xact_id()'),
    sql.query(`SELECT pg_sleep(${LOCK_HOLD_SECONDS}) /* ${marker} */`),
  ]);
}

describe.sequential('MCP server live Neon lifecycle', () => {
  let client: Client | undefined;
  let server: McpServer | undefined;
  let neonClient: NeonApiClient | undefined;
  let testOrgId = '';
  let projectId: string | undefined;
  const projectName = `${PROJECT_PREFIX}-${Date.now()}-${randomUUID().slice(0, 8)}`;

  async function callTool(
    name: string,
    params: Record<string, unknown>,
  ): Promise<Awaited<ReturnType<Client['callTool']>>> {
    if (!client) throw new Error('MCP client is not connected.');
    return client.callTool({
      name,
      arguments: params,
    });
  }

  async function inspectLocks(databaseName: string) {
    if (!projectId) throw new Error('Test project was not created.');
    const result = await callTool('inspect_database', {
      project_id: projectId,
      database_name: databaseName,
      check: 'locks',
    });
    return lockResultSchema.parse(
      JSON.parse(
        assertToolSucceeded(`inspect_database/locks/${databaseName}`, result),
      ),
    );
  }

  async function waitForLockReports() {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const reports = await Promise.all([
        inspectLocks('neondb'),
        inspectLocks(OTHER_DATABASE),
      ]);
      const [fromDefault, fromOther] = reports;
      const defaultReady = fromDefault.rows.some((row) =>
        row.query.includes(DEFAULT_LOCK_MARKER),
      );
      const otherReady = fromOther.rows.some((row) =>
        row.query.includes(OTHER_LOCK_MARKER),
      );
      if (defaultReady && otherReady) return reports;
      await delay(250);
    }
    throw new Error('Both database lock holders did not become visible.');
  }

  async function findProject(id: string) {
    if (!neonClient) throw new Error('Neon SDK client is not initialized.');
    const response = await neonClient.listProjects({
      org_id: testOrgId,
      search: id,
    });
    return response.data.projects.find((project) => project.id === id);
  }

  async function findProjectByName() {
    if (!neonClient) throw new Error('Neon SDK client is not initialized.');
    const response = await neonClient.listProjects({
      org_id: testOrgId,
      search: projectName,
    });
    return response.data.projects.find(
      (project) => project.name === projectName,
    );
  }

  async function waitForProjectDeletion(id: string): Promise<void> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (!(await findProject(id))) return;
      await delay(500);
    }
    throw new Error(`Project ${id} still exists after deletion.`);
  }

  beforeAll(async () => {
    const apiKey = requireApiKey();
    const configuredTestOrgId = process.env.NEON_TEST_ORG_ID?.trim();

    const [{ createMcpServer }, { createNeonClient }] = await Promise.all([
      import('../../server/index'),
      import('../../neon-client'),
    ]);

    neonClient = createNeonClient(apiKey);
    const authDetails = (await neonClient.getAuthDetails()).data;
    if (configuredTestOrgId) {
      if (
        authDetails.auth_method === 'api_key_org' &&
        authDetails.account_id !== configuredTestOrgId
      ) {
        throw new Error(
          'NEON_TEST_ORG_ID does not match the organization-scoped API key account.',
        );
      }
      testOrgId = configuredTestOrgId;
    } else if (authDetails.auth_method === 'api_key_org') {
      testOrgId = authDetails.account_id;
    } else {
      throw new Error(
        'NEON_TEST_ORG_ID is required unless NEON_API_KEY is organization-scoped.',
      );
    }
    await neonClient.getOrganization(testOrgId);

    server = await createMcpServer({
      apiKey,
      authMethod: authDetails.auth_method,
      account: {
        id: testOrgId,
        name: 'MCP live E2E test organization',
        email: 'mcp-live-e2e@localhost',
        isOrg: true,
      },
      app: {
        name: 'mcp-server-neon',
        transport: 'stream',
        environment: 'development',
        version: 'live-e2e',
      },
      userAgent: 'mcp-server-neon-live-e2e',
    });

    client = new Client({
      name: 'mcp-server-neon-live-e2e',
      version: '1.0.0',
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  }, LIVE_TEST_TIMEOUT_MS);

  afterAll(async () => {
    try {
      if (neonClient) {
        const project = projectId
          ? await findProject(projectId)
          : await findProjectByName();
        if (project) {
          if (!project.name.startsWith(`${PROJECT_PREFIX}-`)) {
            throw new Error(
              `Refusing to delete project without ${PROJECT_PREFIX}- prefix: ${project.name}`,
            );
          }
          await neonClient.deleteProject(project.id);
          await waitForProjectDeletion(project.id);
        }
      }
    } finally {
      await client?.close();
      await server?.close();
    }
  }, LIVE_TEST_TIMEOUT_MS);

  it(
    'creates a prefixed project through the MCP protocol and verifies it with @neon/sdk',
    async () => {
      const result = await callTool('create_project', {
        name: projectName,
        org_id: testOrgId,
      });
      const text = assertToolSucceeded('create_project', result);
      const created = z
        .object({ project: z.object({ id: z.string() }) })
        .parse(JSON.parse(text));
      projectId = created.project.id;

      if (!neonClient) throw new Error('Neon SDK client is not initialized.');
      const response = await neonClient.getProject(projectId);
      expect(response.data.project.name).toBe(projectName);
    },
    LIVE_TEST_TIMEOUT_MS,
  );

  it(
    'creates same-named public and CRM tables in the real database',
    async () => {
      if (!projectId) throw new Error('Test project was not created.');
      const result = await callTool('run_sql_transaction', {
        project_id: projectId,
        sql_statements: [
          'CREATE SCHEMA crm',
          'CREATE TABLE public.property_options (public_marker text)',
          'CREATE TABLE crm.property_options (id bigint PRIMARY KEY, property_id bigint NOT NULL, option_value text NOT NULL, CONSTRAINT property_options_unique UNIQUE (property_id, option_value))',
          'CREATE INDEX property_options_value_idx ON crm.property_options (option_value)',
        ],
      });
      assertToolSucceeded('run_sql_transaction', result);
    },
    LIVE_TEST_TIMEOUT_MS,
  );

  it(
    'compares a child branch schema, then resets it from parent',
    async () => {
      if (!projectId) throw new Error('Test project was not created.');
      // create_branch does not return a connection URI. Keep this ahead of
      // CREATE DATABASE mcp_scope_other so later SQL still has one database.
      const table = `mcp_reset_${randomUUID().slice(0, 8)}`;
      const created = await callTool('create_branch', {
        project_id: projectId,
        name: `mcp-reset-${randomUUID().slice(0, 8)}`,
      });
      const branch = z
        .object({ branch: z.object({ id: z.string() }) })
        .parse(JSON.parse(assertToolSucceeded('create_branch', created)));
      const branchId = branch.branch.id;

      const matching = z
        .object({ diff: z.string().nullable().optional() })
        .parse(
          JSON.parse(
            assertToolSucceeded(
              'compare_database_schema',
              await callTool('compare_database_schema', {
                project_id: projectId,
                branch_id: branchId,
                database_name: 'neondb',
              }),
            ),
          ),
        );
      expect(matching.diff ?? '').toBe('');

      assertToolSucceeded(
        'run_sql',
        await callTool('run_sql', {
          project_id: projectId,
          branch_id: branchId,
          sql: `CREATE TABLE ${table} (id int)`,
        }),
      );

      const diverged = z
        .object({ diff: z.string().nullable().optional() })
        .parse(
          JSON.parse(
            assertToolSucceeded(
              'compare_database_schema',
              await callTool('compare_database_schema', {
                project_id: projectId,
                branch_id: branchId,
                database_name: 'neondb',
              }),
            ),
          ),
        );
      expect(diverged.diff ?? '').toContain(table);

      assertToolSucceeded(
        'reset_from_parent',
        await callTool('reset_from_parent', {
          project_id: projectId,
          branch_id: branchId,
        }),
      );

      const after = z.object({ diff: z.string().nullable().optional() }).parse(
        JSON.parse(
          assertToolSucceeded(
            'compare_database_schema',
            await callTool('compare_database_schema', {
              project_id: projectId,
              branch_id: branchId,
              database_name: 'neondb',
            }),
          ),
        ),
      );
      expect(after.diff ?? '').toBe('');

      assertToolSucceeded(
        'delete_branch',
        await callTool('delete_branch', {
          project_id: projectId,
          branch_id: branchId,
        }),
      );
    },
    LIVE_TEST_TIMEOUT_MS,
  );

  it(
    'preserves default public-schema describe behavior',
    async () => {
      if (!projectId) throw new Error('Test project was not created.');
      const result = await callTool('describe_table_schema', {
        project_id: projectId,
        table_name: 'property_options',
      });
      const description = tableDescriptionSchema.parse(
        JSON.parse(assertToolSucceeded('describe_table_schema', result)),
      );

      expect(description.raw.columns.map((column) => column.name)).toEqual([
        'public_marker',
      ]);
      expect(description.raw.indexes).toEqual([]);
      expect(description.raw.constraints).toEqual([]);
      expect(description.raw.totalSize).not.toBe('');
    },
    LIVE_TEST_TIMEOUT_MS,
  );

  it(
    'describes a schema-qualified table without leaking the public table',
    async () => {
      if (!projectId) throw new Error('Test project was not created.');
      const result = await callTool('describe_table_schema', {
        project_id: projectId,
        table_name: 'crm.property_options',
      });
      const description = tableDescriptionSchema.parse(
        JSON.parse(assertToolSucceeded('describe_table_schema', result)),
      );

      expect(description.raw.columns.map((column) => column.name)).toEqual([
        'id',
        'property_id',
        'option_value',
      ]);
      expect(
        description.raw.columns.map((column) => column.name),
      ).not.toContain('public_marker');
      expect(description.raw.indexes.map((index) => index.name)).toEqual(
        expect.arrayContaining([
          'property_options_pkey',
          'property_options_unique',
          'property_options_value_idx',
        ]),
      );
      expect(
        description.raw.constraints.map((constraint) => constraint.name),
      ).toEqual(
        expect.arrayContaining([
          'property_options_pkey',
          'property_options_unique',
        ]),
      );
      expect(description.raw.indexes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'property_options_value_idx',
            definition: expect.stringContaining('crm.property_options'),
          }),
        ]),
      );
      expect(description.raw.totalSize).not.toBe('');
    },
    LIVE_TEST_TIMEOUT_MS,
  );

  it(
    'returns a clean not-found error for a missing qualified table',
    async () => {
      if (!projectId) throw new Error('Test project was not created.');
      const result = await callTool('describe_table_schema', {
        project_id: projectId,
        table_name: 'crm.missing_property_options',
      });
      const parsedResult = toolResultSchema.parse(result);
      const text = textContent(result);

      expect(parsedResult.isError).toBe(true);
      expect(text).toContain(
        'NotFoundError: Table not found: crm.missing_property_options',
      );
      expect(text).not.toContain('relation');
    },
    LIVE_TEST_TIMEOUT_MS,
  );

  it(
    'adds a database column when databaseName is omitted on a one-database branch',
    async () => {
      if (!projectId) throw new Error('Test project was not created.');
      const report = inspectResultSchema.parse(
        JSON.parse(
          assertToolSucceeded(
            'inspect_database/table-sizes/omit-one',
            await callTool('inspect_database', {
              project_id: projectId,
              check: 'table-sizes',
            }),
          ),
        ),
      );

      expect(report.databaseName).toBeUndefined();
      expect(report.databases).toEqual(['neondb']);
      expect(report.fields).toEqual([
        'database',
        ...INSPECT_QUERIES['table-sizes'].fields,
      ]);
      expect(report.rows.map((row) => row.database)).toEqual(
        report.rows.map(() => 'neondb'),
      );
      expect(report.rows.map((row) => row.name)).toContain('property_options');
    },
    LIVE_TEST_TIMEOUT_MS,
  );

  it(
    'reports only locks held in the inspected database',
    async () => {
      if (!projectId) throw new Error('Test project was not created.');
      if (!neonClient) throw new Error('Neon SDK client is not initialized.');

      assertToolSucceeded(
        'run_sql/create-scope-database',
        await callTool('run_sql', {
          project_id: projectId,
          sql: `CREATE DATABASE ${OTHER_DATABASE}`,
        }),
      );
      assertToolSucceeded(
        'run_sql/create-default-lock-table',
        await callTool('run_sql', {
          project_id: projectId,
          sql: `CREATE TABLE ${DEFAULT_LOCK_TABLE} (id int)`,
        }),
      );
      assertToolSucceeded(
        'run_sql/create-other-lock-table',
        await callTool('run_sql', {
          project_id: projectId,
          database_name: OTHER_DATABASE,
          sql: `CREATE TABLE ${OTHER_LOCK_TABLE} (id int)`,
        }),
      );

      const [defaultConnection, otherConnection] = await Promise.all([
        neonClient.getConnectionUri({
          projectId,
          database_name: 'neondb',
        }),
        neonClient.getConnectionUri({
          projectId,
          database_name: OTHER_DATABASE,
        }),
      ]);
      const lockHolders = Promise.all([
        holdTableLock(
          defaultConnection.data.uri,
          DEFAULT_LOCK_TABLE,
          DEFAULT_LOCK_MARKER,
        ),
        holdTableLock(
          otherConnection.data.uri,
          OTHER_LOCK_TABLE,
          OTHER_LOCK_MARKER,
        ),
      ]);
      const lockHoldersFinishedEarly = lockHolders.then(() => {
        throw new Error('Lock holders finished before inspection completed.');
      });

      let reports: Awaited<ReturnType<typeof waitForLockReports>>;
      let fromAll: z.infer<typeof lockResultSchema> | undefined;
      try {
        reports = await Promise.race([
          waitForLockReports(),
          lockHoldersFinishedEarly,
        ]);
        fromAll = await Promise.race([
          lockResultSchema.parseAsync(
            JSON.parse(
              assertToolSucceeded(
                'inspect_database/locks/omit',
                await callTool('inspect_database', {
                  project_id: projectId,
                  check: 'locks',
                }),
              ),
            ),
          ),
          lockHoldersFinishedEarly,
        ]);
      } finally {
        await lockHolders;
      }

      const [fromDefault, fromOther] = reports;
      for (const [report, localMarker, foreignMarker, localTable] of [
        [
          fromDefault,
          DEFAULT_LOCK_MARKER,
          OTHER_LOCK_MARKER,
          DEFAULT_LOCK_TABLE,
        ],
        [fromOther, OTHER_LOCK_MARKER, DEFAULT_LOCK_MARKER, OTHER_LOCK_TABLE],
      ] as const) {
        const localRows = report.rows.filter((row) =>
          row.query.includes(localMarker),
        );
        expect(localRows.length).toBeGreaterThan(0);
        expect(
          report.rows.some((row) => row.query.includes(foreignMarker)),
        ).toBe(false);

        const relationRows = localRows.filter(
          (row) => row.locktype === 'relation',
        );
        expect(relationRows.map((row) => row.relname)).toContain(localTable);
        expect(relationRows.every((row) => row.relname !== null)).toBe(true);
        expect(localRows.map((row) => row.locktype)).toContain('transactionid');
      }

      if (!fromAll) {
        throw new Error('Omit lock report was not collected.');
      }
      expect(fromAll.databaseName).toBeUndefined();
      expect([...fromAll.databases].sort()).toEqual(
        ['neondb', OTHER_DATABASE].sort(),
      );
      expect(fromAll.fields[0]).toBe('database');
      expect(
        fromAll.rows.some((row) => row.query.includes(DEFAULT_LOCK_MARKER)),
      ).toBe(true);
      expect(
        fromAll.rows.some((row) => row.query.includes(OTHER_LOCK_MARKER)),
      ).toBe(true);
      expect(
        fromAll.rows
          .filter((row) => row.query.includes(DEFAULT_LOCK_MARKER))
          .every((row) => row.database === 'neondb'),
      ).toBe(true);
      expect(
        fromAll.rows
          .filter((row) => row.query.includes(OTHER_LOCK_MARKER))
          .every((row) => row.database === OTHER_DATABASE),
      ).toBe(true);
    },
    LIVE_TEST_TIMEOUT_MS,
  );

  it(
    'runs a compute-wide omit once against the first API-listed database',
    async () => {
      if (!projectId) throw new Error('Test project was not created.');
      if (!neonClient) throw new Error('Neon SDK client is not initialized.');

      const branches = await neonClient.listProjectBranches({ projectId });
      const defaultBranch = branches.data.branches.find(
        (branch) => branch.default,
      );
      if (!defaultBranch) {
        throw new Error('Default branch was not found.');
      }
      const listed = await neonClient.listProjectBranchDatabases(
        projectId,
        defaultBranch.id,
      );
      const first = listed.data.databases[0]?.name;
      if (!first) {
        throw new Error('Branch listed no databases.');
      }

      const report = inspectResultSchema.parse(
        JSON.parse(
          assertToolSucceeded(
            'inspect_database/replication-slots/omit',
            await callTool('inspect_database', {
              project_id: projectId,
              check: 'replication-slots',
            }),
          ),
        ),
      );

      expect(report.databaseName).toBeUndefined();
      expect(report.databases).toEqual([first]);
      expect(report.fields).toEqual(
        INSPECT_QUERIES['replication-slots'].fields,
      );
      expect(report.fields).not.toContain('database');
    },
    LIVE_TEST_TIMEOUT_MS,
  );

  it(
    'fails the whole omit run when a later database is missing an extension',
    async () => {
      if (!projectId) throw new Error('Test project was not created.');
      assertToolSucceeded(
        'run_sql/create-pg-stat-statements-other',
        await callTool('run_sql', {
          project_id: projectId,
          database_name: OTHER_DATABASE,
          sql: 'CREATE EXTENSION IF NOT EXISTS pg_stat_statements',
        }),
      );

      const result = await callTool('inspect_database', {
        project_id: projectId,
        check: 'outliers',
      });
      const parsedResult = toolResultSchema.parse(result);
      const text = textContent(result);

      expect(parsedResult.isError).toBe(true);
      expect(text).toContain('database "neondb"');
      expect(text).not.toContain('(database neondb)');
      expect(text).toContain(
        'Pass database_name to try a database that already has the "pg_stat_statements" extension.',
      );
      expect(text).toContain('ask the user first');
    },
    LIVE_TEST_TIMEOUT_MS,
  );

  it(
    'discloses both response truncation and a SQL-level row cap',
    async () => {
      if (!projectId) throw new Error('Test project was not created.');
      const tableNames = Array.from(
        { length: 26 },
        (_, index) => `mcp_cap_table_${index}`,
      );
      assertToolSucceeded(
        'run_sql_transaction/create-cap-tables',
        await callTool('run_sql_transaction', {
          project_id: projectId,
          sql_statements: tableNames.flatMap((tableName) => [
            `CREATE TABLE ${tableName} (value integer)`,
            `INSERT INTO ${tableName} VALUES (1)`,
            `ANALYZE ${tableName}`,
          ]),
        }),
      );

      const report = inspectResultSchema.parse(
        JSON.parse(
          assertToolSucceeded(
            'inspect_database/bloat',
            await callTool('inspect_database', {
              project_id: projectId,
              database_name: 'neondb',
              check: 'bloat',
              limit: 1,
            }),
          ),
        ),
      );
      expect(report.totalRowCount).toBe(INSPECT_QUERIES.bloat.sqlLimit);
      expect(report.rows).toHaveLength(1);
      expect(report.truncated).toBe(true);
      expect(report.note).toContain('Showing the first 1 of 25 rows');
      expect(report.note).toContain('returns at most 25 rows');
    },
    LIVE_TEST_TIMEOUT_MS,
  );

  it(
    'reports the missing extension before it is installed',
    async () => {
      if (!projectId) throw new Error('Test project was not created.');
      const extensionChecks = INSPECT_CHECKS.filter(
        (check) => INSPECT_QUERIES[check].requiresExtension,
      );
      expect(extensionChecks.length).toBeGreaterThan(0);

      for (const check of extensionChecks) {
        const result = await callTool('inspect_database', {
          project_id: projectId,
          database_name: 'neondb',
          check,
        });
        const parsedResult = toolResultSchema.parse(result);
        const text = textContent(result);

        expect(parsedResult.isError).toBe(true);
        expect(text).toContain(
          `CREATE EXTENSION IF NOT EXISTS ${INSPECT_QUERIES[check].requiresExtension};`,
        );
        // Installing an extension writes to the user's database, so the error
        // must not read as something to do unattended.
        expect(text).toContain('ask the user first');
      }
    },
    LIVE_TEST_TIMEOUT_MS,
  );

  it(
    'runs every check that needs no extension against the real database',
    async () => {
      if (!projectId) throw new Error('Test project was not created.');
      for (const check of INSPECT_CHECKS.filter(
        (candidate) => !INSPECT_QUERIES[candidate].requiresExtension,
      )) {
        const result = await callTool('inspect_database', {
          project_id: projectId,
          database_name: 'neondb',
          check,
        });
        const report = inspectResultSchema.parse(
          JSON.parse(assertToolSucceeded(`inspect_database/${check}`, result)),
        );

        expect(report.check).toBe(check);
        expect(report.databaseName).toBe('neondb');
        expect(report.databases).toEqual(['neondb']);
        expect(report.fields).toEqual(INSPECT_QUERIES[check].fields);
        expect(report.totalRowCount).toBe(report.rows.length);
        expect(report.truncated).toBe(false);
        // Every returned row must use the declared columns, so the model can
        // rely on `fields` for ordering.
        for (const row of report.rows) {
          expect(Object.keys(row).sort()).toEqual([...report.fields].sort());
        }
        if (report.totalRowCount === 0) {
          expect(report.note).toBe(INSPECT_QUERIES[check].emptyMessage);
        }
        expectSqlCapDisclosed(check, report);
      }
    },
    LIVE_TEST_TIMEOUT_MS,
  );

  it(
    'sees the tables it created and truncates to the requested limit',
    async () => {
      if (!projectId) throw new Error('Test project was not created.');
      const full = inspectResultSchema.parse(
        JSON.parse(
          assertToolSucceeded(
            'inspect_database',
            await callTool('inspect_database', {
              project_id: projectId,
              database_name: 'neondb',
              check: 'table-sizes',
            }),
          ),
        ),
      );
      expect(full.totalRowCount).toBeGreaterThanOrEqual(2);
      expect(full.rows.map((row) => row.name)).toContain('property_options');

      const capped = inspectResultSchema.parse(
        JSON.parse(
          assertToolSucceeded(
            'inspect_database',
            await callTool('inspect_database', {
              project_id: projectId,
              database_name: 'neondb',
              check: 'table-sizes',
              limit: 1,
            }),
          ),
        ),
      );
      expect(capped.rows).toHaveLength(1);
      expect(capped.totalRowCount).toBe(full.totalRowCount);
      expect(capped.truncated).toBe(true);
      expect(capped.note).toContain(`of ${full.totalRowCount} rows`);
    },
    LIVE_TEST_TIMEOUT_MS,
  );

  it(
    'runs the extension-gated checks once their extensions exist',
    async () => {
      if (!projectId) throw new Error('Test project was not created.');
      const extensions = [
        ...new Set(
          INSPECT_CHECKS.map(
            (check) => INSPECT_QUERIES[check].requiresExtension,
          ).filter((name): name is string => Boolean(name)),
        ),
      ];
      assertToolSucceeded(
        'run_sql_transaction',
        await callTool('run_sql_transaction', {
          project_id: projectId,
          sql_statements: extensions.map(
            (name) => `CREATE EXTENSION IF NOT EXISTS ${name}`,
          ),
        }),
      );

      for (const check of INSPECT_CHECKS.filter(
        (candidate) => INSPECT_QUERIES[candidate].requiresExtension,
      )) {
        const report = inspectResultSchema.parse(
          JSON.parse(
            assertToolSucceeded(
              `inspect_database/${check}`,
              await callTool('inspect_database', {
                project_id: projectId,
                database_name: 'neondb',
                check,
              }),
            ),
          ),
        );
        expect(report.check).toBe(check);
        expect(report.fields).toEqual(INSPECT_QUERIES[check].fields);
        for (const row of report.rows) {
          expect(Object.keys(row).sort()).toEqual([...report.fields].sort());
        }
        expectSqlCapDisclosed(check, report);
      }
    },
    LIVE_TEST_TIMEOUT_MS,
  );

  it(
    'deletes the project through MCP and verifies deletion with @neon/sdk',
    async () => {
      if (!projectId) throw new Error('Test project was not created.');
      const id = projectId;
      const project = await findProject(id);
      expect(project?.name).toBe(projectName);
      if (!project?.name.startsWith(`${PROJECT_PREFIX}-`)) {
        throw new Error(
          `Refusing to delete unprefixed project: ${project?.name}`,
        );
      }

      const result = await callTool('delete_project', {
        project_id: id,
      });
      assertToolSucceeded('delete_project', result);
      await waitForProjectDeletion(id);
      projectId = undefined;
    },
    LIVE_TEST_TIMEOUT_MS,
  );
});
