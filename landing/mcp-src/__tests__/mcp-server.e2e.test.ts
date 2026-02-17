/**
 * End-to-end MCP server tests.
 *
 * These tests connect a real MCP client to a real server instance via the
 * in-memory transport and perform actual tool calls over MCP protocol.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createMcpServer } from '../server/index';
import type { ServerContext } from '../types/context';

const originalFetch = globalThis.fetch;

function createTestContext(overrides?: Partial<ServerContext>): ServerContext {
  return {
    apiKey: 'test-api-key',
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
    ...overrides,
  };
}

async function withConnectedClient<T>(
  context: ServerContext,
  run: (client: Client) => Promise<T>,
): Promise<T> {
  const server = await createMcpServer(context);
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    return await run(client);
  } finally {
    await client.close();
    await server.close();
  }
}

describe('MCP server e2e tool calls', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('lists docs tools through MCP listTools', async () => {
    await withConnectedClient(createTestContext(), async (client) => {
      const result = await client.listTools();
      const toolNames = result.tools.map((tool) => tool.name);

      expect(toolNames).toContain('list_docs_resources');
      expect(toolNames).toContain('get_doc_resource');
    });
  });

  it('calls list_docs_resources through MCP protocol', async () => {
    const mockIndex =
      '# Neon Docs\n- [AI Concepts](https://neon.com/docs/ai/ai-concepts.md)';
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(mockIndex, { status: 200 }),
    );

    await withConnectedClient(createTestContext(), async (client) => {
      const result = await client.callTool({
        name: 'list_docs_resources',
        arguments: { params: {} },
      });
      const content = result.content as Array<{ type: string; text?: string }>;

      expect(result.isError).not.toBe(true);
      expect(content[0]).toMatchObject({
        type: 'text',
      });
      if (content[0].type === 'text') {
        expect(content[0].text).toContain('AI Concepts');
      }
    });
  });

  it('calls get_doc_resource and auto-appends .md through MCP protocol', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response('# Prisma Guide\n\nUse Prisma with Neon.', { status: 200 }),
    );

    await withConnectedClient(createTestContext(), async (client) => {
      const result = await client.callTool({
        name: 'get_doc_resource',
        arguments: { params: { slug: 'docs/guides/prisma' } },
      });
      const content = result.content as Array<{ type: string; text?: string }>;

      expect(result.isError).not.toBe(true);
      expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
        'https://neon.com/docs/guides/prisma.md',
      );
      expect(content[0].type).toBe('text');
    });
  });

  it('returns MCP tool error content for invalid slug', async () => {
    await withConnectedClient(createTestContext(), async (client) => {
      const result = await client.callTool({
        name: 'get_doc_resource',
        arguments: { params: { slug: 'https://evil.example/bad' } },
      });
      const content = result.content as Array<{ type: string; text?: string }>;

      expect(result.isError).toBe(true);
      expect(content[0].type).toBe('text');
      if (content[0].type === 'text') {
        expect(content[0].text).toContain(
          'Invalid doc slug: absolute URLs are not allowed',
        );
      }
    });
  });

  it('enforces read-only filtering at MCP tool registry level', async () => {
    await withConnectedClient(
      createTestContext({
        readOnly: true,
      }),
      async (client) => {
        const result = await client.listTools();
        const toolNames = result.tools.map((tool) => tool.name);

        expect(toolNames).toContain('list_docs_resources');
        expect(toolNames).toContain('get_doc_resource');
        expect(toolNames).not.toContain('create_project');
      },
    );
  });
});
