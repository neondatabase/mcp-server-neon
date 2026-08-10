/**
 * End-to-end MCP server tests.
 *
 * These tests connect a real MCP client to a real server instance via the
 * in-memory transport and perform actual tool calls over MCP protocol.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { z } from 'zod';

const { trackSpy } = vi.hoisted(() => ({ trackSpy: vi.fn() }));

vi.mock('../analytics/analytics', () => ({
  track: trackSpy,
  flushAnalytics: vi.fn().mockResolvedValue(undefined),
}));

const { createMcpServer } = await import('../server/index');
import type { ServerContext } from '../types/context';
import { INSPECT_CHECKS } from '../inspect/queries';

const originalFetch = globalThis.fetch;

const listedInspectSchema = z.object({
  properties: z.object({
    params: z.object({
      properties: z.object({ check: z.object({ enum: z.array(z.string()) }) }),
      required: z.array(z.string()),
    }),
  }),
});

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
      const queryLogsTool = result.tools.find(
        (tool) => tool.name === 'query_logs',
      );
      const listLogFieldsTool = result.tools.find(
        (tool) => tool.name === 'list_log_fields',
      );
      const listLogFieldValuesTool = result.tools.find(
        (tool) => tool.name === 'list_log_field_values',
      );

      expect(toolNames).toContain('query_logs');
      expect(toolNames).toContain('list_log_fields');
      expect(toolNames).toContain('list_log_field_values');
      expect(queryLogsTool?.description).toContain(
        'For structured queries, pick the source',
      );
      expect(queryLogsTool?.description).toContain(
        'The returned preferred `logql` field',
      );
      expect(listLogFieldsTool?.description).toContain(
        'currently returns `service_name`, `severity_text`, `scope_name`, and `entity_type`',
      );
      expect(listLogFieldsTool?.description).toContain(
        'Call this tool instead of hardcoding that set',
      );
      expect(queryLogsTool?.inputSchema).toMatchObject({
        type: 'object',
        properties: {
          logql: { type: 'string' },
          query: {
            type: 'string',
            description: expect.stringContaining(
              'overriding any structured filters',
            ),
          },
          since: {
            type: 'string',
            description: expect.stringContaining(
              'maximum supported window is `7d`',
            ),
          },
          startTime: {
            type: 'string',
            description: expect.stringContaining(
              'must not span more than seven days',
            ),
          },
        },
      });
      expect(listLogFieldValuesTool?.description).toContain('server scan cap');
      expect(listLogFieldValuesTool?.inputSchema).toMatchObject({
        type: 'object',
        properties: {
          field: { type: 'string', minLength: 1 },
          since: {
            type: 'string',
            description: expect.stringContaining(
              'maximum supported window is `7d`',
            ),
          },
        },
      });
    });
  });

  it('exposes every inspect_database check in the listed JSON Schema', async () => {
    await withConnectedClient(createTestContext(), async (client) => {
      const result = await client.listTools();
      const inspectTool = result.tools.find(
        (tool) => tool.name === 'inspect_database',
      );

      expect(inspectTool?.annotations?.readOnlyHint).toBe(true);
      const schema = listedInspectSchema.parse(inspectTool?.inputSchema);
      expect(schema.properties.params.properties.check.enum).toEqual([
        ...INSPECT_CHECKS,
      ]);
      expect(schema.properties.params.required).toContain('check');
    });
  });

  it('rejects an inspect_database check outside the catalog', async () => {
    await withConnectedClient(createTestContext(), async (client) => {
      const result = await client.callTool({
        name: 'inspect_database',
        arguments: { params: { projectId: 'project-1', check: 'cache-hit' } },
      });

      expect(result.isError).toBe(true);
      // Naming the rejected value proves schema validation refused it, rather
      // than the call reaching Postgres and failing there.
      expect(JSON.stringify(result.content)).toContain('cache-hit');
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
        arguments: {},
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
        arguments: { slug: 'docs/guides/prisma' },
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
        arguments: { slug: 'https://evil.example/bad' },
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
          arguments: {},
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
