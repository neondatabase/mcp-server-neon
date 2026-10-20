/**
 * E2E tests for the docs-only (no-auth) MCP endpoint.
 *
 * The strict docs-only mode (?category=docs with no other category and no
 * projectId) bypasses OAuth entirely so the docs tools can be embedded
 * anonymously. These tests run real HTTP requests against the dev server
 * and assert that:
 *  - No WWW-Authenticate header is returned
 *  - The MCP initialize handshake succeeds without an Authorization header
 *  - tools/list returns the docs tools and send_feedback
 *  - tools/call search_docs returns hits and reports upstream failures
 *  - tools/call send_feedback works without auth
 *  - Any other category combination still requires auth (401)
 */

import { test, expect, type APIResponse } from '@playwright/test';
import { DOCS_FIXTURE_MARKER } from './docs-fixture.js';

async function callDocsTool(
  request: import('@playwright/test').APIRequestContext,
  id: number,
  name: string,
  args: Record<string, unknown>,
) {
  const response = await request.post('/mcp?category=docs', {
    headers: MCP_HEADERS,
    data: {
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name, arguments: args },
    },
  });
  expect(response.status()).toBeLessThan(300);
  const messages = await readJsonRpcMessages(response);
  return messages.find((m) => m.id === id) as
    | {
        result?: {
          content?: Array<{ type: string; text?: string }>;
          isError?: boolean;
        };
        error?: { message?: string };
      }
    | undefined;
}

const MCP_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
};

type JsonRpcRequest = {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
};

const initializeRequest: JsonRpcRequest = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'docs-only-e2e', version: '1.0.0' },
  },
};

// The MCP streamable transport may answer with either a JSON body or an
// SSE stream depending on negotiation. Parse both.
async function readJsonRpcMessages(
  response: APIResponse,
): Promise<Array<Record<string, unknown>>> {
  const contentType = response.headers()['content-type'] ?? '';
  const body = await response.text();

  if (contentType.includes('text/event-stream')) {
    const messages: Array<Record<string, unknown>> = [];
    for (const line of body.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('data:')) {
        const dataPart = trimmed.slice('data:'.length).trim();
        if (!dataPart) continue;
        messages.push(JSON.parse(dataPart));
      }
    }
    return messages;
  }

  if (!body) return [];
  const parsed = JSON.parse(body);
  return Array.isArray(parsed) ? parsed : [parsed];
}

test.describe('Docs-only MCP endpoint (no OAuth)', () => {
  test('initialize succeeds without Authorization header on ?category=docs', async ({
    request,
  }) => {
    const response = await request.post('/mcp?category=docs', {
      headers: MCP_HEADERS,
      data: initializeRequest,
    });

    expect(
      response.status(),
      `expected 2xx but got ${response.status()}: ${await response.text()}`,
    ).toBeLessThan(300);
    expect(response.headers()['www-authenticate']).toBeUndefined();

    const messages = await readJsonRpcMessages(response);
    const initResult = messages.find((m) => m.id === 1);
    expect(initResult).toBeDefined();
    expect(initResult).toMatchObject({
      jsonrpc: '2.0',
      result: expect.objectContaining({
        serverInfo: expect.objectContaining({ name: 'mcp-server-neon' }),
      }),
    });
  });

  test('tools/list returns the docs tools and send_feedback', async ({
    request,
  }) => {
    const response = await request.post('/mcp?category=docs', {
      headers: MCP_HEADERS,
      data: {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      },
    });
    expect(response.status()).toBeLessThan(300);
    expect(response.headers()['www-authenticate']).toBeUndefined();

    const messages = await readJsonRpcMessages(response);
    const listResult = messages.find((m) => m.id === 2) as
      | { result?: { tools?: Array<{ name: string }> } }
      | undefined;
    expect(listResult?.result?.tools).toBeDefined();

    const toolNames = listResult!.result!.tools!.map((t) => t.name).sort();
    expect(toolNames).toEqual([
      'get_doc_resource',
      'list_docs_resources',
      'search_docs',
      'send_feedback',
    ]);
  });

  // Reads the docs index from the fixture server that `playwright.config.ts`
  // points NEON_DOCS_INDEX_URL at, so this stays deterministic and off the
  // network while still exercising the real handler and fetch.
  test('tools/call list_docs_resources returns the markdown index', async ({
    request,
  }) => {
    const response = await request.post('/mcp?category=docs', {
      headers: MCP_HEADERS,
      data: {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'list_docs_resources', arguments: {} },
      },
    });
    expect(response.status()).toBeLessThan(300);

    const messages = await readJsonRpcMessages(response);
    const callResult = messages.find((m) => m.id === 3) as
      | {
          result?: {
            content?: Array<{ type: string; text?: string }>;
            isError?: boolean;
          };
        }
      | undefined;
    expect(callResult?.result).toBeDefined();
    expect(callResult!.result!.isError).not.toBe(true);
    expect(callResult!.result!.content?.[0]?.type).toBe('text');
    // Matching the fixture's marker proves the index was fetched and returned,
    // rather than the tool answering with an error string or an empty body.
    expect(callResult!.result!.content?.[0]?.text).toContain(
      DOCS_FIXTURE_MARKER,
    );
  });

  // Posts to the site search stand-in that `playwright.config.ts` points
  // NEON_SITE_SEARCH_URL at; the query selects the fixture response.
  test('tools/call search_docs returns hits with a get_doc_resource slug', async ({
    request,
  }) => {
    const callResult = await callDocsTool(request, 10, 'search_docs', {
      query: 'lsn',
      categories: ['docs'],
    });
    expect(callResult?.result?.isError).not.toBe(true);
    expect(JSON.parse(callResult!.result!.content![0]!.text!)).toEqual({
      hits: [
        {
          title: 'Glossary',
          url: 'https://neon.com/docs/reference/glossary',
          slug: 'docs/reference/glossary',
          category: 'docs',
          breadcrumb: ['Docs'],
          heading: 'Glossary > LSN',
          excerpt:
            'Log Sequence Number. A byte offset to a location in the WAL stream.',
        },
      ],
    });
  });

  test('tools/call search_docs returns an empty list when nothing matches', async ({
    request,
  }) => {
    const callResult = await callDocsTool(request, 11, 'search_docs', {
      query: 'fixture-empty',
    });
    expect(callResult?.result?.isError).not.toBe(true);
    expect(JSON.parse(callResult!.result!.content![0]!.text!)).toEqual({
      hits: [],
    });
  });

  test('tools/call search_docs reports upstream failures as tool errors', async ({
    request,
  }) => {
    const cases: Array<[string, RegExp]> = [
      ['fixture-400', /query must be 500 characters or fewer/],
      ['fixture-500', /HTTP 500/],
      ['fixture-not-json', /not JSON/],
      ['fixture-malformed', /unexpected response: hits\.0 /],
    ];
    let id = 20;
    for (const [query, message] of cases) {
      const callResult = await callDocsTool(request, id++, 'search_docs', {
        query,
      });
      expect(callResult?.result?.isError, query).toBe(true);
      expect(callResult!.result!.content?.[0]?.text, query).toMatch(message);
    }
  });

  test('tools/call search_docs rejects invalid arguments', async ({
    request,
  }) => {
    const invalid: Array<Record<string, unknown>> = [
      { query: '   ' },
      { query: 'x'.repeat(501) },
      { query: 'lsn', limit: 0 },
      { query: 'lsn', limit: 1.5 },
      { query: 'lsn', categories: [] },
      { query: 'lsn', categories: ['docs', 'docs'] },
      { query: 'lsn', categories: ['nope'] },
      { query: 'lsn', maxResults: 5 },
    ];
    let id = 40;
    for (const args of invalid) {
      const callResult = await callDocsTool(request, id++, 'search_docs', args);
      const failed =
        callResult?.error !== undefined || callResult?.result?.isError === true;
      expect(failed, JSON.stringify(args)).toBe(true);
    }
  });

  // Posts to the feedback stand-in that `playwright.config.ts` points
  // NEON_FEEDBACK_URL at, so no real feedback is sent.
  test('tools/call send_feedback works without auth', async ({ request }) => {
    const response = await request.post('/mcp?category=docs', {
      headers: MCP_HEADERS,
      data: {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'send_feedback',
          arguments: { feedback: 'e2e docs-only feedback' },
        },
      },
    });
    expect(response.status()).toBeLessThan(300);
    expect(response.headers()['www-authenticate']).toBeUndefined();

    const messages = await readJsonRpcMessages(response);
    const callResult = messages.find((m) => m.id === 4) as
      | {
          result?: {
            content?: Array<{ type: string; text?: string }>;
            isError?: boolean;
          };
        }
      | undefined;
    expect(callResult?.result).toBeDefined();
    expect(callResult!.result!.isError).not.toBe(true);
    expect(callResult!.result!.content?.[0]?.text).toBe(
      'Feedback received. Thank you!',
    );
  });

  test('mixed categories still require auth', async ({ request }) => {
    const response = await request.post('/mcp?category=docs,querying', {
      headers: MCP_HEADERS,
      data: initializeRequest,
    });

    expect(response.status()).toBe(401);
    expect(response.headers()['www-authenticate']).toBeTruthy();
  });

  test('docs category combined with projectId still requires auth', async ({
    request,
  }) => {
    const response = await request.post(
      '/mcp?category=docs&projectId=proj-123',
      {
        headers: MCP_HEADERS,
        data: initializeRequest,
      },
    );

    expect(response.status()).toBe(401);
    expect(response.headers()['www-authenticate']).toBeTruthy();
  });
});
