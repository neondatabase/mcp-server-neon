/**
 * Project-aware published tools accept an optional `project_id` for every grant.
 * A scoped client can omit it and rely on `injectProjectId` to supply the grant.
 * Injection was previously silently breakable: it used to write a key at the wrong
 * level, no handler read it, and the tools fell through to "use the only project
 * this account has" — which looks fine on an account with one project.
 *
 * Asserting on `injectProjectId` directly cannot catch that, because the bug was
 * in where its result was put. So this drives a real MCP tool call, with no
 * arguments at all, and checks which project the Neon API was actually asked
 * about — against a loopback server that records the request rather than a mock.
 */

import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

// A tool call emits a Segment event and the write key has a production default,
// so blank it rather than mocking the analytics module out.
process.env.ANALYTICS_WRITE_KEY = '';
process.env.SENTRY_DSN = '';

const SCOPED_PROJECT_ID = 'proj-scoped';

const publishedSchemaSchema = z.object({
  properties: z.record(z.string(), z.unknown()).optional(),
  required: z.array(z.string()).optional(),
});

let server: Server;
let requestedPaths: string[];

beforeEach(async () => {
  requestedPaths = [];
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    req.resume();
    req.on('end', () => {
      requestedPaths.push(url.pathname);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          project: {
            id: SCOPED_PROJECT_ID,
            name: 'scoped project',
            platform_id: 'aws',
            region_id: 'aws-us-east-2',
          },
          uri: 'postgresql://owner:secret@loopback.invalid/neondb',
        }),
      );
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  vi.resetModules();
  process.env.NEON_API_HOST = `http://127.0.0.1:${port}/api/v2`;
});

afterEach(async () => {
  delete process.env.NEON_API_HOST;
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

async function connect(projectId: string | null) {
  const { createMcpServer } = await import('../server/index');
  const mcpServer = await createMcpServer({
    apiKey: 'test-api-key',
    authMethod: 'api_key_user',
    account: { id: 'user_test', name: 'Test', email: 'test@example.com' },
    app: {
      name: 'mcp-server-neon',
      transport: 'stream',
      environment: 'development',
      version: 'test',
    },
    grant: { projectId, scopes: null },
  });
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await mcpServer.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    close: () => Promise.allSettled([client.close(), mcpServer.close()]),
  };
}

function errorText(result: Awaited<ReturnType<Client['callTool']>>): string {
  const content = z
    .array(z.object({ type: z.string(), text: z.string().optional() }))
    .parse(result.content);
  return content.map((part) => part.text ?? '').join('\n');
}

describe('project-scoped grants', () => {
  it('injects the granted project into a call that carries no arguments', async () => {
    const { client, close } = await connect(SCOPED_PROJECT_ID);

    try {
      // Optional project_id allows the empty call below to use the scoped grant.
      const listed = await client.listTools();
      const getProject = listed.tools.find(
        (tool) => tool.name === 'describe_project',
      );
      const published = publishedSchemaSchema.parse(getProject?.inputSchema);
      const properties = published.properties ?? {};
      expect(Object.keys(properties)).toContain('project_id');
      expect(published.required ?? []).not.toContain('project_id');
      expect(Object.keys(properties)).not.toContain('projectId');

      const runSql = listed.tools.find((tool) => tool.name === 'run_sql');
      const runSqlPublished = publishedSchemaSchema.parse(runSql?.inputSchema);
      const runSqlProperties = runSqlPublished.properties ?? {};
      expect(Object.keys(runSqlProperties)).toContain('sql');
      expect(Object.keys(runSqlProperties)).toContain('project_id');
      expect(runSqlPublished.required ?? []).not.toContain('project_id');
      expect(Object.keys(runSqlProperties)).not.toContain('projectId');

      const result = await client.callTool({
        name: 'describe_project',
        arguments: {},
      });
      expect(result.isError).not.toBe(true);

      // The granted project, not a fallback to "the only project on the account".
      expect(requestedPaths).toContain(`/api/v2/projects/${SCOPED_PROJECT_ID}`);

      const requestCount = requestedPaths.length;
      const conflicting = await client.callTool({
        name: 'describe_project',
        arguments: { project_id: 'another-project' },
      });
      expect(conflicting.isError).toBe(true);
      expect(errorText(conflicting)).toContain(
        `does not match this connection's project "${SCOPED_PROJECT_ID}"`,
      );
      expect(requestedPaths).toHaveLength(requestCount);

      const conflictingSql = await client.callTool({
        name: 'run_sql',
        arguments: { sql: 'select 1', project_id: 'another-project' },
      });
      expect(conflictingSql.isError).toBe(true);
      expect(requestedPaths).toHaveLength(requestCount);

      const matching = await client.callTool({
        name: 'describe_project',
        arguments: { project_id: SCOPED_PROJECT_ID },
      });
      expect(matching.isError).not.toBe(true);
      expect(requestedPaths).toHaveLength(requestCount + 1);
    } finally {
      await close();
    }
  });
});

describe('a grant scoped to a value that is not a project id', () => {
  it('returns a validation error without calling the Neon API', async () => {
    const { client, close } = await connect('My Project');

    try {
      const result = await client.callTool({
        name: 'describe_project',
        arguments: {},
      });
      expect(result.isError).toBe(true);
      expect(errorText(result)).toContain('ZodError');
      expect(errorText(result)).toContain('project_id');
      expect(requestedPaths).toEqual([]);
    } finally {
      await close();
    }
  });
});

const CONNECTION_ARGS = {
  branch_id: 'br-loopback',
  database_name: 'neondb',
  role_name: 'owner',
};

describe('host tools on project-scoped and unscoped grants', () => {
  it('reach the handler with the granted or explicit project', async () => {
    const scoped = await connect(SCOPED_PROJECT_ID);
    const unscoped = await connect(null);

    try {
      for (const args of [
        CONNECTION_ARGS,
        { ...CONNECTION_ARGS, project_id: SCOPED_PROJECT_ID },
      ]) {
        const result = await scoped.client.callTool({
          name: 'get_connection_string',
          arguments: args,
        });
        expect(result.isError).not.toBe(true);
      }
      const explicit = await unscoped.client.callTool({
        name: 'get_connection_string',
        arguments: { ...CONNECTION_ARGS, project_id: 'proj-explicit' },
      });
      expect(explicit.isError).not.toBe(true);

      expect(requestedPaths).toEqual([
        `/api/v2/projects/${SCOPED_PROJECT_ID}/connection_uri`,
        `/api/v2/projects/${SCOPED_PROJECT_ID}/connection_uri`,
        '/api/v2/projects/proj-explicit/connection_uri',
      ]);
    } finally {
      await Promise.all([scoped.close(), unscoped.close()]);
    }
  });
});

describe('unscoped grants', () => {
  it('uses an explicit project_id and rejects an omitted one before any API call', async () => {
    const { client, close } = await connect(null);

    try {
      const explicit = await client.callTool({
        name: 'describe_project',
        arguments: { project_id: 'proj-explicit' },
      });
      expect(explicit.isError).not.toBe(true);
      expect(requestedPaths).toEqual(['/api/v2/projects/proj-explicit']);

      for (const [name, args] of [
        ['describe_project', {}],
        ['run_sql', { sql: 'select 1' }],
      ] as const) {
        const missing = await client.callTool({ name, arguments: args });
        expect(missing.isError).toBe(true);
        expect(errorText(missing)).toContain(
          'project_id is required because this connection is not scoped to a project',
        );
      }
      expect(requestedPaths).toHaveLength(1);
    } finally {
      await close();
    }
  });
});

describe('published schemas', () => {
  it('match across unscoped and scoped grants for every shared tool', async () => {
    const unscoped = await connect(null);
    const scoped = await connect(SCOPED_PROJECT_ID);
    const otherScoped = await connect('proj-other');

    try {
      const [unscopedTools, scopedTools, otherScopedTools] = await Promise.all(
        [unscoped, scoped, otherScoped].map(async ({ client }) => {
          const { tools } = await client.listTools();
          return new Map(tools.map((tool) => [tool.name, tool.inputSchema]));
        }),
      );
      expect(scopedTools.size).toBeGreaterThan(0);
      for (const [name, schema] of scopedTools) {
        expect(unscopedTools.get(name), name).toEqual(schema);
        expect(otherScopedTools.get(name), name).toEqual(schema);
      }
    } finally {
      await Promise.all([
        unscoped.close(),
        scoped.close(),
        otherScoped.close(),
      ]);
    }
  });
});
