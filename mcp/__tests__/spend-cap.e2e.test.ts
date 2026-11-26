import { once } from 'node:events';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import type { GrantContext } from '../utils/grant-context';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { ServerContext } from '../types/context';

const observed = {
  spending_limit_cents: 10_000,
  spend_cap_enabled: true,
  current_usage_cents: 10_042,
  usage_observed_at: '2026-11-25T09:00:00Z',
  invoice_period_id: 'current-invoice',
  status: 'reached',
  enforcement_status: 'pending',
  generation: 3,
  period_ends_at: '2026-12-01T00:00:00Z',
  monitoring_delay: '1-2 hours',
  warning: 'Observed usage has reached the cap; suspension is being applied.',
};

type RequestLog = {
  method: string;
  path: string;
  body: string;
  auth: string | undefined;
  agent: string | undefined;
};

type BillingFixture = {
  response: object;
  code: string;
  requests: RequestLog[];
};

const fixture: BillingFixture = { response: observed, code: '', requests: [] };

const answerApi = async (req: IncomingMessage, res: ServerResponse) => {
  req.setEncoding('utf8');

  const chunks: string[] = [];

  for await (const chunk of req) {
    chunks.push(z.string().parse(chunk));
  }

  fixture.requests.push({
    method: req.method ?? '',
    path: req.url ?? '',
    body: chunks.join(''),
    auth: req.headers.authorization,
    agent: req.headers['user-agent'],
  });
  res.writeHead(fixture.code ? 403 : 200, {
    'content-type': 'application/json',
  });
  res.end(
    JSON.stringify(
      fixture.code
        ? { message: 'Denied by policy', code: fixture.code }
        : fixture.response,
    ),
  );
};

const api = createServer((req, res) => {
  answerApi(req, res).catch(() => {
    res.destroy(new Error('Fixture request failed'));
  });
});

api.listen(0, '127.0.0.1');

await once(api, 'listening');

const address = z.object({ port: z.number() }).parse(api.address());

process.env.NEON_API_HOST = `http://127.0.0.1:${address.port}/api/v2`;

process.env.ANALYTICS_WRITE_KEY = '';

process.env.SENTRY_DSN = '';

const { createMcpServer } = await import('../server/index');
const { isServerError } = await import('../server/errors');
const { NeonAuthError } = await import('@neon/sdk');

const context: ServerContext = {
  apiKey: 'test-key',
  authMethod: 'api_key_org',
  account: { id: 'org-1', name: 'Disposable fixture', isOrg: true },
  app: {
    name: 'billing-test',
    transport: 'stream',
    environment: 'test',
    version: '1',
  },
};

const withClient = async <T>(
  run: (client: Client) => Promise<T>,
  overrides: Partial<ServerContext> = {},
) => {
  const server = await createMcpServer({ ...context, ...overrides });
  const client = new Client({ name: 'billing-test', version: '1' });

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
};

const names = [
  'get_organization_spend_cap',
  'set_organization_spend_cap',
  'disable_organization_spend_cap',
];

describe('organization spend-cap MCP protocol', () => {
  beforeEach(() => {
    fixture.response = observed;
    fixture.code = '';
    fixture.requests.length = 0;
  });

  afterAll(() => {
    api.closeAllConnections();
    api.close();
  });

  it('registers flat schemas with read and mutation annotations', async () => {
    await withClient(async (client) => {
      const { tools } = await client.listTools();

      for (const name of names) {
        const tool = tools.find((candidate) => candidate.name === name);
        expect(tool?.inputSchema.required).toContain('org_id');
        expect(tool?.annotations).toMatchObject({
          readOnlyHint: name.startsWith('get_'),
          destructiveHint: !name.startsWith('get_'),
          idempotentHint: true,
        });
      }
    });
  });

  it('renders usage, pending acknowledgement, warnings and every structured status field', async () => {
    await withClient(async (client) => {
      const result = await client.callTool({
        name: names[0],
        arguments: { org_id: 'org-1' },
      });

      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({ data: observed });
      const text = JSON.stringify(result.content);

      for (const expected of [
        '$100.00',
        '$100.42',
        'pending',
        observed.warning,
        '1-2 hours',
        'Storage charges continue',
        'not that all workloads finished',
      ]) {
        expect(text).toContain(expected);
      }

      expect(fixture.requests).toHaveLength(1);
      expect(fixture.requests[0]).toMatchObject({
        method: 'GET',
        path: '/api/v2/organizations/org-1/billing/spending_limit',
        auth: 'Bearer test-key',
      });
      expect(fixture.requests[0].agent).toMatch(/^mcp-server-neon\//u);
    });
  });

  it('reports unsupported status without inventing off, applied or zero usage', async () => {
    fixture.response = { spending_limit_cents: 10_000 };
    await withClient(async (client) => {
      const result = await client.callTool({
        name: names[0],
        arguments: { org_id: 'org-1' },
      });

      expect(result.structuredContent).toMatchObject({
        data: { spending_limit_cents: 10_000 },
      });
      expect(result.structuredContent).not.toHaveProperty(
        'data.spend_cap_enabled',
      );
      expect(result.structuredContent).not.toHaveProperty(
        'data.enforcement_status',
      );
      expect(JSON.stringify(result.content)).toContain(
        'unavailable or unsupported',
      );
      expect(JSON.stringify(result.content)).toContain('usage: unavailable');
    });
  });

  it.each([{}, { spend_cap_enabled: true }, { spend_cap_enabled: false }])(
    'set forwards explicit enforcement %s',
    async (enforcement) => {
      await withClient(async (client) => {
        const args = {
          org_id: 'org-1',
          spending_limit_cents: 10_000,
          ...enforcement,
        };

        const result = await client.callTool({
          name: names[1],
          arguments: args,
        });

        expect(result.isError).not.toBe(true);
        const { org_id: _, ...body } = args;
        expect(fixture.requests.map((r) => r.method)).toStrictEqual(['PUT']);
        expect(JSON.parse(fixture.requests[0].body)).toStrictEqual(body);
        expect(JSON.stringify(result.content)).toContain(
          'Configuration accepted',
        );
        expect(result.structuredContent).toMatchObject({
          data: { enforcement_status: 'pending', warning: observed.warning },
        });
      });
    },
  );

  it('disable preserves notification amount with GET followed by PUT', async () => {
    fixture.response = {
      spending_limit_cents: 32_125,
      spend_cap_enabled: false,
      enforcement_status: 'pending',
    };
    await withClient(async (client) => {
      const result = await client.callTool({
        name: names[2],
        arguments: { org_id: 'org-1' },
      });

      expect(result.isError).not.toBe(true);
      expect(fixture.requests.map((r) => r.method)).toStrictEqual([
        'GET',
        'PUT',
      ]);
      expect(JSON.parse(fixture.requests[1].body)).toStrictEqual({
        spending_limit_cents: 32_125,
        spend_cap_enabled: false,
      });
      expect(result.structuredContent).toMatchObject({
        data: { spending_limit_cents: 32_125, enforcement_status: 'pending' },
      });
    });
  });

  it('formats maximum safe cents without floating-point rounding', async () => {
    fixture.response = {
      spending_limit_cents: Number.MAX_SAFE_INTEGER,
      current_usage_cents: 1,
    };
    await withClient(async (client) => {
      const result = await client.callTool({
        name: names[0],
        arguments: { org_id: 'org-1' },
      });

      expect(result.isError).not.toBe(true);
      expect(JSON.stringify(result.content)).toContain('$90071992547409.91');
      expect(JSON.stringify(result.content)).toContain('$0.01');
    });
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '100.00'])(
    'rejects invalid cents %s without network access',
    async (amount) => {
      await withClient(async (client) => {
        const result = await client.callTool({
          name: names[1],
          arguments: { org_id: 'org-1', spending_limit_cents: amount },
        });

        expect(result.isError).toBe(true);
        expect(fixture.requests).toHaveLength(0);
      });
    },
  );

  it('withholds writes in read-only mode', async () => {
    await withClient(
      async (client) => {
        const { tools } = await client.listTools();
        expect(tools.map((t) => t.name)).toContain(names[0]);
        expect(tools.map((t) => t.name)).not.toContain(names[1]);
        expect(tools.map((t) => t.name)).not.toContain(names[2]);
        await expect(
          client.callTool({ name: names[2], arguments: { org_id: 'org-1' } }),
        ).rejects.toMatchObject({ code: -32_602 });
        expect(fixture.requests).toHaveLength(0);
      },
      { readOnly: true },
    );
  });

  const grants: GrantContext[] = [
    { projectId: 'p-1', scopes: null },
    { projectId: null, scopes: ['querying'] },
  ];

  it.each(grants)(
    'withholds organization tools outside the projects grant: %j',
    async (grant) => {
      await withClient(
        async (client) => {
          const { tools } = await client.listTools();

          for (const name of names) {
            expect(tools.map((tool) => tool.name)).not.toContain(name);
          }
        },
        { grant },
      );
    },
  );

  it.each([
    [
      'SPEND_CAP_EXCEEDED',
      'An Organization Admin can increase or disable the spend cap in Organization Billing. Storage charges continue; recovery is asynchronous and other restrictions can remain.',
    ],
    [
      'INSUFFICIENT_ORG_PERMISSIONS',
      'An Organization Admin must perform this action.',
    ],
  ])(
    'preserves %s on an existing blocked tool without retry or server-error classification',
    async (code, action) => {
      fixture.code = code;
      await withClient(async (client) => {
        const result = await client.callTool({
          name: 'describe_project',
          arguments: { project_id: 'p-1' },
        });

        expect(result.isError).toBe(true);
        expect(result.structuredContent).toMatchObject({
          error: {
            code,
            status: 403,
            message: 'Denied by policy',
            action,
          },
        });
        expect(JSON.stringify(result.content)).toContain('Organization Admin');
        expect(fixture.requests).toHaveLength(1);
        expect(
          isServerError(
            new NeonAuthError('Denied by policy', { status: 403, code }),
          ),
        ).toBe(false);
      });
    },
  );

  it('preserves an admin write denial and sends no fallback DELETE', async () => {
    fixture.code = 'INSUFFICIENT_ORG_PERMISSIONS';
    await withClient(async (client) => {
      const result = await client.callTool({
        name: names[1],
        arguments: {
          org_id: 'org-1',
          spending_limit_cents: 10_000,
          spend_cap_enabled: true,
        },
      });

      expect(result.structuredContent).toMatchObject({
        error: { code: fixture.code, status: 403 },
      });
      expect(fixture.requests.map((r) => r.method)).toStrictEqual(['PUT']);
    });
  });
});
