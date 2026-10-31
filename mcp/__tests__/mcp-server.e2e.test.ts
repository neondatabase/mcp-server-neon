/**
 * End-to-end MCP server tests.
 *
 * These tests connect a real MCP client to a real server instance via the
 * in-memory transport and perform actual tool calls over MCP protocol.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { z } from 'zod';

const { trackSpy } = vi.hoisted(() => ({ trackSpy: vi.fn() }));

vi.mock('../analytics/analytics', () => ({
  track: trackSpy,
  flushAnalytics: vi.fn().mockResolvedValue(undefined),
}));

const { createMcpServer } = await import('../server/index');
import type { ServerContext } from '../types/context';
import { INSPECT_CHECKS, INSPECT_CHECK_LIST } from '../inspect/queries';

const originalFetch = globalThis.fetch;

const listedInspectSchema = z.object({
  properties: z.object({
    check: z.object({
      enum: z.array(z.string()),
      description: z.string(),
    }),
    database_name: z.object({ description: z.string() }).optional(),
  }),
  required: z.array(z.string()),
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
      const docsTool = result.tools.find((tool) => tool.name === 'search_docs');

      expect(toolNames).toContain('search_docs');
      expect(toolNames).toContain('get_doc');
      expect(toolNames).not.toContain('list_docs_resources');
      expect(toolNames).not.toContain('get_doc_resource');
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
      expect(toolNames).toContain('reset_from_parent');
      expect(toolNames).toContain('compare_database_schema');
      expect(toolNames).not.toContain('reset_from_parent_branches');
      expect(toolNames).not.toContain('compare_schema_branches');
      expect(queryLogsTool?.inputSchema).toMatchObject({
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          branch_id: { type: 'string' },
        },
      });
      expect(listLogFieldsTool?.inputSchema).toMatchObject({
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          branch_id: { type: 'string' },
        },
      });
      expect(listLogFieldValuesTool?.inputSchema).toMatchObject({
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          branch_id: { type: 'string' },
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
      expect(schema.properties.check.enum).toEqual([...INSPECT_CHECKS]);
      expect(schema.properties.check.description).toContain(INSPECT_CHECK_LIST);
      expect(schema.required).toContain('check');
      expect(schema.properties.database_name?.description).toContain('Omit');
      expect(schema.properties.database_name?.description).toContain(
        'does not include `databaseName`',
      );
    });
  });

  it('rejects an inspect_database check outside the catalog', async () => {
    await withConnectedClient(createTestContext(), async (client) => {
      const result = await client.callTool({
        name: 'inspect_database',
        arguments: { project_id: 'project-1', check: 'cache-hit' },
      });

      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain(
        'Input validation error: Invalid arguments for tool inspect_database',
      );
    });
  });

  it('calls search_docs through MCP protocol and returns get_doc slugs', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      Response.json({
        hits: [
          {
            url: 'https://neon.com/postgresql/tutorial/joins',
            title: 'PostgreSQL Joins',
            slug: 'postgresql/tutorial/joins',
            collection: 'postgresql',
            category: 'postgresql',
            breadcrumb: ['Learn PostgreSQL', 'Tutorial'],
            heading: 'PostgreSQL Joins > Inner join',
            excerpt: 'An inner join returns matching rows.',
            score: 3.1,
          },
        ],
      }),
    );

    await withConnectedClient(createTestContext(), async (client) => {
      const result = await client.callTool({
        name: 'search_docs',
        arguments: { query: '  inner join ', categories: ['postgresql'] },
      });
      const content = result.content as Array<{ type: string; text?: string }>;

      expect(result.isError).not.toBe(true);
      const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0];
      expect(url).toMatch(/\/site-search$/);
      expect(new Headers(init?.headers).get('x-caller-source')).toBe('mcp');
      expect(JSON.parse(String(init?.body))).toEqual({
        query: 'inner join',
        categories: ['postgresql'],
        limit: 10,
      });
      expect(JSON.parse(content[0].text ?? '')).toEqual({
        hits: [
          {
            title: 'PostgreSQL Joins',
            url: 'https://neon.com/postgresql/tutorial/joins',
            slug: 'postgresql/tutorial/joins',
            category: 'postgresql',
            breadcrumb: ['Learn PostgreSQL', 'Tutorial'],
            heading: 'PostgreSQL Joins > Inner join',
            excerpt: 'An inner join returns matching rows.',
          },
        ],
      });
    });
  });

  it('returns search_docs upstream and network failures as tool errors', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(
        Response.json({ error: 'categories must be unique' }, { status: 400 }),
      )
      .mockRejectedValueOnce(new TypeError('fetch failed'));

    await withConnectedClient(createTestContext(), async (client) => {
      const rejected = await client.callTool({
        name: 'search_docs',
        arguments: { query: 'lsn' },
      });
      expect(rejected.isError).toBe(true);
      expect(JSON.stringify(rejected.content)).toContain(
        'categories must be unique',
      );

      const unreachable = await client.callTool({
        name: 'search_docs',
        arguments: { query: 'lsn' },
      });
      expect(unreachable.isError).toBe(true);
    });
  });

  it('calls get_doc and auto-appends .md through MCP protocol', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response('# Prisma Guide\n\nUse Prisma with Neon.', { status: 200 }),
    );

    await withConnectedClient(createTestContext(), async (client) => {
      const result = await client.callTool({
        name: 'get_doc',
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
        name: 'get_doc',
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
          name: 'get_doc',
          arguments: { slug: 'docs/introduction' },
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
        context: expect.objectContaining({ clientName: 'v0bot' }),
      }),
    );
    expect(trackSpy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        event: 'tool_call',
        properties: expect.objectContaining(attribution),
        context: expect.objectContaining({ clientName: 'v0bot' }),
      }),
    );
  });

  it('puts an unclassified handshake on server_init context', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response('# Neon Docs', { status: 200 }),
    );

    await withConnectedClient(
      createTestContext(),
      async (client) => {
        await client.callTool({
          name: 'get_doc',
          arguments: { slug: 'docs/introduction' },
        });
      },
      'UnclassifiedClient/0.1.0',
    );

    const attribution = {
      clientName: 'UnclassifiedClient/0.1.0',
      clientApplication: 'unknown',
    };
    expect(trackSpy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        event: 'server_init',
        properties: expect.objectContaining(attribution),
        context: expect.objectContaining({
          clientName: 'UnclassifiedClient/0.1.0',
        }),
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

        expect(toolNames).toContain('search_docs');
        expect(toolNames).toContain('get_doc');
        expect(toolNames).not.toContain('create_project');
        // Withheld even though it mutates nothing: the URI carries the branch
        // owner role's password, which works against the read-write compute.
        expect(toolNames).not.toContain('get_connection_string');
        expect(toolNames).toContain('run_sql');
        expect(toolNames).not.toContain('run_sql_transaction');
      },
    );
  });

  it('rejects run_sql_transaction as an unknown tool in read-only mode', async () => {
    await withConnectedClient(
      createTestContext({ readOnly: true }),
      async (client) => {
        await expect(
          client.callTool({
            name: 'run_sql_transaction',
            arguments: {
              project_id: 'proj_123',
              sql_statements: ['COMMIT', 'DROP TABLE t'],
            },
          }),
        ).rejects.toMatchObject({
          code: -32602,
          message: 'Tool run_sql_transaction not found',
        });
        expect(globalThis.fetch).not.toHaveBeenCalled();
      },
    );
  });

  it('keeps run_sql_transaction in write mode', async () => {
    await withConnectedClient(createTestContext(), async (client) => {
      const result = await client.listTools();
      const toolNames = result.tools.map((tool) => tool.name);

      expect(toolNames).toContain('run_sql_transaction');
    });
  });
});
