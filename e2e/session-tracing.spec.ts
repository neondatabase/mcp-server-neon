/**
 * E2E tests for session tracing: real MCP clients against the dev server,
 * asserting on the envelopes the server sends to the Sentry fixture.
 *
 *  - A 2025-era client gets an `Mcp-Session-Id` on `initialize` and sends it
 *    back, so every tool call of that connection carries one `mcp.session.id`
 *  - Two concurrent sessions keep their own ids on spans and logs
 *  - An agent mistake leaves the span ok; a server failure marks it failed,
 *    and its error event carries the session id
 *  - A 2026-07-28 request is never given a session id, and a client's
 *    `_meta.threadId` lands on the span as `gen_ai.conversation.id`
 */

import { request as httpRequest } from 'node:http';
import { test, expect } from '@playwright/test';
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { Client as LegacyClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport as LegacyStreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  SENTRY_FIXTURE_ITEMS_URL,
  type EnvelopeItem,
} from './sentry-fixture.js';

const PORT = process.env.E2E_PORT ?? '3100';
const DOCS_URL = new URL(`http://localhost:${PORT}/mcp?category=docs`);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type SpanRecord = {
  name: string;
  op: unknown;
  status: unknown;
  data: Record<string, unknown>;
};

type LogRecord = { body: unknown; attributes: Record<string, unknown> };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

// A tool span is the transaction itself when no HTTP server span encloses it,
// and one of its child spans otherwise.
function spansFrom(items: EnvelopeItem[]): SpanRecord[] {
  return items
    .filter((item) => item.type === 'transaction')
    .flatMap((item) => {
      const payload = record(item.payload);
      const trace = record(record(payload.contexts).trace);
      const root: SpanRecord = {
        name: String(payload.transaction),
        op: trace.op,
        status: trace.status,
        data: record(trace.data),
      };
      const children = Array.isArray(payload.spans) ? payload.spans : [];
      return [
        root,
        ...children.map((child) => {
          const span = record(child);
          return {
            name: String(span.description),
            op: span.op,
            status: span.status,
            data: record(span.data),
          };
        }),
      ];
    });
}

function logsFrom(items: EnvelopeItem[]): LogRecord[] {
  return items
    .filter((item) => item.type === 'log')
    .flatMap((item) => {
      const logs = record(item.payload).items;
      return Array.isArray(logs) ? logs : [];
    })
    .map((log) => {
      const entry = record(log);
      const attributes = Object.fromEntries(
        Object.entries(record(entry.attributes)).map(([key, value]) => [
          key,
          record(value).value,
        ]),
      );
      return { body: entry.body, attributes };
    });
}

async function sentryItems(): Promise<EnvelopeItem[]> {
  const response = await fetch(SENTRY_FIXTURE_ITEMS_URL);
  expect(response.ok).toBe(true);
  return (await response.json()) as EnvelopeItem[];
}

// Spans and logs leave the dev server in the background, after the response.
async function eventually<T>(
  read: (items: EnvelopeItem[]) => T | undefined,
): Promise<T> {
  let found: T | undefined;
  await expect
    .poll(
      async () => {
        found = read(await sentryItems());
        return found !== undefined;
      },
      { timeout: 20_000 },
    )
    .toBe(true);
  if (found === undefined) throw new Error('unreachable');
  return found;
}

function toolSpan(
  spans: SpanRecord[],
  toolName: string,
  sessionId: string,
): SpanRecord | undefined {
  return spans.find(
    (span) =>
      span.name === `tools/call ${toolName}` &&
      span.data['mcp.session.id'] === sessionId,
  );
}

async function connectLegacyClient(name: string) {
  const transport = new LegacyStreamableHTTPClientTransport(DOCS_URL);
  const client = new LegacyClient({ name, version: '1.0.0' });
  await client.connect(transport);
  const sessionId = transport.sessionId;
  if (sessionId === undefined) {
    throw new Error('The server did not assign a session id on initialize');
  }
  return { client, sessionId };
}

test.describe('Session tracing', () => {
  test('tool calls of one 2025-era session share the id the server assigned', async () => {
    const first = await connectLegacyClient('session-tracing-first');
    const second = await connectLegacyClient('session-tracing-second');
    try {
      expect(first.sessionId).toMatch(UUID);
      expect(second.sessionId).toMatch(UUID);
      expect(first.sessionId).not.toBe(second.sessionId);

      await Promise.all([
        first.client.callTool({
          name: 'search_docs',
          arguments: { query: 'lsn' },
        }),
        second.client.callTool({
          name: 'search_docs',
          arguments: { query: 'lsn' },
        }),
      ]);
      await first.client.callTool({
        name: 'get_doc',
        arguments: { slug: 'docs/reference/glossary' },
      });
      const feedbackCanary = `feedback-canary-${crypto.randomUUID()}`;
      await first.client.callTool({
        name: 'send_feedback',
        arguments: { feedback: feedbackCanary },
      });

      const chain = await eventually((items) => {
        const spans = spansFrom(items);
        const found = ['search_docs', 'get_doc', 'send_feedback'].map((tool) =>
          toolSpan(spans, tool, first.sessionId),
        );
        return found.every((span) => span !== undefined) ? found : undefined;
      });
      for (const span of chain) {
        expect(span?.op).toBe('mcp.server');
        expect(span?.status).toBe('ok');
        expect(span?.data).toMatchObject({
          'mcp.method.name': 'tools/call',
          'mcp.tool.result.is_error': false,
          docs_only: true,
        });
        expect(span?.data['mcp.tool.name']).toBe(span?.data.tool_name);
      }

      // get_doc fetches the page from the docs fixture: the outgoing request is
      // a child span of the tool call and must carry the session too.
      const fetchSpan = await eventually((items) =>
        spansFrom(items).find(
          (span) =>
            span.op === 'http.client' &&
            span.data['mcp.session.id'] === first.sessionId,
        ),
      );
      expect(fetchSpan.data['mcp.session.id']).toBe(first.sessionId);

      const secondSpan = await eventually((items) =>
        toolSpan(spansFrom(items), 'search_docs', second.sessionId),
      );
      expect(secondSpan.data['mcp.session.id']).toBe(second.sessionId);

      const firstLog = await eventually((items) =>
        logsFrom(items).find(
          (log) =>
            log.body === 'tool call (docs-only):' &&
            log.attributes['mcp.session.id'] === first.sessionId &&
            log.attributes.toolName === 'send_feedback',
        ),
      );
      expect(firstLog.attributes['mcp.session.id']).toBe(first.sessionId);

      // Tool arguments stay out of Sentry: the README says traces carry none.
      expect(JSON.stringify(await sentryItems())).not.toContain(feedbackCanary);
    } finally {
      await first.client.close();
      await second.client.close();
    }
  });

  test('an agent mistake keeps the span ok and a server failure does not', async () => {
    const { client, sessionId } = await connectLegacyClient(
      'session-tracing-errors',
    );
    try {
      const mistake = await client.callTool({
        name: 'get_doc',
        arguments: { slug: '../secrets' },
      });
      expect(mistake.isError).toBe(true);
      const failure = await client.callTool({
        name: 'search_docs',
        arguments: { query: 'fixture-500' },
      });
      expect(failure.isError).toBe(true);

      const mistakeSpan = await eventually((items) =>
        toolSpan(spansFrom(items), 'get_doc', sessionId),
      );
      expect(mistakeSpan.status).toBe('ok');
      expect(mistakeSpan.data).toMatchObject({
        'error.type': 'InvalidArgumentError',
        'mcp.tool.result.is_error': true,
      });

      const failureSpan = await eventually((items) =>
        toolSpan(spansFrom(items), 'search_docs', sessionId),
      );
      expect(failureSpan.status).toBe('internal_error');
      expect(failureSpan.data).toMatchObject({
        'error.type': 'Error',
        'mcp.tool.result.is_error': true,
      });

      const errorEvent = await eventually((items) =>
        items.find(
          (item) =>
            item.type === 'event' &&
            record(record(item.payload).tags)['mcp.session.id'] === sessionId,
        ),
      );
      expect(errorEvent.type).toBe('event');
    } finally {
      await client.close();
    }
  });

  test('an unauthenticated request is rejected before its body is read', async () => {
    // Session detection reads the body only after the token check, so a
    // request without credentials gets its 401 while its body is still open.
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = httpRequest(
        `http://localhost:${PORT}/mcp`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
          },
        },
        (res) => {
          resolve(res.statusCode);
          res.resume();
          req.destroy();
        },
      );
      req.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code !== 'ECONNRESET') reject(error);
      });
      req.setTimeout(10_000, () => {
        req.destroy();
        resolve(undefined);
      });
      req.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":');
    });
    expect(status).toBe(401);
  });

  test('a 2026-07-28 request gets no session id but keeps its conversation id', async ({
    request,
  }) => {
    const threadId = `e2e-thread-${crypto.randomUUID()}`;
    const transport = new StreamableHTTPClientTransport(DOCS_URL);
    const client = new Client(
      { name: 'session-tracing-modern', version: '1.0.0' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } },
    );
    try {
      await client.connect(transport);
      await client.callTool({
        name: 'get_doc',
        arguments: { slug: 'docs/reference/glossary' },
        _meta: { threadId },
      });
    } finally {
      await client.close();
    }

    const response = await request.post('/mcp?category=docs', {
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      data: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
    });
    expect(response.headers()['mcp-session-id']).toBeUndefined();

    const modernSpan = await eventually((items) =>
      spansFrom(items).find(
        (span) =>
          span.name === 'tools/call get_doc' &&
          span.data['gen_ai.conversation.id'] === threadId,
      ),
    );
    expect(modernSpan.data['mcp.session.id']).toBeUndefined();

    // Sessions from earlier requests on this server must not leak onto a
    // request that has none.
    const modernLog = await eventually((items) =>
      logsFrom(items).find(
        (log) => log.attributes['gen_ai.conversation.id'] === threadId,
      ),
    );
    expect(modernLog.attributes['mcp.session.id']).toBeUndefined();
  });
});
