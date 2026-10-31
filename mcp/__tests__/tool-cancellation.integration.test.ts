import { createServer, type IncomingMessage, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import type { ServerContext } from '../types/context';
import { assert } from '../../lib/assert';

type UpstreamCall = {
  received: Promise<IncomingMessage>;
  closed: Promise<void>;
};

let upstream: Server;
let onCall: (req: IncomingMessage) => void = () => undefined;
let createMcpServer: typeof import('../server/index').createMcpServer;
let POST: typeof import('../../app/api/[transport]/route').POST;
let serverHost: string;

function nextUpstreamCall(): UpstreamCall {
  let resolveReceived: (req: IncomingMessage) => void = () => undefined;
  let resolveClosed: () => void = () => undefined;
  const received = new Promise<IncomingMessage>((r) => (resolveReceived = r));
  const closed = new Promise<void>((r) => (resolveClosed = r));
  onCall = (req) => {
    resolveReceived(req);
    req.socket.on('close', resolveClosed);
  };
  return { received, closed };
}

function json(res: import('node:http').ServerResponse, body: unknown) {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

beforeAll(async () => {
  // Answers the API-key lookups; never answers anything else, so a tool call
  // only settles through cancellation.
  upstream = createServer((req, res) => {
    const path = req.url ?? '';
    if (path.endsWith('/auth')) {
      json(res, { auth_method: 'api_key_user', account_id: 'user_test_123' });
      return;
    }
    if (path.endsWith('/users/me')) {
      json(res, {
        id: 'user_test_123',
        name: 'Test User',
        email: 'test@example.com',
      });
      return;
    }
    onCall(req);
  });
  await new Promise<void>((resolve) =>
    upstream.listen(0, '127.0.0.1', resolve),
  );
  const address = upstream.address();
  assert(address !== null && typeof address === 'object', 'no listen address');

  process.env.NEON_API_HOST = `http://127.0.0.1:${address.port}/api/v2`;
  process.env.ANALYTICS_WRITE_KEY = '';
  process.env.SENTRY_DSN = '';
  ({ createMcpServer } = await import('../server/index'));
  ({ POST } = await import('../../app/api/[transport]/route'));
  ({ SERVER_HOST: serverHost } = await import('../../lib/config'));
});

afterAll(async () => {
  upstream.closeAllConnections();
  await new Promise((resolve) => upstream.close(resolve));
});

const context: ServerContext = {
  apiKey: 'test-api-key',
  authMethod: 'api_key_user',
  account: {
    id: 'user_test_123',
    name: 'Test User',
    email: 'test@example.com',
  },
  app: {
    name: 'mcp-server-neon',
    transport: 'stream',
    environment: 'development',
    version: 'test',
  },
};

describe('tool call cancellation', () => {
  it('aborts the upstream Neon API request when the MCP client cancels the call', async () => {
    const { received, closed } = nextUpstreamCall();
    const server = await createMcpServer(context);
    const client = new Client({ name: 'cancel-test', version: '1.0.0' });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const controller = new AbortController();
      const call = client.callTool(
        { name: 'list_branches', arguments: { project_id: 'proj-cancel' } },
        { signal: controller.signal },
      );

      const req = await received;
      expect(req.url).toContain('/projects/proj-cancel/branches');

      controller.abort();
      await expect(call).rejects.toThrow();
      await closed;
    } finally {
      await client.close();
      await server.close();
    }
  }, 15_000);

  it('aborts the upstream Neon API request when the /mcp HTTP request is aborted', async () => {
    const { received, closed } = nextUpstreamCall();
    const controller = new AbortController();
    const response = POST(
      new Request(`${serverHost}/mcp`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          authorization: 'Bearer route-cancel-key',
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-method': 'tools/call',
          'mcp-name': 'list_branches',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'list_branches',
            arguments: { project_id: 'proj-route-cancel' },
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientInfo': {
                name: 'cancel-test',
                version: '1.0.0',
              },
              'io.modelcontextprotocol/clientCapabilities': {},
            },
          },
        }),
      }),
    );

    const req = await received;
    expect(req.url).toContain('/projects/proj-route-cancel/branches');

    controller.abort();
    await closed;
    const res = await response;
    await res.body?.cancel();
  }, 15_000);
});
