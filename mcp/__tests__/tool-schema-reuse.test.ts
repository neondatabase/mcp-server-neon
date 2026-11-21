/**
 * Every authenticated request builds its own MCP server. The SDK's validator
 * keeps each input schema it compiles, keyed by object identity, for the life
 * of the instance, so a server that publishes freshly built schemas retains
 * about 1.6 MiB per default-grant request until the instance runs out of memory.
 */

import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import type { CallToolResult } from '@modelcontextprotocol/client';
import { McpServer } from '@modelcontextprotocol/server';
import { Effect } from 'effect';
import { getHeapStatistics, setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { registerTools } from '../server/register-tools';
import type { ToolCall } from '../server/register-tools';
import { getAvailableTools } from '../tools/grant-filter';
import { toListedTool } from '../tools/listed-schema';
import { DEFAULT_GRANT } from '../utils/grant-context';
import type { GrantContext } from '../utils/grant-context';

type ToolList = { grant: GrantContext; readOnly: boolean };

const TOOL_LISTS = {
  write: { grant: DEFAULT_GRANT, readOnly: false },
  readOnly: { grant: DEFAULT_GRANT, readOnly: true },
  projectScoped: {
    grant: { projectId: 'proj-1', scopes: null },
    readOnly: false,
  },
  pinnedQuerying: {
    grant: { projectId: null, scopes: ['querying'], roleName: 'reader' },
    readOnly: false,
  },
  secretsNone: {
    grant: { projectId: null, scopes: null, secrets: 'none' },
    readOnly: false,
  },
} satisfies Record<string, ToolList>;

const MiB = 1024 * 1024;
const ROUNDS = 3;

const notCalled: ToolCall = () =>
  Effect.die(new Error('input validation should reject the call first'));

const createServer = ({ grant, readOnly }: ToolList) => {
  const server = new McpServer({ name: 'test', version: '0.0.0' });

  registerTools(server, getAvailableTools(grant, readOnly), notCalled);

  return server;
};

const retainedHeap = (): number => {
  setFlagsFromString('--expose-gc');
  runInNewContext('gc()');

  return getHeapStatistics().used_heap_size;
};

const createAndCloseServers = async (count: number) => {
  const lists = Object.values(TOOL_LISTS);

  await Promise.all(
    Array.from({ length: count }, async (_, index) =>
      createServer(lists[index % lists.length]).close(),
    ),
  );
};

const resultText = (result: CallToolResult): string =>
  result.content
    .map((part) => (part.type === 'text' ? part.text : part.type))
    .join('\n');

const listAndValidate = async (list: ToolList) => {
  const server = createServer(list);
  const client = new Client({ name: 'test-client', version: '1.0.0' });

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    const { tools } = await client.listTools();

    const invalid = await client.callTool({
      name: 'run_sql',
      arguments: { sql: 1 },
    });

    return {
      tools: tools.map(({ name, inputSchema }) => ({ name, inputSchema })),
      invalidRunSql: { isError: invalid.isError, text: resultText(invalid) },
    };
  } finally {
    await Promise.allSettled([client.close(), server.close()]);
  }
};

const expectedTools = ({ grant, readOnly }: ToolList) =>
  getAvailableTools(grant, readOnly)
    .map((tool) => toListedTool(tool))
    .map(({ name, inputSchema }) => ({ name, inputSchema }));

describe('tool input schemas across requests', () => {
  it('retains no memory per server once each schema is compiled', async () => {
    await createAndCloseServers(Object.keys(TOOL_LISTS).length);
    const before = retainedHeap();

    await createAndCloseServers(100);

    expect((retainedHeap() - before) / MiB).toBeLessThan(16);
  }, 60_000);

  it('lists and validates each grant the same however grants alternate', async () => {
    const lists = Object.entries(TOOL_LISTS);

    const runs = await Promise.all(
      Array.from({ length: ROUNDS * lists.length }, async (_, index) => {
        const [name, list] = lists[index % lists.length];

        return { name, observed: await listAndValidate(list) };
      }),
    );

    for (const [name, list] of lists) {
      const observed = runs
        .filter((run) => run.name === name)
        .map((run) => run.observed);

      const [first] = observed;

      expect(first.tools).toStrictEqual(expectedTools(list));
      expect(first.invalidRunSql.isError).toBe(true);
      expect(first.invalidRunSql.text).toContain('Input validation error');
      expect(observed).toStrictEqual(
        Array.from({ length: ROUNDS }, () => first),
      );
    }
  });
});
