/**
 * `tool_call` for `call_api` carries the HTTP method and the spec's route
 * template, which says which Neon API operations agents reach without a
 * dedicated tool. Each case is a stateless `POST /mcp` through the deployed
 * route handler. One loopback server is the Neon API, the OpenAPI spec, and
 * the Segment collector, so the assertions read the events the server sent.
 * The spec cache lives for the process, so the cases run in order.
 */
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { neonBranch } from './helpers/neon-objects';

const BRANCH_PATH = '/projects/proj-1/branches/br-secret-name';
const BRANCH_ROUTE = '/projects/{project_id}/branches/{branch_id}';

const SPEC = {
  openapi: '3.0.3',
  paths: {
    [BRANCH_ROUTE]: {
      get: { operationId: 'getProjectBranch', summary: 'Retrieve branch' },
    },
  },
};

const API = new Map<string, z.core.util.JSONType>([
  ['/auth', { auth_method: 'api_key_user', account_id: 'user_test_123' }],
  [
    '/users/me',
    { id: 'user_test_123', name: 'Test User', email: 'test@example.com' },
  ],
  ['/users/me/organizations', { organizations: [] }],
  [
    BRANCH_PATH,
    {
      branch: neonBranch({
        id: 'br-secret-name',
        project_id: 'proj-1',
        name: 'secret-name',
      }),
    },
  ],
]);

const SegmentBatch = z.object({
  batch: z.array(
    z.object({
      event: z.string().optional(),
      properties: z.record(z.string(), z.json()).optional(),
    }),
  ),
});

type Delivered = z.infer<typeof SegmentBatch>['batch'][number];

const delivered: Delivered[] = [];
let specStatus = 200;
let specDelayMs = 0;
let specRequests = 0;

const json = (
  res: ServerResponse,
  status: number,
  body: z.core.util.JSONType,
) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const answer = (req: IncomingMessage, res: ServerResponse) => {
  const [path = ''] = (req.url ?? '').split('?');
  const chunks: Buffer[] = [];

  req.on('data', (chunk: Buffer) => {
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (path === '/v1/batch') {
      delivered.push(
        ...SegmentBatch.parse(JSON.parse(Buffer.concat(chunks).toString()))
          .batch,
      );
      json(res, 200, {});

      return;
    }

    if (path === '/spec.json') {
      specRequests += 1;
      setTimeout(() => {
        json(res, specStatus, specStatus === 200 ? SPEC : {});
      }, specDelayMs);

      return;
    }

    const body = API.get(path.replace(/^\/api\/v2/u, ''));

    json(res, body === undefined ? 404 : 200, body ?? { message: 'not found' });
  });
};

const server = createServer(answer);

server.listen(0, '127.0.0.1');

await once(server, 'listening');

const { port } = z.object({ port: z.number() }).parse(server.address());
const origin = `http://127.0.0.1:${String(port)}`;

Object.assign(process.env, {
  NEON_API_HOST: `${origin}/api/v2`,
  NEON_API_SPEC_URL: `${origin}/spec.json`,
  ANALYTICS_HOST: origin,
  ANALYTICS_WRITE_KEY: 'call-api-route-test-key',
  SENTRY_DSN: '',
  OAUTH_DATABASE_URL: 'postgresql://127.0.0.1:1/call-api-route',
});

const { POST } = await import('../../app/api/[transport]/route');
const { SERVER_HOST } = await import('../../lib/config');
const { flushAnalytics } = await import('../analytics/analytics');

const toolCallsFor = (toolName: string) =>
  delivered.flatMap((event) =>
    event.event === 'tool_call' && event.properties?.toolName === toolName
      ? [event.properties]
      : [],
  );

const callTool = async (name: string, args: z.core.util.JSONType) => {
  const response = await POST(
    new Request(`${SERVER_HOST}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: 'Bearer test-api-key',
        'mcp-method': 'tools/call',
        'mcp-name': name,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name,
          arguments: args,
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientInfo': {
              name: 'call-api-route',
              version: '1.0.0',
            },
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      }),
    }),
  );

  const body = await response.text();

  await flushAnalytics();

  return {
    isError: body.includes('"isError":true'),
    properties: toolCallsFor(name).at(-1),
  };
};

describe.sequential('call_api route tracking', () => {
  it('records spec_unavailable and still runs the call when the spec fails to load', async () => {
    specStatus = 503;

    const { isError, properties } = await callTool('call_api', {
      method: 'GET',
      path: BRANCH_PATH,
    });

    expect(isError).toBe(false);
    expect(properties).toMatchObject({
      apiMethod: 'GET',
      apiRoute: 'spec_unavailable',
    });
  });

  it('waits at most 2 seconds for a stalled spec, records spec_unavailable, and still runs the call', async () => {
    specDelayMs = 5000;

    const started = performance.now();

    const { isError, properties } = await callTool('call_api', {
      method: 'GET',
      path: BRANCH_PATH,
    });

    const elapsedMs = performance.now() - started;

    specDelayMs = 0;

    expect(isError).toBe(false);
    expect(properties).toMatchObject({ apiRoute: 'spec_unavailable' });
    expect(elapsedMs).toBeLessThan(4000);
  });

  it('fetches the spec again after a failure or stall and records the route template, never the path', async () => {
    specStatus = 200;

    const { properties } = await callTool('call_api', {
      method: 'GET',
      path: BRANCH_PATH,
    });

    expect(properties).toMatchObject({
      apiMethod: 'GET',
      apiRoute: BRANCH_ROUTE,
    });
    expect(JSON.stringify(delivered)).not.toContain('br-secret-name');
  });

  it('records unmatched for a path the spec has no route for, from the cached spec', async () => {
    const fetched = specRequests;

    const { isError, properties } = await callTool('call_api', {
      method: 'DELETE',
      path: '/nope/x',
    });

    expect(isError).toBe(true);
    expect(properties).toMatchObject({
      apiMethod: 'DELETE',
      apiRoute: 'unmatched',
    });
    expect(specRequests).toBe(fetched);
  });

  it('adds no route properties to other tools', async () => {
    const { properties } = await callTool('get_branch', {
      project_id: 'proj-1',
      branch_id: 'br-secret-name',
    });

    expect(properties).not.toHaveProperty('apiMethod');
    expect(properties).not.toHaveProperty('apiRoute');
  });
});
