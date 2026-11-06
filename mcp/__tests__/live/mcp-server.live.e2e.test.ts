import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { config as loadEnv } from 'dotenv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import type { McpServer } from '@modelcontextprotocol/server';
import { neon } from '@neondatabase/serverless';
import { z } from 'zod';
import type { NeonApiClient } from '../../neon-client';
import { REDACTED_SECRET } from '../../tools/handlers/neon-auth-settings-snapshot';
import type { ServerContext } from '../../types/context';
import {
  INSPECT_CHECKS,
  INSPECT_QUERIES,
  type InspectCheck,
} from '../../inspect/queries';
import { LIVE_TEST_REGION } from './live-test-region';

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

function jsonBlocks(toolName: string, result: unknown): unknown[] {
  assertToolSucceeded(toolName, result);
  return toolResultSchema
    .parse(result)
    .content.map((item) => JSON.parse(textContentSchema.parse(item).text));
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
  let readOnlyClient: Client | undefined;
  let readOnlyServer: McpServer | undefined;
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

    const context: ServerContext = {
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
    };
    const connect = async (serverContext: ServerContext) => {
      const connectedServer = await createMcpServer(serverContext);
      const connectedClient = new Client({
        name: 'mcp-server-neon-live-e2e',
        version: '1.0.0',
      });
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      await connectedServer.connect(serverTransport);
      await connectedClient.connect(clientTransport);
      return { connectedServer, connectedClient };
    };

    ({ connectedServer: server, connectedClient: client } =
      await connect(context));
    ({ connectedServer: readOnlyServer, connectedClient: readOnlyClient } =
      await connect({ ...context, readOnly: true }));
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
      await readOnlyClient?.close();
      await readOnlyServer?.close();
    }
  }, LIVE_TEST_TIMEOUT_MS);

  it(
    'creates a prefixed project through the MCP protocol and verifies it with @neon/sdk',
    async () => {
      const result = await callTool('create_project', {
        name: projectName,
        region_id: LIVE_TEST_REGION,
      });
      const text = assertToolSucceeded('create_project', result);
      const created = z.object({ id: z.string() }).parse(JSON.parse(text));
      projectId = created.id;

      if (!neonClient) throw new Error('Neon SDK client is not initialized.');
      const response = await neonClient.getProject(projectId);
      expect(response.data.project.name).toBe(projectName);
      expect(response.data.project.region_id).toBe(LIVE_TEST_REGION);
    },
    LIVE_TEST_TIMEOUT_MS,
  );

  it(
    'counts projects and reads project and branch consumption on a read-only connection',
    async () => {
      if (!projectId) throw new Error('Test project was not created.');
      if (!readOnlyClient)
        throw new Error('Read-only client is not connected.');
      const roClient = readOnlyClient;
      const roCall = async (name: string, args: Record<string, unknown>) =>
        assertToolSucceeded(
          name,
          await roClient.callTool({ name, arguments: args }),
        );

      const count = z
        .number()
        .int()
        .parse(JSON.parse(await roCall('count_projects', {})));
      expect(count).toBeGreaterThanOrEqual(1);

      const to = new Date();
      const window = {
        org_id: testOrgId,
        project_ids: [projectId],
        from: new Date(to.getTime() - 24 * 60 * 60 * 1000).toISOString(),
        to: to.toISOString(),
        granularity: 'hourly',
        metrics: ['compute_unit_seconds', 'root_branch_bytes_month'],
      };
      const perProject = z
        .array(
          z.object({ project_id: z.string(), periods: z.array(z.unknown()) }),
        )
        .parse(JSON.parse(await roCall('get_project_consumption', window)));
      const perBranch = z
        .array(z.object({ project_id: z.string(), branch_id: z.string() }))
        .parse(JSON.parse(await roCall('get_branch_consumption', window)));
      // A project created moments ago has no history yet, so both lists may be empty.
      for (const row of [...perProject, ...perBranch]) {
        expect(row.project_id).toBe(projectId);
      }
    },
    LIVE_TEST_TIMEOUT_MS,
  );

  it(
    'finds the project once with search and fetches it by the returned id',
    async () => {
      if (!projectId) throw new Error('Test project was not created.');
      const searchText = assertToolSucceeded(
        'search',
        await callTool('search', { query: projectName }),
      );
      const results = z
        .array(z.object({ id: z.string(), type: z.string() }))
        .parse(JSON.parse(searchText));
      expect(
        results.filter((result) => result.id === `project:${projectId}`),
      ).toEqual([{ id: `project:${projectId}`, type: 'project' }]);

      const fetchText = assertToolSucceeded(
        'fetch',
        await callTool('fetch', { id: `project:${projectId}` }),
      );
      expect(fetchText).toContain(projectId);
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
    'keeps writes out of a read-only connection',
    async () => {
      if (!projectId) throw new Error('Test project was not created.');
      if (!readOnlyClient)
        throw new Error('Read-only client is not connected.');
      const roClient = readOnlyClient;
      const roRunSql = (sql: string) =>
        roClient.callTool({
          name: 'run_sql',
          arguments: { project_id: projectId, sql },
        });
      const expectRejected = (result: unknown, message: string) => {
        expect(toolResultSchema.parse(result).isError).toBe(true);
        expect(textContent(result)).toContain(message);
      };

      const { tools } = await roClient.listTools();
      const toolNames = tools.map((tool) => tool.name);
      expect(toolNames).toContain('run_sql');
      expect(toolNames).not.toContain('run_sql_transaction');

      await expect(
        roClient.callTool({
          name: 'run_sql_transaction',
          arguments: {
            project_id: projectId,
            sql_statements: [
              'COMMIT',
              "INSERT INTO public.property_options VALUES ('escaped')",
            ],
          },
        }),
      ).rejects.toMatchObject({
        code: -32602,
        message: 'Tool run_sql_transaction not found',
      });

      expectRejected(
        await roRunSql(
          "INSERT INTO public.property_options VALUES ('escaped')",
        ),
        'cannot execute INSERT in a read-only transaction',
      );
      expectRejected(
        await roRunSql(
          "COMMIT; INSERT INTO public.property_options VALUES ('escaped')",
        ),
        'cannot insert multiple commands into a prepared statement',
      );
      expectRejected(
        await roRunSql(
          "DO $$ BEGIN SET TRANSACTION READ WRITE; INSERT INTO public.property_options VALUES ('escaped'); END $$",
        ),
        'transaction read-write mode must be set before any query',
      );

      const count = await roRunSql(
        'SELECT count(*)::int AS n FROM public.property_options',
      );
      expect(JSON.parse(assertToolSucceeded('run_sql', count))).toEqual([
        { n: 0 },
      ]);
    },
    LIVE_TEST_TIMEOUT_MS,
  );

  it(
    'caps run_sql rows and returns Postgres error fields',
    async () => {
      if (!projectId) throw new Error('Test project was not created.');
      const runSql = (args: Record<string, unknown>) =>
        callTool('run_sql', { project_id: projectId, ...args });
      const series = 'SELECT n FROM generate_series(1, 150) AS n';

      const [cappedRows, cappedSummary] = jsonBlocks(
        'run_sql',
        await runSql({ sql: series }),
      );
      expect(cappedRows).toHaveLength(100);
      expect(z.array(z.unknown()).parse(cappedRows)[99]).toEqual({ n: 100 });
      const rerunNote =
        'To see more, raise `max_rows` or narrow the query with WHERE or LIMIT. The SQL already ran, so if it changed data, running it again repeats the change.';
      expect(cappedSummary).toEqual({
        totalRowCount: 150,
        truncated: true,
        note: `Showing the first 100 of 150 rows. ${rerunNote}`,
      });

      const raised = jsonBlocks(
        'run_sql',
        await runSql({ sql: series, max_rows: 150 }),
      );
      expect(raised).toHaveLength(1);
      expect(raised[0]).toHaveLength(150);

      const [writeRows, writeSummaries] = jsonBlocks(
        'run_sql_transaction',
        await callTool('run_sql_transaction', {
          project_id: projectId,
          sql_statements: [
            'CREATE TABLE public.max_rows_probe (n int)',
            // A writable CTE reports a SELECT command tag.
            'WITH inserted AS (INSERT INTO public.max_rows_probe SELECT generate_series(1, 5) RETURNING n) SELECT n FROM inserted ORDER BY n',
            'DROP TABLE public.max_rows_probe',
          ],
          max_rows: 2,
        }),
      );
      expect(writeRows).toEqual([[], [{ n: 1 }, { n: 2 }], []]);
      expect(writeSummaries).toEqual([
        { totalRowCount: 0, truncated: false },
        {
          totalRowCount: 5,
          truncated: true,
          note: `Showing the first 2 of 5 rows. ${rerunNote}`,
        },
        { totalRowCount: 0, truncated: false },
      ]);

      const missingTable = await runSql({ sql: 'SELECT * FROM no_such_table' });
      expect(toolResultSchema.parse(missingTable).isError).toBe(true);
      expect(textContent(missingTable)).toBe(
        [
          'NeonDbError: relation "no_such_table" does not exist',
          'SQLSTATE: 42P01',
          'POSITION: 15',
        ].join('\n'),
      );

      const wrongArgs = await runSql({ sql: 'SELECT lower(1)' });
      expect(textContent(wrongArgs)).toBe(
        [
          'NeonDbError: function lower(integer) does not exist',
          'SQLSTATE: 42883',
          'POSITION: 8',
          'HINT: No function matches the given name and argument types. You might need to add explicit type casts.',
        ].join('\n'),
      );
    },
    LIVE_TEST_TIMEOUT_MS,
  );

  it(
    'describes a branch without leaving show_db_tree in the database',
    async () => {
      if (!projectId) throw new Error('Test project was not created.');
      if (!neonClient) throw new Error('Neon SDK client is not initialized.');

      const branches = await neonClient.listProjectBranches({ projectId });
      const defaultBranch = branches.data.branches.find(
        (branch) => branch.default,
      );
      if (!defaultBranch) throw new Error('Default branch was not found.');

      const result = toolResultSchema.parse(
        await callTool('describe_branch', {
          project_id: projectId,
          branch_id: defaultBranch.id,
          database_name: 'neondb',
        }),
      );
      expect(result.isError).toBeFalsy();
      const structureText = result.content
        .map((item) => textContentSchema.safeParse(item))
        .flatMap((parsed) => (parsed.success ? [parsed.data.text] : []))
        .find((text) => text.startsWith('Database Structure:'));
      if (!structureText) {
        throw new Error('describe_branch returned no database structure.');
      }
      const structure = z
        .tuple([
          z.array(z.unknown()),
          z.array(z.object({ tree_structure: z.string() })),
        ])
        .parse(JSON.parse(structureText.slice('Database Structure:'.length)));
      expect(
        structure[1].some((row) =>
          row.tree_structure.includes('property_options'),
        ),
      ).toBe(true);

      const remaining = await callTool('run_sql', {
        project_id: projectId,
        sql: "SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'show_db_tree'",
      });
      expect(JSON.parse(assertToolSucceeded('run_sql', remaining))).toEqual([
        { n: 0 },
      ]);
    },
    LIVE_TEST_TIMEOUT_MS,
  );

  it(
    'refuses a .. database name instead of sending the request to another route',
    async () => {
      if (!projectId) throw new Error('Test project was not created.');
      if (!neonClient) throw new Error('Neon SDK client is not initialized.');

      const branches = await neonClient.listProjectBranches({ projectId });
      const defaultBranch = branches.data.branches.find(
        (branch) => branch.default,
      );
      if (!defaultBranch) throw new Error('Default branch was not found.');

      const result = toolResultSchema.parse(
        await callTool('delete_postgres_database', {
          project_id: projectId,
          branch_id: defaultBranch.id,
          database_name: '..',
        }),
      );
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain(
        'Path parameter database_name cannot be \\"..\\".',
      );

      const databases = await neonClient.listProjectBranchDatabases(
        projectId,
        defaultBranch.id,
      );
      expect(databases.data.databases.map((db) => db.name)).toContain('neondb');
    },
    LIVE_TEST_TIMEOUT_MS,
  );

  it(
    "keeps the database's own show_db_tree when describing a branch",
    async () => {
      if (!projectId) throw new Error('Test project was not created.');
      if (!neonClient) throw new Error('Neon SDK client is not initialized.');

      const branches = await neonClient.listProjectBranches({ projectId });
      const defaultBranch = branches.data.branches.find(
        (branch) => branch.default,
      );
      if (!defaultBranch) throw new Error('Default branch was not found.');

      const marker = 'application show_db_tree';
      assertToolSucceeded(
        'run_sql',
        await callTool('run_sql', {
          project_id: projectId,
          sql: `CREATE FUNCTION public.show_db_tree() RETURNS TABLE (tree_structure text) LANGUAGE sql AS $$ SELECT '${marker}'::text $$`,
        }),
      );
      try {
        const result = toolResultSchema.parse(
          await callTool('describe_branch', {
            project_id: projectId,
            branch_id: defaultBranch.id,
            database_name: 'neondb',
          }),
        );
        expect(result.isError).toBeFalsy();
        const texts = result.content
          .map((item) => textContentSchema.safeParse(item))
          .flatMap((parsed) => (parsed.success ? [parsed.data.text] : []));
        expect(
          texts.some((text) => text.startsWith('Database Structure:')),
        ).toBe(true);

        const after = await callTool('run_sql', {
          project_id: projectId,
          sql: 'SELECT tree_structure FROM public.show_db_tree()',
        });
        expect(JSON.parse(assertToolSucceeded('run_sql', after))).toEqual([
          { tree_structure: marker },
        ]);
      } finally {
        await callTool('run_sql', {
          project_id: projectId,
          sql: 'DROP FUNCTION IF EXISTS public.show_db_tree()',
        });
      }
    },
    LIVE_TEST_TIMEOUT_MS,
  );

  it(
    'says why describe_branch has no database structure',
    async () => {
      if (!projectId) throw new Error('Test project was not created.');
      if (!neonClient) throw new Error('Neon SDK client is not initialized.');

      const branches = await neonClient.listProjectBranches({ projectId });
      const defaultBranch = branches.data.branches.find(
        (branch) => branch.default,
      );
      if (!defaultBranch) throw new Error('Default branch was not found.');

      const result = toolResultSchema.parse(
        await callTool('describe_branch', {
          project_id: projectId,
          branch_id: defaultBranch.id,
          database_name: 'mcp_missing_database',
        }),
      );
      expect(result.isError).toBeFalsy();
      const texts = result.content
        .map((item) => textContentSchema.safeParse(item))
        .flatMap((parsed) => (parsed.success ? [parsed.data.text] : []));
      expect(texts.some((text) => text.startsWith('Branch Details:'))).toBe(
        true,
      );
      expect(
        texts.some((text) =>
          text.startsWith('Database structure unavailable: '),
        ),
      ).toBe(true);
    },
    LIVE_TEST_TIMEOUT_MS,
  );

  it(
    'applies a migration that Postgres splits, semicolons inside strings, bodies and comments included',
    async () => {
      if (!projectId) throw new Error('Test project was not created.');
      // A CR-only line ending after a comment, a function named begin, and a
      // COMMIT that lets CREATE INDEX CONCURRENTLY run outside the transaction.
      const migrationSql = [
        'CREATE TABLE mcp_split_notes (id serial PRIMARY KEY, body text, updated_at timestamptz);',
        "INSERT INTO mcp_split_notes (body) VALUES ('a;b'), (E'c\\;d');",
        'CREATE FUNCTION mcp_split_touch() RETURNS trigger AS $$',
        'BEGIN',
        '  NEW.updated_at := now();',
        '  RETURN NEW;',
        'END;',
        '$$ LANGUAGE plpgsql;',
        '-- touch updated_at; on every update',
        'CREATE TRIGGER mcp_split_touch BEFORE UPDATE ON mcp_split_notes FOR EACH ROW EXECUTE FUNCTION mcp_split_touch();',
        'CREATE FUNCTION mcp_split_add1(i int) RETURNS int LANGUAGE sql BEGIN ATOMIC SELECT i + 1; END;',
        "DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'mcp_split_mood') THEN CREATE TYPE mcp_split_mood AS ENUM ('ok'); END IF; END $do$;",
        '-- a CR-only line ending ends this comment;\rCREATE FUNCTION begin() RETURNS int LANGUAGE sql RETURN 7;',
        'COMMIT;',
        'CREATE INDEX CONCURRENTLY mcp_split_notes_body ON mcp_split_notes (body);',
      ].join('\n');
      try {
        const prepared = assertToolSucceeded(
          'prepare_database_migration',
          await callTool('prepare_database_migration', {
            project_id: projectId,
            database_name: 'neondb',
            migration_sql: migrationSql,
          }),
        );
        const context = (key: string) => {
          const value = new RegExp(`- ${key}: (\\S+)`).exec(prepared)?.[1];
          if (!value) throw new Error(`${key} missing from: ${prepared}`);
          return value;
        };
        assertToolSucceeded(
          'complete_database_migration',
          await callTool('complete_database_migration', {
            migration_id: context('migration_id'),
            migration_sql: migrationSql,
            database_name: context('database_name'),
            project_id: projectId,
            temporary_branch_id: context('temporary_branch_id'),
            parent_branch_id: context('parent_branch_id'),
            apply_changes: true,
          }),
        );

        const rows = await callTool('run_sql', {
          project_id: projectId,
          sql: `UPDATE mcp_split_notes SET body = body || ';x' RETURNING body, updated_at IS NOT NULL AS touched, mcp_split_add1(1) AS added, begin() AS seven, 'ok'::mcp_split_mood::text AS mood, to_regclass('mcp_split_notes_body') IS NOT NULL AS indexed`,
        });
        expect(JSON.parse(assertToolSucceeded('run_sql', rows))).toEqual([
          {
            body: 'a;b;x',
            touched: true,
            added: 2,
            seven: 7,
            mood: 'ok',
            indexed: true,
          },
          {
            body: 'c;d;x',
            touched: true,
            added: 2,
            seven: 7,
            mood: 'ok',
            indexed: true,
          },
        ]);
      } finally {
        await callTool('run_sql_transaction', {
          project_id: projectId,
          sql_statements: [
            'DROP TABLE IF EXISTS mcp_split_notes',
            'DROP FUNCTION IF EXISTS mcp_split_touch()',
            'DROP FUNCTION IF EXISTS mcp_split_add1(int)',
            'DROP FUNCTION IF EXISTS begin()',
            'DROP TYPE IF EXISTS mcp_split_mood',
          ],
        });
      }
    },
    LIVE_TEST_TIMEOUT_MS,
  );

  it(
    'rejects migration SQL that does not parse, at the position Postgres reports, before creating a branch',
    async () => {
      if (!projectId) throw new Error('Test project was not created.');
      if (!neonClient) throw new Error('Neon SDK client is not initialized.');
      const client = neonClient;
      const branchNames = async () =>
        (
          await client.listProjectBranches({ projectId: projectId! })
        ).data.branches.map((branch) => branch.name);
      const before = await branchNames();
      const sql =
        "CREATE TABLE mcp_split_never (id int);\nINSERT INTO mcp_split_never VALUES ('a);";

      const postgres = await callTool('run_sql', {
        project_id: projectId,
        sql,
      });
      const position = /POSITION: (\d+)/.exec(textContent(postgres))?.[1];
      expect(position).toBeDefined();

      const rejected = toolResultSchema.parse(
        await callTool('prepare_database_migration', {
          project_id: projectId,
          database_name: 'neondb',
          migration_sql: sql,
        }),
      );
      expect(rejected.isError).toBe(true);
      expect(textContent(rejected)).toBe(
        `InvalidArgumentError: Migration SQL does not parse at position ${position}: unterminated quoted string at or near "'a);"`,
      );
      expect(await branchNames()).toEqual(before);
    },
    LIVE_TEST_TIMEOUT_MS,
  );

  it(
    'applies nothing on the parent when a later migration statement fails',
    async () => {
      if (!projectId) throw new Error('Test project was not created.');
      if (!neonClient) throw new Error('Neon SDK client is not initialized.');
      assertToolSucceeded(
        'run_sql',
        await callTool('run_sql', {
          project_id: projectId,
          sql: 'CREATE TABLE mcp_split_atomic (id int)',
        }),
      );
      let temporaryBranchId: string | undefined;
      try {
        const prepared = assertToolSucceeded(
          'prepare_database_migration',
          await callTool('prepare_database_migration', {
            project_id: projectId,
            database_name: 'neondb',
            migration_sql: 'SELECT 1',
          }),
        );
        const context = (key: string) => {
          const value = new RegExp(`- ${key}: (\\S+)`).exec(prepared)?.[1];
          if (!value) throw new Error(`${key} missing from: ${prepared}`);
          return value;
        };
        temporaryBranchId = context('temporary_branch_id');

        const failed = toolResultSchema.parse(
          await callTool('complete_database_migration', {
            migration_id: context('migration_id'),
            migration_sql:
              'INSERT INTO mcp_split_atomic VALUES (1);\nSELECT 1 / 0;',
            database_name: context('database_name'),
            project_id: projectId,
            temporary_branch_id: temporaryBranchId,
            parent_branch_id: context('parent_branch_id'),
            apply_changes: true,
          }),
        );
        expect(failed.isError).toBe(true);
        expect(textContent(failed)).toContain('SQLSTATE: 22012');

        const count = await callTool('run_sql', {
          project_id: projectId,
          sql: 'SELECT count(*)::int AS n FROM mcp_split_atomic',
        });
        expect(JSON.parse(assertToolSucceeded('run_sql', count))).toEqual([
          { n: 0 },
        ]);
      } finally {
        if (temporaryBranchId) {
          await neonClient.deleteProjectBranch(projectId, temporaryBranchId);
        }
        await callTool('run_sql', {
          project_id: projectId,
          sql: 'DROP TABLE IF EXISTS mcp_split_atomic',
        });
      }
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
        .object({ id: z.string() })
        .parse(JSON.parse(assertToolSucceeded('create_branch', created)));
      const branchId = branch.id;

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
    'enables Realtime, reads and rotates its secret, then disables it',
    async () => {
      if (!projectId) throw new Error('Test project was not created.');
      if (!readOnlyClient)
        throw new Error('Read-only client is not connected.');
      const readOnlyTools = (await readOnlyClient.listTools()).tools.map(
        (tool) => tool.name,
      );
      expect(readOnlyTools).toContain('get_realtime');
      expect(readOnlyTools).not.toContain('get_realtime_secret');
      expect(readOnlyTools).not.toContain('enable_realtime');

      const branch = z
        .object({ id: z.string() })
        .parse(
          JSON.parse(
            assertToolSucceeded(
              'get_default_branch',
              await callTool('get_default_branch', { project_id: projectId }),
            ),
          ),
        );
      const target = { project_id: projectId, branch_id: branch.id };
      const realtimeState = z.object({
        enabled: z.boolean(),
        pending: z.boolean(),
      });
      const realtimeSecret = z.object({ secret: z.string().min(1) });
      const readSecret = async () =>
        realtimeSecret.parse(
          JSON.parse(
            assertToolSucceeded(
              'get_realtime_secret',
              await callTool('get_realtime_secret', target),
            ),
          ),
        ).secret;
      const readState = async () =>
        realtimeState.parse(
          JSON.parse(
            assertToolSucceeded(
              'get_realtime',
              await callTool('get_realtime', target),
            ),
          ),
        );

      assertToolSucceeded(
        'enable_realtime',
        await callTool('enable_realtime', target),
      );
      expect(await readState()).toMatchObject({
        enabled: true,
        pending: false,
      });

      const first = await readSecret();
      assertToolSucceeded(
        'rotate_realtime_secret',
        await callTool('rotate_realtime_secret', target),
      );
      expect(await readSecret()).not.toBe(first);

      assertToolSucceeded(
        'disable_realtime',
        await callTool('disable_realtime', target),
      );
      expect((await readState()).enabled).toBe(false);
    },
    LIVE_TEST_TIMEOUT_MS,
  );

  it(
    'provisions Neon Auth, updates each branch setting, and reads it back with get_neon_auth_config',
    async () => {
      if (!projectId) throw new Error('Test project was not created.');
      if (!readOnlyClient)
        throw new Error('Read-only client is not connected.');
      const readOnlyTools = (await readOnlyClient.listTools()).tools.map(
        (tool) => tool.name,
      );
      expect(readOnlyTools).toContain('get_neon_auth_config');
      expect(readOnlyTools).not.toContain('update_auth_webhooks');
      expect(readOnlyTools).not.toContain('send_auth_test_email');

      const branch = z
        .object({ id: z.string() })
        .parse(
          JSON.parse(
            assertToolSucceeded(
              'get_default_branch',
              await callTool('get_default_branch', { project_id: projectId }),
            ),
          ),
        );
      const target = { project_id: projectId, branch_id: branch.id };
      assertToolSucceeded(
        'provision_neon_auth',
        await callTool('provision_neon_auth', {
          ...target,
          auth_provider: 'better_auth',
        }),
      );

      const readConfig = async () => {
        const text = assertToolSucceeded(
          'get_neon_auth_config',
          await callTool('get_neon_auth_config', target),
        );
        return z
          .object({
            allow_localhost: z.boolean(),
            auth_methods: z.object({
              email_password: z.object({
                revoke_sessions_on_password_reset: z.boolean(),
              }),
            }),
            email_provider: z.record(z.string(), z.unknown()),
            plugins: z.object({
              organization: z.object({ membership_limit: z.number() }),
              magic_link: z.object({ expires_in: z.number() }),
              phone_number: z.object({ otp_expires_in: z.number() }),
            }),
            webhook: z.object({
              enabled: z.boolean(),
              webhook_url: z.string().optional(),
            }),
            _errors: z.never().optional(),
          })
          .parse(
            JSON.parse(
              text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1),
            ),
          );
      };
      const update = async (name: string, args: Record<string, unknown>) =>
        assertToolSucceeded(name, await callTool(name, { ...target, ...args }));

      const before = await readConfig();
      const smtpPassword = `live-e2e-${projectName}`;
      await update('update_auth_allow_localhost', {
        allow_localhost: !before.allow_localhost,
      });
      await update('update_auth_email_and_password', {
        revoke_sessions_on_password_reset:
          !before.auth_methods.email_password.revoke_sessions_on_password_reset,
      });
      const smtpUpdated = await update('update_auth_email_provider', {
        body: {
          type: 'standard',
          // RFC 6761 reserves .invalid, so the test send fails at DNS and no mail leaves.
          host: 'smtp.invalid',
          port: 587,
          username: 'live-e2e',
          password: smtpPassword,
          sender_email: 'live-e2e@example.com',
          sender_name: 'MCP live e2e',
        },
      });
      expect(smtpUpdated).not.toContain(smtpPassword);
      const sent = z
        .object({ success: z.boolean(), error_message: z.string() })
        .parse(
          JSON.parse(
            await update('send_auth_test_email', {
              recipient_email: 'live-e2e@example.com',
            }),
          ),
        );
      expect(sent.success).toBe(false);
      expect(sent.error_message).toContain('smtp.invalid');
      await update('update_auth_plugins_organization', {
        membership_limit: before.plugins.organization.membership_limit + 1,
      });
      await update('update_auth_plugins_magic_link', {
        expires_in: before.plugins.magic_link.expires_in + 1,
      });
      await update('update_auth_plugins_phone_number', {
        otp_expires_in: before.plugins.phone_number.otp_expires_in + 60,
      });
      await update('update_auth_webhooks', {
        enabled: true,
        webhook_url: 'https://example.com/neon-auth-webhook',
        enabled_events: ['user.created'],
      });

      const after = await readConfig();
      expect(after.allow_localhost).toBe(!before.allow_localhost);
      expect(
        after.auth_methods.email_password.revoke_sessions_on_password_reset,
      ).toBe(
        !before.auth_methods.email_password.revoke_sessions_on_password_reset,
      );
      expect(after.email_provider).toMatchObject({
        type: 'standard',
        host: 'smtp.invalid',
        password: REDACTED_SECRET,
      });
      expect(after.plugins.organization.membership_limit).toBe(
        before.plugins.organization.membership_limit + 1,
      );
      expect(after.plugins.magic_link.expires_in).toBe(
        before.plugins.magic_link.expires_in + 1,
      );
      expect(after.plugins.phone_number.otp_expires_in).toBe(
        before.plugins.phone_number.otp_expires_in + 60,
      );
      expect(after.webhook).toMatchObject({
        enabled: true,
        webhook_url: 'https://example.com/neon-auth-webhook',
      });

      await update('update_auth_webhooks', { enabled: false });
      expect((await readConfig()).webhook.webhook_url).toBeUndefined();
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
        if (INSPECT_QUERIES[check].scope === 'database') {
          expect(report.databaseName).toBe('neondb');
        } else {
          expect(report.databaseName).toBeUndefined();
        }
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
