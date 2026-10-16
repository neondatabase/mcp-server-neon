import { describe, expect, it } from 'vitest';
import { SERVER_HOST } from '../../lib/config';

const { GET, POST } = await import('../../app/api/[transport]/route');
const mcpUrl = new URL('/mcp', SERVER_HOST).href;

const MCP_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
};

function legacyToolsListRequest(origin?: string): Request {
  return new Request('http://localhost/api/mcp?category=docs', {
    method: 'POST',
    headers: {
      ...MCP_HEADERS,
      ...(origin ? { Origin: origin } : {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    }),
  });
}

describe('stateless MCP transport boundary', () => {
  it.each([
    ['GET', 'http://localhost/api/sse', GET],
    ['GET', 'http://localhost/sse', GET],
    ['POST', 'http://localhost/api/message?sessionId=old', POST],
    ['POST', 'http://localhost/message?sessionId=old', POST],
  ])('returns 410 for retired %s %s', async (_method, url, handler) => {
    const response = await handler(new Request(url, { method: _method }));

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      error: 'transport_gone',
      message: `HTTP+SSE was removed. Connect to ${mcpUrl} using Streamable HTTP. Stdio-only clients can bridge it with \`npx -y mcp-remote ${mcpUrl}\`. See https://neon.com/docs/ai/neon-mcp-server#retired-sse.`,
    });
  });

  it('returns 404 instead of serving MCP on an unknown dynamic route', async () => {
    const response = await POST(
      new Request('http://localhost/api/not-mcp?category=docs', {
        method: 'POST',
      }),
    );

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe('');
  });

  it('rejects an untrusted Origin before docs-only and auth handling', async () => {
    const response = await POST(
      legacyToolsListRequest('https://attacker.example'),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Invalid Origin: attacker.example',
      },
      id: null,
    });
  });

  it('accepts the configured development Origin', async () => {
    const response = await POST(
      legacyToolsListRequest('http://localhost:3000'),
    );

    expect(response.status).toBe(200);
  });
});
