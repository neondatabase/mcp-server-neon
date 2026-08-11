import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
/**
 * A project-scoped grant has `projectId` stripped out of every published tool
 * schema, so the client cannot send it and `injectProjectId` is its only source.
 * That made the injection silently breakable: it used to write a key at the wrong
 * level, no handler read it, and the tools fell through to "use the only project
 * this account has" — which looks fine on an account with one project.
 *
 * Asserting on `injectProjectId` directly cannot catch that, because the bug was
 * in where its result was put. So this drives a real MCP tool call, with no
 * arguments at all, and checks which project the Neon API was actually asked
 * about — against a loopback server that records the request rather than a mock.
 */

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

describe('project-scoped grants', () => {
  it('injects the granted project into a call that carries no arguments', async () => {
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
      grant: { projectId: SCOPED_PROJECT_ID, scopes: null },
    });

    const client = new Client({ name: 'test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await mcpServer.connect(serverTransport);
      await client.connect(clientTransport);

      // A scoped client cannot send projectId — it is not in the schema it was
      // given — so this is exactly the call a real one makes.
      const listed = await client.listTools();
      const describeProject = listed.tools.find(
        (tool) => tool.name === 'describe_project',
      );
      const published = publishedSchemaSchema.parse(
        describeProject?.inputSchema,
      );
      expect(Object.keys(published.properties ?? {})).not.toContain(
        'projectId',
      );

      const result = await client.callTool({
        name: 'describe_project',
        arguments: {},
      });
      expect(result.isError).not.toBe(true);

      // The granted project, not a fallback to "the only project on the account".
      expect(requestedPaths).toContain(`/api/v2/projects/${SCOPED_PROJECT_ID}`);
    } finally {
      // Both, even if connecting or closing one of them threw, and without
      // masking the assertion failure that got us here.
      await Promise.allSettled([client.close(), mcpServer.close()]);
    }
  });
});
