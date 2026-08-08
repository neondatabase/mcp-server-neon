/**
 * End-to-end MCP server tests.
 *
 * These tests connect a real MCP client to a real server instance via the
 * in-memory transport and perform actual tool calls over MCP protocol.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const { trackSpy } = vi.hoisted(() => ({ trackSpy: vi.fn() }));

vi.mock('../analytics/analytics', () => ({
  track: trackSpy,
  flushAnalytics: vi.fn().mockResolvedValue(undefined),
}));

const { createMcpServer } = await import('../server/index');
import type { ServerContext } from '../types/context';
import { INSPECT_CHECKS } from '../inspect/queries';

const originalFetch = globalThis.fetch;

function createTestContext(overrides?: Partial<ServerContext>): ServerContext {
  return {
    apiKey: 'test-api-key',
    authMethod: 'api_key_user',
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
  clientName = 'test-client',
): Promise<T> {
  const server = await createMcpServer(context);
  const client = new Client({ name: clientName, version: '1.0.0' });
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
    trackSpy.mockClear();
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('lists docs tools through MCP listTools', async () => {
    await withConnectedClient(createTestContext(), async (client) => {
      const result = await client.listTools();
      const toolNames = result.tools.map((tool) => tool.name);
      const docsTool = result.tools.find(
        (tool) => tool.name === 'list_docs_resources',
      );

      expect(toolNames).toContain('list_docs_resources');
      expect(toolNames).toContain('get_doc_resource');
      // Regression guard: MCP listTools must return JSON Schema, not raw Zod
      // internals. Raw Zod objects can cause runtime failures for some clients.
      expect(docsTool?.inputSchema).toMatchObject({
        type: 'object',
      });
      expect(String(docsTool?.inputSchema)).not.toContain('_def');
    });
  });

  it('lists observability (logs) tools through MCP listTools', async () => {
    await withConnectedClient(createTestContext(), async (client) => {
      const result = await client.listTools();
      const toolNames = result.tools.map((tool) => tool.name);

      expect(toolNames).toContain('query_logs');
      expect(toolNames).toContain('list_log_fields');
      expect(toolNames).toContain('list_log_field_values');
    });
  });

  it('exposes every inspect_database check in the listed JSON Schema', async () => {
    await withConnectedClient(createTestContext(), async (client) => {
      const result = await client.listTools();
      const inspectTool = result.tools.find(
        (tool) => tool.name === 'inspect_database',
      );

      expect(inspectTool?.annotations?.readOnlyHint).toBe(true);
      const params = (
        inspectTool?.inputSchema.properties as Record<string, unknown>
      ).params as { properties: { check: { enum: string[] } } };
      expect(params.properties.check.enum).toEqual([...INSPECT_CHECKS]);
    });
  });

  it('rejects an inspect_database check outside the catalog', async () => {
    await withConnectedClient(createTestContext(), async (client) => {
      const result = await client.callTool({
        name: 'inspect_database',
        arguments: { params: { projectId: 'project-1', check: 'cache-hit' } },
      });

      expect(result.isError).toBe(true);
      // Rejected by schema validation, so it must never reach the Neon API.
      expect(globalThis.fetch).not.toHaveBeenCalled();
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
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
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

  // This server outlives the handshake, so `clientInfo` from `initialize` is
  // still the client identity when a tool is called later. Both events must
  // carry it, not just `server_init`.
  it('attributes tool calls to the client application, not just server_init', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response('# Neon Docs', { status: 200 }),
    );

    await withConnectedClient(
      createTestContext(),
      async (client) => {
        await client.callTool({
          name: 'list_docs_resources',
          arguments: { params: {} },
        });
      },
      'v0bot',
    );

    const attribution = { clientName: 'v0bot', clientApplication: 'v0' };
    expect(trackSpy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        event: 'server_init',
        properties: expect.objectContaining(attribution),
      }),
    );
    expect(trackSpy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        event: 'tool_call',
        properties: expect.objectContaining(attribution),
      }),
    );
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
