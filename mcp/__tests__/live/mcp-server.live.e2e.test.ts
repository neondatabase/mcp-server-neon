import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { config as loadEnv } from 'dotenv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { z } from 'zod';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { NeonApiClient } from '../../neon-client';

// Prefer a repo-local .env for portable clones. In Andre's workspace layout,
// fall back to the shared root environment at ../../.env.
loadEnv({ path: ['.env', '../../.env'], quiet: true });

// Live tests should not emit product analytics or Sentry events.
process.env.ANALYTICS_WRITE_KEY = '';
process.env.SENTRY_DSN = '';

const PROJECT_PREFIX = 'smoke-mcp-live';
const LIVE_TEST_TIMEOUT_MS = 120_000;

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

function requireApiKey(): string {
  const name = 'NEON_API_KEY';
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `${name} is required. Copy .env.example to .env or configure the shared workspace-root .env.`,
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
      arguments: { params },
    });
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
      const match = text.match(/project_id is "([^"]+)"/);
      if (!match?.[1]) {
        throw new Error(
          'create_project response did not contain a project ID.',
        );
      }
      projectId = match[1];

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
        projectId,
        sqlStatements: [
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
    'preserves default public-schema describe behavior',
    async () => {
      if (!projectId) throw new Error('Test project was not created.');
      const result = await callTool('describe_table_schema', {
        projectId,
        tableName: 'property_options',
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
        projectId,
        tableName: 'crm.property_options',
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

      const result = await callTool('delete_project', { projectId: id });
      assertToolSucceeded('delete_project', result);
      await waitForProjectDeletion(id);
      projectId = undefined;
    },
    LIVE_TEST_TIMEOUT_MS,
  );
});
