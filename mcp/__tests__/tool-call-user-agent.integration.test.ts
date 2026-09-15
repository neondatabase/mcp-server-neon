import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
/**
 * The Neon control plane attributes traffic to a caller by user agent, and that
 * attribution is what separates MCP usage from direct API usage in analytics.
 * Migrating to `@neon/sdk` silently dropped the header, because the SDK sends no
 * user agent of its own and its config has no way to set one, so 96% of MCP
 * traffic was reattributed to `API` overnight.
 *
 * What regressed is a property of the server, not of any one client factory: the
 * requests a tool call puts on the wire. So these drive real MCP tool calls over
 * the in-memory transport with `NEON_API_HOST` pointed at a loopback server that
 * records what arrived.
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import pkg from '../../package.json';
import { track } from '../analytics/analytics';

// Tool calls emit a Segment event, and the write key has a production default.
vi.mock('../analytics/analytics', () => ({
  track: vi.fn(),
  flushAnalytics: vi.fn().mockResolvedValue(undefined),
}));

const USER_AGENT = `mcp-server-neon/${pkg.version}`;
const API_KEY = 'test-api-key';

type RecordedRequest = {
  method: string;
  path: string;
  userAgent: string | undefined;
  authorization: string | undefined;
  body: string;
};

/**
 * Keyed by `METHOD pathname`. Enough of each payload for the handler to render a
 * response — a handler that throws before its request is sent would otherwise
 * leave nothing recorded and fail for a reason that reads like the header is gone.
 */
const fixtures: Record<string, { status: number; body: unknown }> = {
  'POST /api/v2/projects/proj-1/branches': {
    status: 201,
    body: {
      branch: {
        id: 'br-child',
        project_id: 'proj-1',
        parent_id: 'br-parent',
        name: 'test-branch',
      },
      endpoints: [
        {
          id: 'ep-1',
          host: 'ep-xxx.us-east-1.aws.neon.tech',
          type: 'read_write',
        },
      ],
      databases: [],
      roles: [],
      connection_uris: [
        {
          connection_uri:
            'postgresql://neondb_owner:secret@ep-xxx.us-east-1.aws.neon.tech/neondb',
          connection_parameters: {
            host: 'ep-xxx.us-east-1.aws.neon.tech',
            pooler_host: 'ep-xxx-pooler.us-east-1.aws.neon.tech',
          },
        },
      ],
      operations: [],
    },
  },
  'POST /api/v2/projects/proj-1/branches/br-1/logs/query': {
    status: 200,
    body: { logs: [], is_truncated: false },
  },
};

let server: Server;
let recorded: RecordedRequest[];

beforeEach(async () => {
  recorded = [];
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      recorded.push({
        method: req.method ?? '',
        path: url.pathname,
        userAgent: req.headers['user-agent'],
        authorization: req.headers.authorization,
        body: Buffer.concat(chunks).toString(),
      });

      const fixture = fixtures[`${req.method} ${url.pathname}`];
      res.writeHead(fixture?.status ?? 404, {
        'Content-Type': 'application/json',
      });
      res.end(
        JSON.stringify(
          fixture?.body ?? { message: `no fixture for ${url.pathname}` },
        ),
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

async function callTool(name: string, params: Record<string, unknown>) {
  const { createMcpServer } = await import('../server/index');
  const mcpServer = await createMcpServer({
    apiKey: API_KEY,
    authMethod: 'api_key_user',
    account: { id: 'user_test_123', name: 'Test User', email: 'test@test.com' },
    app: {
      name: 'mcp-server-neon',
      transport: 'stream',
      environment: 'development',
      version: 'test',
    },
  });
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await mcpServer.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    const result = await client.callTool({ name, arguments: params });
    const content = result.content as Array<{ type: string; text?: string }>;
    if (result.isError) {
      throw new Error(`${name} failed: ${content[0]?.text}`);
    }
    return result;
  } finally {
    await client.close();
    await mcpServer.close();
  }
}

describe('user agent on Neon API requests made by tool calls', () => {
  it('identifies the MCP server on SDK-backed requests, without disturbing what the SDK put on them', async () => {
    await callTool('create_branch', {
      project_id: 'proj-1',
      name: 'test-branch',
    });

    expect(recorded).toEqual([
      expect.objectContaining({
        method: 'POST',
        path: '/api/v2/projects/proj-1/branches',
        userAgent: USER_AGENT,
        // The SDK builds a Request and calls `fetch(request)` with no second
        // argument, so a wrapper that passes `init.headers` replaces the header
        // set instead of adding to it, drops this, and 401s every call.
        authorization: `Bearer ${API_KEY}`,
      }),
    ]);
    expect(JSON.parse(recorded[0].body)).toMatchObject({
      branch: { name: 'test-branch' },
      endpoints: [{ type: 'read_write' }],
    });
    expect(vi.mocked(track)).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'tool_call',
        properties: expect.objectContaining({ toolName: 'create_branch' }),
      }),
    );
  });

  it('identifies the MCP server on logs requests', async () => {
    await callTool('query_logs', {
      project_id: 'proj-1',
      branch_id: 'br-1',
    });

    expect(recorded).toEqual([
      expect.objectContaining({
        method: 'POST',
        path: '/api/v2/projects/proj-1/branches/br-1/logs/query',
        userAgent: USER_AGENT,
        authorization: `Bearer ${API_KEY}`,
      }),
    ]);
  });
});
