/**
 * Which tool calls the server sends again after the Neon API drops the
 * connection. Each case is a stateless `POST /mcp` through the deployed route
 * handler against a local Neon API that counts the requests it receives.
 */
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { once } from 'node:events';
import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { neonProject } from './helpers/neon-objects';

const PROJECT = {
  flaky: 'proj-flaky',
  down: 'proj-down',
} as const;

const requests = new Map<string, number>();

// `hang` holds the org lookup open, to cancel the call while it runs.
type OrgLookup = {
  mode: 'flaky' | 'hang';
  reached: PromiseWithResolvers<true>;
  closed: PromiseWithResolvers<true>;
};

const orgLookup: OrgLookup = {
  mode: 'flaky',
  reached: Promise.withResolvers<true>(),
  closed: Promise.withResolvers<true>(),
};

const countRequest = (key: string) => {
  const count = (requests.get(key) ?? 0) + 1;
  requests.set(key, count);

  return count;
};

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

const json = (res: ServerResponse, status: number, body: Json) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const answerApi = (req: IncomingMessage, res: ServerResponse) => {
  const [path = ''] = (req.url ?? '').replace(/^\/api\/v2/u, '').split('?');
  const key = `${req.method} ${path}`;
  const count = countRequest(key);

  if (path === '/auth') {
    json(res, 200, { auth_method: 'api_key_user', account_id: 'user_1' });

    return;
  }

  if (path === '/users/me') {
    json(res, 200, { id: 'user_1', name: 'Test', email: 'test@example.com' });

    return;
  }

  if (path === '/users/me/organizations') {
    if (orgLookup.mode === 'hang') {
      orgLookup.reached.resolve(true);
      req.on('close', () => {
        orgLookup.closed.resolve(true);
      });

      return;
    }

    // The first lookup is dropped; the next one answers.
    if (count > 1) {
      json(res, 200, {
        organizations: [{ id: 'org-1', name: 'Org', managed_by: 'console' }],
      });

      return;
    }
  }

  if (path === '/projects') {
    json(res, 200, { projects: [] });

    return;
  }

  // The first read is dropped; the next one answers.
  if (path === `/projects/${PROJECT.flaky}` && count > 1) {
    json(res, 200, {
      project: neonProject({ id: PROJECT.flaky, name: 'flaky' }),
    });

    return;
  }

  req.socket.destroy();
};

const api = createServer(answerApi);

api.listen(0, '127.0.0.1');

await once(api, 'listening');

const { port } = z.object({ port: z.number() }).parse(api.address());

process.env.NEON_API_HOST = `http://127.0.0.1:${port}/api/v2`;

process.env.ANALYTICS_WRITE_KEY = '';

process.env.SENTRY_DSN = '';

// A closed port makes the route's OAuth token and API-key cache reads fail at
// once, as the route tolerates, so the test never reaches a real database.
process.env.OAUTH_DATABASE_URL = 'postgresql://127.0.0.1:1/retries';

const { POST } = await import('../../app/api/[transport]/route');
const { SERVER_HOST } = await import('../../lib/config');

const toolCall = (
  name: string,
  args: Record<string, Json>,
  signal?: AbortSignal,
) =>
  new Request(`${SERVER_HOST}/mcp`, {
    method: 'POST',
    signal,
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
            name: 'tool-retries',
            version: '1.0.0',
          },
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    }),
  });

const callTool = async (name: string, args: Record<string, Json>) => {
  const response = await POST(toolCall(name, args));
  const body = await response.text();

  const data =
    response.headers.get('content-type')?.includes('event-stream') === true
      ? body
          .split('\n')
          .find((line) => line.startsWith('data: '))
          ?.slice('data: '.length)
      : body;

  return z
    .object({
      result: z.object({
        isError: z.boolean().optional(),
        content: z.array(
          z.object({ type: z.literal('text'), text: z.string() }),
        ),
      }),
    })
    .parse(JSON.parse(data ?? 'null')).result;
};

describe('tool retries', () => {
  afterAll(() => {
    api.close();
  });

  it('sends a read again after a dropped connection', async () => {
    const result = await callTool('describe_project', {
      project_id: PROJECT.flaky,
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain(PROJECT.flaky);
    expect(requests.get(`GET /projects/${PROJECT.flaky}`)).toBe(2);
  });

  it('gives up on a read after two retries', async () => {
    const result = await callTool('describe_project', {
      project_id: PROJECT.down,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/^NeonNetworkError: /u);
    expect(requests.get(`GET /projects/${PROJECT.down}`)).toBe(3);
  });

  it('sends the org lookup again after a dropped connection', async () => {
    const result = await callTool('list_projects', {});

    expect(result.isError).toBeUndefined();
    expect(requests.get('GET /users/me/organizations')).toBe(2);
  });

  it('closes the org lookup when the client cancels', async () => {
    orgLookup.mode = 'hang';
    const controller = new AbortController();
    const response = POST(toolCall('list_projects', {}, controller.signal));

    await orgLookup.reached.promise;
    controller.abort();
    await response.catch(() => undefined);

    await expect(orgLookup.closed.promise).resolves.toBe(true);
  });

  it('never sends a mutation again', async () => {
    const result = await callTool('create_branch', {
      project_id: PROJECT.down,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/^NeonNetworkError: /u);
    expect(requests.get(`POST /projects/${PROJECT.down}/branches`)).toBe(1);
  });
});
