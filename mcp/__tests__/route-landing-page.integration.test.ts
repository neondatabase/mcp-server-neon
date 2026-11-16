import { describe, expect, it } from 'vitest';

import { GET, HEAD, POST } from '../../app/api/[transport]/route';
import {
  GET as getMarkdown,
  HEAD as headMarkdown,
} from '../../app/mcp.md/route';
import { NEON_TOOLS } from '../tools/definitions';

const MCP_URL = 'https://mcp.neon.tech/mcp';

const BROWSER_ACCEPT = 'text/html,application/xhtml+xml,*/*;q=0.8';

const get = async (url: string, headers: Record<string, string> = {}) =>
  GET(new Request(url, { method: 'GET', headers }));

describe('landing page at the MCP URL', () => {
  it('answers a browser navigation with the landing page', async () => {
    const response = await get(MCP_URL, { Accept: BROWSER_ACCEPT });

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe(
      'text/html; charset=utf-8',
    );
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');

    const body = await response.text();

    expect(body).toContain(
      '<h1 id="hero-title">Neon MCP Server <span class="version">',
    );
    expect(body).toContain('claude mcp add --transport http');
    expect(body).toContain('cursor://anysphere.cursor-deeplink/mcp/install');
    expect(body).toContain('vscode:mcp/install?');
    expect(body).toContain(`Tools (${NEON_TOOLS.length})`);
    expect(body).toContain('<code>run_sql</code>');
  });

  it('runs only its own nonce-tagged scripts and styles', async () => {
    const response = await get(MCP_URL, { Accept: BROWSER_ACCEPT });
    const csp = String(response.headers.get('Content-Security-Policy'));
    const body = await response.text();

    const tags = [...body.matchAll(/<(?:script|style)\b[^>]*>/gu)].map(
      ([tag]) => tag,
    );

    const nonces = new Set(
      tags.map((tag) =>
        tag.replace(/^.* nonce="(?<nonce>[^"]+)".*$/su, '$<nonce>'),
      ),
    );

    expect(csp).toContain("default-src 'none'");
    expect(tags).toHaveLength(2);
    expect(nonces.size).toBe(1);
    expect(csp).toContain(`'nonce-${[...nonces].join('')}'`);
  });

  it('serves the docs-only URL the same way', async () => {
    const response = await get(`${MCP_URL}?category=docs`, {
      Accept: BROWSER_ACCEPT,
    });

    expect(response.status).toBe(200);
  });

  it('points the HTML page at its Markdown version', async () => {
    const response = await get(MCP_URL, { Accept: BROWSER_ACCEPT });

    expect(response.headers.get('Link')).toBe(
      '</mcp.md>; rel="alternate"; type="text/markdown"',
    );
    await expect(response.text()).resolves.toContain(
      '<link rel="alternate" type="text/markdown" href="/mcp.md">',
    );
  });

  it('answers an Accept of text/markdown with the Markdown page', async () => {
    const response = await get(MCP_URL, { Accept: 'text/markdown' });

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe(
      'text/markdown; charset=utf-8',
    );
    expect(response.headers.get('Content-Security-Policy')).toBeNull();

    const body = await response.text();

    expect(body).toMatch(/^# Neon MCP Server\n/u);
    expect(body).toContain('claude mcp add --transport http');
    expect(body).toContain(`## Tools (${NEON_TOOLS.length})`);
    expect(body).toContain('- `run_sql` (read-only): ');
  });

  it('serves the Markdown page at /mcp.md whatever the Accept', async () => {
    const response = await getMarkdown(
      new Request('https://mcp.neon.tech/mcp.md', {
        headers: { Accept: '*/*' },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe(
      'text/markdown; charset=utf-8',
    );
    await expect(response.text()).resolves.toMatch(/^# Neon MCP Server\n/u);
  });

  it('answers a HEAD for /mcp.md with headers and no body', async () => {
    const response = await headMarkdown(
      new Request('https://mcp.neon.tech/mcp.md', { method: 'HEAD' }),
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('');
  });

  it('answers a browser HEAD with the page headers and no body', async () => {
    const response = await HEAD(
      new Request(MCP_URL, {
        method: 'HEAD',
        headers: { Accept: BROWSER_ACCEPT },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe(
      'text/html; charset=utf-8',
    );
    await expect(response.text()).resolves.toBe('');
  });

  it('keeps the OAuth challenge for a wildcard GET', async () => {
    const response = await get(MCP_URL, { Accept: '*/*' });

    expect(response.status).toBe(401);
    expect(response.headers.get('WWW-Authenticate')).toContain(
      'resource_metadata=',
    );
  });

  it('keeps the OAuth challenge for an anonymous SSE GET', async () => {
    const response = await get(MCP_URL, { Accept: 'text/event-stream' });

    expect(response.status).toBe(401);
  });

  it('keeps the OAuth challenge for an anonymous POST', async () => {
    const response = await POST(
      new Request(MCP_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {},
        }),
      }),
    );

    expect(response.status).toBe(401);
  });
});
