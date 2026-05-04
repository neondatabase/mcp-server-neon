/**
 * E2E tests for the docs-only (no-auth) MCP endpoint.
 *
 * The strict docs-only mode (?category=docs with no other category and no
 * projectId) bypasses OAuth entirely so the docs tools can be embedded
 * anonymously. These tests run real HTTP requests against the dev server
 * and assert that:
 *  - No WWW-Authenticate header is returned
 *  - The MCP initialize handshake succeeds without an Authorization header
 *  - tools/list returns only the docs tools
 *  - Any other category combination still requires auth (401)
 */

import { test, expect, type APIResponse } from '@playwright/test';

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

  test('tools/list returns only the docs tools', async ({ request }) => {
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
    expect(toolNames).toEqual(['get_doc_resource', 'list_docs_resources']);
  });

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
    expect(callResult!.result!.content?.[0]?.text).toBeTruthy();
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
