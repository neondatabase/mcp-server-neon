/**
 * The Neon control plane attributes traffic to a caller by user agent, and that
 * attribution is what separates MCP usage from direct API usage in analytics.
 * Migrating to `@neon/sdk` silently dropped the header, because the SDK sends no
 * user agent of its own and its config has no way to set one, so 96% of MCP
 * traffic was reattributed to `API` overnight.
 *
 * Nothing in the type system catches that, so this asserts it over real HTTP:
 * a local server records the headers it receives from both the SDK-backed path
 * and the raw-request escape hatch.
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import pkg from '../../package.json';

let server: Server;
let baseUrl: string;
let receivedUserAgents: (string | undefined)[];

beforeEach(async () => {
  receivedUserAgents = [];
  server = createServer((req, res) => {
    receivedUserAgents.push(req.headers['user-agent']);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ project: { id: 'test-project' } }));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;

  vi.resetModules();
  process.env.NEON_API_HOST = `${baseUrl}/api/v2`;
});

afterEach(async () => {
  delete process.env.NEON_API_HOST;
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

describe('Neon API client user agent', () => {
  it('identifies itself as the MCP server on SDK-backed requests', async () => {
    const { createNeonClient } = await import('../neon-client');
    const client = createNeonClient('test-api-key');

    await client.getProject('test-project');

    expect(receivedUserAgents).toEqual([`mcp-server-neon/${pkg.version}`]);
  });

  it('identifies itself as the MCP server on raw requests', async () => {
    const { createNeonClient } = await import('../neon-client');
    const client = createNeonClient('test-api-key');

    await client.request({
      path: `${baseUrl}/api/v2/projects/test-project`,
      method: 'GET',
    });

    expect(receivedUserAgents).toEqual([`mcp-server-neon/${pkg.version}`]);
  });
});
