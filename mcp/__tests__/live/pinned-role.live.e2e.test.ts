/**
 * A pinned Postgres role against real Neon: MCP servers built with
 * `grant.roleName` run SQL on a disposable project, and Postgres itself — not
 * the server — decides what the role may do.
 *
 * The role is created with plain SQL (`CREATE ROLE ... LOGIN PASSWORD`), not
 * through the Neon API, and is not a member of `neon_superuser`. The owner
 * side of each check runs out of band over its own connection, never through
 * the pinned server. Setup and cleanup follow `mcp-server.live.e2e.test.ts`.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { config as loadEnv } from 'dotenv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { z } from 'zod';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { NeonApiClient } from '../../neon-client';
import type { GrantContext } from '../../utils/grant-context';

loadEnv({ path: '.env.test', quiet: true });

process.env.ANALYTICS_WRITE_KEY = '';
process.env.SENTRY_DSN = '';

const PROJECT_PREFIX = 'smoke-mcp-live';
const LIVE_TEST_TIMEOUT_MS = 180_000;
const PINNED_ROLE = 'mcp_pinned_reader';
const MISSING_ROLE = 'mcp_missing_role';
const GRANTED_TABLE = 'mcp_pinned_granted';
const PROTECTED_TABLE = 'mcp_pinned_protected';
// Never logged: only its absence from tool output is asserted.
const PINNED_PASSWORD = `P${randomBytes(18).toString('hex')}`;

const toolResultSchema = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
  isError: z.boolean().optional(),
});

const identitySchema = z.array(
  z.object({ session_user: z.string(), current_user: z.string() }),
);

type Connected = { client: Client; server: McpServer };

function requireApiKey(): string {
  const value = process.env.NEON_API_KEY?.trim();
  if (!value) {
    throw new Error(
      'NEON_API_KEY is required. Copy .env.test.example to the repository-local .env.test.',
    );
  }
  return value;
}

function text(result: unknown): string {
  return toolResultSchema
    .parse(result)
    .content.map((item) => item.text ?? '')
    .join('\n');
}

function expectNoCredentials(output: string, ownerPassword: string) {
  expect(output).not.toContain(PINNED_PASSWORD);
  if (ownerPassword) expect(output).not.toContain(ownerPassword);
  expect(output).not.toMatch(/postgres(ql)?:\/\/[^\s"]*:[^\s"]*@/);
}

describe.sequential('pinned Postgres role on live Neon', () => {
  const connected: Connected[] = [];
  let neonClient: NeonApiClient | undefined;
  let createServer:
    | ((grant: GrantContext, readOnly: boolean) => Promise<Client>)
    | undefined;
  let owner: Client | undefined;
  let pinned: Client | undefined;
  let pinnedReadOnly: Client | undefined;
  let testOrgId = '';
  let projectId: string | undefined;
  let ownerSql: NeonQueryFunction<false, false> | undefined;
  let ownerRole = '';
  let ownerPassword = '';
  const projectName = `${PROJECT_PREFIX}-pinned-${Date.now()}-${randomUUID().slice(0, 8)}`;

  async function call(
    client: Client | undefined,
    name: string,
    args: Record<string, unknown>,
  ) {
    if (!client) throw new Error('MCP client is not connected.');
    if (!projectId) throw new Error('Test project was not created.');
    const result = await client.callTool({
      name,
      arguments: { project_id: projectId, ...args },
    });
    const output = text(result);
    expectNoCredentials(output, ownerPassword);
    return { isError: toolResultSchema.parse(result).isError === true, output };
  }

  async function succeeds(
    client: Client | undefined,
    name: string,
    args: Record<string, unknown>,
  ) {
    const { isError, output } = await call(client, name, args);
    if (isError) throw new Error(`${name} failed: ${output}`);
    return output;
  }

  async function findProject(
    match: (p: { id: string; name: string }) => boolean,
  ) {
    if (!neonClient) throw new Error('Neon SDK client is not initialized.');
    const response = await neonClient.listProjects({
      org_id: testOrgId,
      search: projectId ?? projectName,
    });
    return response.data.projects.find(match);
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

    createServer = async (grant, readOnly) => {
      const server = await createMcpServer({
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
        grant,
        readOnly,
      });
      const client = new Client({
        name: 'mcp-server-neon-live-e2e',
        version: '1.0.0',
      });
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      connected.push({ client, server });
      return client;
    };

    owner = await createServer({ projectId: null, scopes: null }, false);
    pinned = await createServer(
      { projectId: null, scopes: null, roleName: PINNED_ROLE },
      false,
    );
    pinnedReadOnly = await createServer(
      { projectId: null, scopes: null, roleName: PINNED_ROLE },
      true,
    );
  }, LIVE_TEST_TIMEOUT_MS);

  afterAll(async () => {
    try {
      if (neonClient) {
        const project = await findProject((p) =>
          projectId ? p.id === projectId : p.name === projectName,
        );
        if (project) {
          if (!project.name.startsWith(`${PROJECT_PREFIX}-`)) {
            throw new Error(
              `Refusing to delete project without ${PROJECT_PREFIX}- prefix: ${project.name}`,
            );
          }
          await neonClient.deleteProject(project.id);
          for (let attempt = 0; attempt < 10; attempt += 1) {
            if (!(await findProject((p) => p.id === project.id))) break;
            await delay(500);
          }
          expect(await findProject((p) => p.id === project.id)).toBeUndefined();
        }
      }
    } finally {
      for (const { client, server } of connected) {
        await client.close();
        await server.close();
      }
    }
  }, LIVE_TEST_TIMEOUT_MS);

  it(
    'creates a disposable project and a SQL-only restricted login role',
    async () => {
      const created = await owner?.callTool({
        name: 'create_project',
        arguments: { name: projectName, org_id: testOrgId },
      });
      if (toolResultSchema.parse(created).isError) {
        throw new Error(`create_project failed: ${text(created)}`);
      }
      projectId = z
        .object({ id: z.string() })
        .parse(JSON.parse(text(created))).id;

      if (!neonClient) throw new Error('Neon SDK client is not initialized.');
      const databases = (
        await neonClient.listProjectBranchDatabases(
          projectId,
          (
            await neonClient.listProjectBranches({ projectId })
          ).data.branches.find((branch) => branch.default)?.id ?? '',
        )
      ).data.databases;
      ownerRole = databases[0].owner_name;
      const ownerUri = (
        await neonClient.getConnectionUri({
          projectId,
          role_name: ownerRole,
          database_name: databases[0].name,
        })
      ).data.uri;
      ownerPassword = decodeURIComponent(new URL(ownerUri).password);
      ownerSql = neon(ownerUri);

      await ownerSql.transaction([
        ownerSql.query(`CREATE TABLE ${GRANTED_TABLE} (id int)`),
        ownerSql.query(`INSERT INTO ${GRANTED_TABLE} VALUES (1), (2)`),
        ownerSql.query(`CREATE TABLE ${PROTECTED_TABLE} (secret text)`),
        ownerSql.query(`INSERT INTO ${PROTECTED_TABLE} VALUES ('hidden')`),
        ownerSql.query(
          `CREATE ROLE ${PINNED_ROLE} LOGIN PASSWORD '${PINNED_PASSWORD}'`,
        ),
        ownerSql.query(`GRANT SELECT ON ${GRANTED_TABLE} TO ${PINNED_ROLE}`),
      ]);

      const membership = await ownerSql.query(
        `SELECT pg_has_role($1, 'neon_superuser', 'MEMBER') AS is_member`,
        [PINNED_ROLE],
      );
      expect(membership[0]?.is_member).toBe(false);
    },
    LIVE_TEST_TIMEOUT_MS,
  );

  it(
    'authenticates as the pinned role, with no SET ROLE',
    async () => {
      const sql = 'SELECT session_user::text, current_user::text';
      for (const client of [pinned, pinnedReadOnly]) {
        const rows = identitySchema.parse(
          JSON.parse(await succeeds(client, 'run_sql', { sql })),
        );
        expect(rows).toEqual([
          { session_user: PINNED_ROLE, current_user: PINNED_ROLE },
        ]);
      }

      // Every statement of a transaction runs as the pinned role.
      const statements = JSON.parse(
        await succeeds(pinned, 'run_sql_transaction', {
          sql_statements: [sql, sql],
        }),
      ) as unknown[];
      for (const rows of statements) {
        expect(identitySchema.parse(rows)[0]).toEqual({
          session_user: PINNED_ROLE,
          current_user: PINNED_ROLE,
        });
      }

      // A role_name equal to the pin is accepted.
      expect(
        await succeeds(pinned, 'run_sql', { sql, role_name: PINNED_ROLE }),
      ).toContain(PINNED_ROLE);
    },
    LIVE_TEST_TIMEOUT_MS,
  );

  it(
    'reads the granted table and gets Postgres permission errors elsewhere',
    async () => {
      const granted = await succeeds(pinned, 'run_sql', {
        sql: `SELECT count(*)::int AS n FROM ${GRANTED_TABLE}`,
      });
      expect(JSON.parse(granted)).toEqual([{ n: 2 }]);

      const write = await call(pinned, 'run_sql', {
        sql: `INSERT INTO ${GRANTED_TABLE} VALUES (3)`,
      });
      expect(write.isError).toBe(true);
      expect(write.output).toMatch(/permission denied for table/);

      const read = await call(pinned, 'run_sql', {
        sql: `SELECT * FROM ${PROTECTED_TABLE}`,
      });
      expect(read.isError).toBe(true);
      expect(read.output).toMatch(/permission denied for table/);
      expect(read.output).not.toContain('hidden');

      const ddl = await call(pinned, 'run_sql', {
        sql: 'CREATE TABLE mcp_pinned_should_not_exist (id int)',
      });
      expect(ddl.isError).toBe(true);
      expect(ddl.output).toMatch(/permission denied for schema/);

      const rows = await ownerSql?.query(
        `SELECT count(*)::int AS n FROM ${GRANTED_TABLE}`,
      );
      expect(rows?.[0]?.n).toBe(2);
    },
    LIVE_TEST_TIMEOUT_MS,
  );

  it(
    'keeps the read-only transaction around pinned queries',
    async () => {
      const setting = await succeeds(pinnedReadOnly, 'run_sql', {
        sql: "SELECT current_setting('transaction_read_only') AS ro",
      });
      expect(JSON.parse(setting)).toEqual([{ ro: 'on' }]);

      const unpinnedWritable = await succeeds(owner, 'run_sql', {
        sql: "SELECT current_setting('transaction_read_only') AS ro",
      });
      expect(JSON.parse(unpinnedWritable)).toEqual([{ ro: 'off' }]);
    },
    LIVE_TEST_TIMEOUT_MS,
  );

  it(
    'cannot get an owner connection by overriding or omitting the role',
    async () => {
      for (const client of [pinned, pinnedReadOnly]) {
        const override = await call(client, 'run_sql', {
          sql: 'SELECT session_user::text',
          role_name: ownerRole,
        });
        expect(override.isError).toBe(true);
        expect(override.output).toContain(
          `pinned to Postgres role "${PINNED_ROLE}"`,
        );

        const transaction = await call(client, 'run_sql_transaction', {
          sql_statements: ['SELECT session_user::text'],
          role_name: ownerRole,
        });
        expect(transaction.isError).toBe(true);
      }

      // No connection strings on a pinned connection.
      const tools = (await pinned?.listTools())?.tools.map((tool) => tool.name);
      expect(tools).toContain('run_sql');
      expect(tools).not.toContain('get_connection_string');

      // Every other SQL tool also sees only what the pinned role sees.
      const tables = await succeeds(pinned, 'get_database_tables', {});
      expect(tables).toContain(GRANTED_TABLE);

      const described = await call(pinned, 'describe_table_schema', {
        table_name: PROTECTED_TABLE,
      });
      expect(described.output).not.toContain('hidden');

      const explain = await call(pinned, 'explain_sql_statement', {
        sql: `SELECT * FROM ${PROTECTED_TABLE}`,
      });
      expect(explain.isError).toBe(true);
      expect(explain.output).toMatch(/permission denied for table/);
    },
    LIVE_TEST_TIMEOUT_MS,
  );

  it(
    'fails before SQL runs when the pinned role cannot log in, and recovers with LOGIN',
    async () => {
      if (!ownerSql) throw new Error('Owner connection is not ready.');
      await ownerSql.query(`ALTER ROLE ${PINNED_ROLE} NOLOGIN`);
      try {
        const refused = await call(pinned, 'run_sql', {
          sql: 'SELECT session_user::text',
        });
        expect(refused.isError).toBe(true);
        // An authentication error: the login was refused, so the statement
        // never reached the executor. Neon's proxy reports NOLOGIN as a failed
        // SASL exchange (08P01) rather than Postgres's "not permitted to log in".
        expect(refused.output).toMatch(
          /SASL authentication failed|not permitted to log in/,
        );
        expect(refused.output).not.toContain(ownerRole);
      } finally {
        await ownerSql.query(`ALTER ROLE ${PINNED_ROLE} LOGIN`);
      }

      const restored = identitySchema.parse(
        JSON.parse(
          await succeeds(pinned, 'run_sql', {
            sql: 'SELECT session_user::text, current_user::text',
          }),
        ),
      );
      expect(restored[0]?.session_user).toBe(PINNED_ROLE);
    },
    LIVE_TEST_TIMEOUT_MS,
  );

  it(
    'fails closed for a pinned role that does not exist',
    async () => {
      const missing = await createServer?.(
        { projectId: null, scopes: null, roleName: MISSING_ROLE },
        true,
      );
      const result = await call(missing, 'run_sql', {
        sql: 'SELECT session_user::text',
      });
      expect(result.isError).toBe(true);
      expect(result.output).not.toContain(ownerRole);
    },
    LIVE_TEST_TIMEOUT_MS,
  );

  it(
    'lets an unpinned connection pick the role per call (issue #347)',
    async () => {
      const rows = identitySchema.parse(
        JSON.parse(
          await succeeds(owner, 'run_sql', {
            sql: 'SELECT session_user::text, current_user::text',
            role_name: PINNED_ROLE,
          }),
        ),
      );
      expect(rows[0]).toEqual({
        session_user: PINNED_ROLE,
        current_user: PINNED_ROLE,
      });

      const defaultRole = identitySchema.parse(
        JSON.parse(
          await succeeds(owner, 'run_sql', {
            sql: 'SELECT session_user::text, current_user::text',
          }),
        ),
      );
      expect(defaultRole[0]?.session_user).toBe(ownerRole);
    },
    LIVE_TEST_TIMEOUT_MS,
  );
});
