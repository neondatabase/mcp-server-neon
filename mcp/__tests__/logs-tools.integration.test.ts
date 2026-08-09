/**
 * Contract tests for the logs tools against a real client facade and a loopback
 * Neon API. These cover what the stubbed-facade unit tests cannot: the request
 * that actually goes on the wire, and how a 4xx and a 5xx come back now that the
 * SDK raises them instead of a hand-rolled telemetry client.
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Api } from '../neon-client';

type Handlers = typeof import('../tools/tools').NEON_HANDLERS;
type HandleToolError = typeof import('../server/errors').handleToolError;
type NeonApiErrorClass = typeof import('@neon/sdk').NeonApiError;

type RecordedRequest = {
  method: string;
  path: string;
  search: string;
  body: unknown;
};

type Reply = { status: number; body: unknown };

const extra = {
  account: { id: 'acc-1' },
} as unknown as Parameters<Handlers['query_logs']>[2];

let server: Server;
let recorded: RecordedRequest[];
let replies: Record<string, Reply>;
let neonClient: Api<unknown>;
let NEON_HANDLERS: Handlers;
let handleToolError: HandleToolError;
let NeonApiError: NeonApiErrorClass;

beforeEach(async () => {
  recorded = [];
  replies = {};

  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString();
      recorded.push({
        method: req.method ?? '',
        path: url.pathname,
        search: url.search,
        body: raw ? JSON.parse(raw) : undefined,
      });

      const reply = replies[`${req.method} ${url.pathname}`] ?? {
        status: 404,
        body: { message: `no reply configured for ${url.pathname}` },
      };
      res.writeHead(reply.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(reply.body));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  // The API host is read once at module load, so the modules under test have to
  // be loaded after it points at the loopback server — otherwise these run
  // against the real Neon API.
  vi.resetModules();
  process.env.NEON_API_HOST = `http://127.0.0.1:${port}/api/v2`;

  const { createNeonClient } = await import('../neon-client');
  ({ NEON_HANDLERS } = await import('../tools/tools'));
  ({ handleToolError } = await import('../server/errors'));
  ({ NeonApiError } = await import('@neon/sdk'));
  neonClient = createNeonClient('test-api-key');
});

afterEach(async () => {
  delete process.env.NEON_API_HOST;
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

const QUERY_PATH = 'POST /api/v2/projects/proj-1/branches/br-1/logs/query';
const FIELDS_PATH = 'GET /api/v2/projects/proj-1/branches/br-1/logs/fields';
const VALUES_PATH =
  'GET /api/v2/projects/proj-1/branches/br-1/logs/fields/service_name/values';

function payloadOf(result: unknown) {
  const { content } = result as { content: Array<{ text: string }> };
  return JSON.parse(content[0].text);
}

describe('query_logs over the wire', () => {
  it('posts the compatibility LogQL query and the default window', async () => {
    replies[QUERY_PATH] = {
      status: 200,
      body: {
        logs: [
          {
            timestamp: '2026-07-16T09:30:00Z',
            message: 'boom',
            source: 'function',
            service_name: 'api',
            severity_text: 'ERROR',
            attributes: {},
          },
        ],
        is_truncated: false,
      },
    };

    const result = await NEON_HANDLERS.query_logs(
      {
        params: {
          projectId: 'proj-1',
          branchId: 'br-1',
          source: 'function',
          serviceName: 'api',
          minSeverity: 'error',
          limit: 100,
        },
      },
      neonClient,
      extra,
    );

    expect(recorded).toHaveLength(1);
    expect(recorded[0].body).toEqual({
      logql:
        '{entity_type="function", service_name="api", severity_text=~"(?i)(ERROR|FATAL)[0-9]*"}',
      since: '1h',
      limit: 100,
      sort_order: 'desc',
    });
    expect(payloadOf(result).records).toEqual([
      {
        timestamp: '2026-07-16T09:30:00.000Z',
        body: 'boom',
        entityType: 'function',
        serviceName: 'api',
        severity: 'ERROR',
      },
    ]);
  });

  it('posts a raw LogQL expression with no structured filters', async () => {
    replies[QUERY_PATH] = {
      status: 200,
      body: { logs: [], is_truncated: false },
    };

    await NEON_HANDLERS.query_logs(
      {
        params: {
          projectId: 'proj-1',
          branchId: 'br-1',
          source: 'function',
          query: '{entity_type="function"} |~ "(?i)timeout"',
          startTime: '2026-07-16T09:00:00Z',
          limit: 100,
        },
      },
      neonClient,
      extra,
    );

    expect(recorded[0].body).toEqual({
      logql: '{entity_type="function"} |~ "(?i)timeout"',
      start_time: '2026-07-16T09:00:00Z',
      limit: 100,
      sort_order: 'desc',
    });
  });

  it('reports truncation from the cursor the API issued', async () => {
    replies[QUERY_PATH] = {
      status: 200,
      body: {
        logs: [
          { timestamp: '2026-07-16T09:30:00Z', message: 'one', attributes: {} },
        ],
        next_cursor: 'cursor-1',
        is_truncated: true,
      },
    };

    const result = await NEON_HANDLERS.query_logs(
      {
        params: {
          projectId: 'proj-1',
          branchId: 'br-1',
          source: 'function',
          limit: 1,
        },
      },
      neonClient,
      extra,
    );

    // One page is consumed; the cursor is reported as truncation, not followed.
    expect(recorded).toHaveLength(1);
    expect(payloadOf(result).truncated).toBe(true);
  });

  it('raises a rejected query as a client error the caller can act on', async () => {
    replies[QUERY_PATH] = {
      status: 400,
      body: {
        code: 'invalid_query',
        message: 'both since and start_time were supplied',
        reason: 'conflicting_time_range',
      },
    };

    const error = await NEON_HANDLERS.query_logs(
      {
        params: {
          projectId: 'proj-1',
          branchId: 'br-1',
          source: 'function',
          limit: 100,
        },
      },
      neonClient,
      extra,
    ).catch((e: unknown) => e);

    if (!(error instanceof NeonApiError)) throw error;
    expect(error.status).toBe(400);
    // Under 500 the tool answers with the status and message instead of paging
    // on-call through Sentry.
    const handled = handleToolError(error, {});
    expect(handled.isError).toBe(true);
    expect(handled.content.map((part) => part.text)).toContain(
      '[HTTP 400] both since and start_time were supplied',
    );
  });

  it('raises a backend failure as a server error', async () => {
    replies[QUERY_PATH] = {
      status: 502,
      body: { code: 'internal_error', message: 'log backend unavailable' },
    };

    const error = await NEON_HANDLERS.query_logs(
      {
        params: {
          projectId: 'proj-1',
          branchId: 'br-1',
          source: 'function',
          limit: 100,
        },
      },
      neonClient,
      extra,
    ).catch((e: unknown) => e);

    if (!(error instanceof NeonApiError)) throw error;
    expect(error.status).toBe(502);
  });
});

describe('list_log_fields / list_log_field_values over the wire', () => {
  it('reads the branch fields', async () => {
    replies[FIELDS_PATH] = {
      status: 200,
      body: { fields: ['service_name', 'entity_type'] },
    };

    const result = await NEON_HANDLERS.list_log_fields(
      { params: { projectId: 'proj-1', branchId: 'br-1' } },
      neonClient,
      extra,
    );

    expect(recorded[0].method).toBe('GET');
    expect(payloadOf(result).fields).toEqual(['service_name', 'entity_type']);
  });

  it('passes the lookback window as a query parameter and surfaces truncation', async () => {
    replies[VALUES_PATH] = {
      status: 200,
      body: { values: ['api'], is_truncated: true },
    };

    const result = await NEON_HANDLERS.list_log_field_values(
      {
        params: {
          projectId: 'proj-1',
          branchId: 'br-1',
          field: 'service_name',
          since: '24h',
        },
      },
      neonClient,
      extra,
    );

    expect(recorded[0].search).toBe('?since=24h');
    expect(payloadOf(result)).toEqual({
      scope: { projectId: 'proj-1', branchId: 'br-1' },
      field: 'service_name',
      values: ['api'],
      truncated: true,
    });
  });

  it('raises an unknown field rather than answering with an empty list', async () => {
    replies[VALUES_PATH] = {
      status: 400,
      body: {
        code: 'invalid_query',
        message: 'service_nam is not a known log field',
        reason: 'unknown_field',
      },
    };

    const error = await NEON_HANDLERS.list_log_field_values(
      {
        params: {
          projectId: 'proj-1',
          branchId: 'br-1',
          field: 'service_name',
        },
      },
      neonClient,
      extra,
    ).catch((e: unknown) => e);

    if (!(error instanceof NeonApiError)) throw error;
    expect(error.status).toBe(400);
  });
});
