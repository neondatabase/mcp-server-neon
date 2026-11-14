/**
 * What a client receives for every failing tool call today, and whether the
 * failure reached Sentry and failed the tool span. Real tools run through
 * `createMcpServer` against a local Neon API, a local SQL-over-HTTP endpoint,
 * and the e2e Sentry stand-in; the golden file is the contract a change to the
 * tool-call pipeline must keep.
 */
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { once } from 'node:events';
import { text } from 'node:stream/consumers';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { neonConfig } from '@neondatabase/serverless';
import {
  flush,
  getActiveSpan,
  getClient,
  init,
  spanToJSON,
  startSpan,
} from '@sentry/node';
import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ServerContext } from '../types/context';

const PROJECT = {
  notFound: 'proj-not-found',
  forbidden: 'proj-forbidden',
  serverError: 'proj-server-error',
  network: 'proj-network',
  sql: 'proj-sql',
  tuning: 'proj-tuning',
  cancelled: 'proj-cancelled',
} as const;

// The cancelled call's upstream request is never answered; it arrives here.
const cancelledRequest = Promise.withResolvers<true>();

const BRANCH_ID = 'br-main-123';
const DATABASE = 'neondb';
const OWNER = 'neondb_owner';

const BRANCH = {
  id: BRANCH_ID,
  project_id: PROJECT.sql,
  parent_id: 'br-parent-123',
  name: 'main',
  default: true,
  protected: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  compute_time_seconds: 0,
  written_data_bytes: 0,
  data_transfer_bytes: 0,
};

const DATABASE_RECORD = {
  id: 1,
  branch_id: BRANCH_ID,
  name: DATABASE,
  owner_name: OWNER,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

const json = (res: ServerResponse, status: number, body: Json) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const answerApi = (req: IncomingMessage, res: ServerResponse) => {
  const [path = ''] = (req.url ?? '').replace(/^\/api\/v2/u, '').split('?');

  if (path === '/users/me/organizations') {
    json(res, 200, { organizations: [] });

    return;
  }

  if (path.startsWith(`/projects/${PROJECT.notFound}`)) {
    json(res, 404, { code: '', message: 'project not found' });

    return;
  }

  if (path.startsWith(`/projects/${PROJECT.forbidden}`)) {
    json(res, 403, {
      code: 'FEATURE_NOT_AVAILABLE',
      message: 'This feature is not available on your plan',
      reason: 'plan_limit',
    });

    return;
  }

  if (
    path.startsWith(`/projects/${PROJECT.serverError}`) ||
    path.startsWith(`/projects/${PROJECT.tuning}`)
  ) {
    json(res, 500, { message: 'internal server error' });

    return;
  }

  if (path.startsWith(`/projects/${PROJECT.cancelled}`)) {
    cancelledRequest.resolve(true);

    return;
  }

  if (path.startsWith(`/projects/${PROJECT.network}`)) {
    req.socket.destroy();

    return;
  }

  const sqlProject = `/projects/${PROJECT.sql}`;
  const sqlBranch = `${sqlProject}/branches/${BRANCH_ID}`;

  if (path === `${sqlProject}/connection_uri`) {
    json(res, 200, {
      uri: `postgresql://${OWNER}:password@ep-test-123.example.test/${DATABASE}?sslmode=require`,
    });

    return;
  }

  if (path === `${sqlProject}/branches`) {
    json(res, 200, { branches: [BRANCH] });

    return;
  }

  if (path === sqlBranch) {
    json(res, 200, { branch: BRANCH });

    return;
  }

  if (path === `${sqlBranch}/databases`) {
    json(res, 200, { databases: [DATABASE_RECORD] });

    return;
  }

  if (path === `${sqlBranch}/databases/${DATABASE}`) {
    json(res, 200, { database: DATABASE_RECORD });

    return;
  }

  json(res, 404, { message: `no fake for ${path}` });
};

const api = createServer(answerApi);

const answerSql = async (req: IncomingMessage, res: ServerResponse) => {
  const body = await text(req);

  if (body.includes('endpoint down')) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('upstream connect error');

    return;
  }

  json(res, 400, {
    message: 'column "missing_column" does not exist',
    code: '42703',
    position: '8',
    hint: 'Perhaps you meant to reference the column "t.column".',
    detail: 'There is a column named "column" in table "t".',
    where: 'PL/pgSQL function report() line 3 at RETURN',
    severity: 'ERROR',
  });
};

const sqlEndpoint = createServer((req, res) => {
  void answerSql(req, res);
});

api.listen(0, '127.0.0.1');

sqlEndpoint.listen(0, '127.0.0.1');

await Promise.all([once(api, 'listening'), once(sqlEndpoint, 'listening')]);

const portOf = (server: typeof api) =>
  z.object({ port: z.number() }).parse(server.address()).port;

process.env.NEON_API_HOST = `http://127.0.0.1:${portOf(api)}/api/v2`;

process.env.ANALYTICS_WRITE_KEY = '';

process.env.SENTRY_DSN = '';

process.env.E2E_SENTRY_PORT = '3113';

neonConfig.fetchEndpoint = `http://127.0.0.1:${portOf(sqlEndpoint)}/sql`;

const {
  SENTRY_FIXTURE_DSN,
  SENTRY_FIXTURE_ITEMS_URL,
  startSentryFixtureServer,
} = await import('../../e2e/sentry-fixture');

const { createMcpServer } = await import('../server/index');

const sentry = await startSentryFixtureServer();

init({ dsn: SENTRY_FIXTURE_DSN, tracesSampleRate: 1 });

const context: ServerContext = {
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
};

const connect = async (serverContext: ServerContext) => {
  const server = await createMcpServer(serverContext);
  const client = new Client({ name: 'tool-error-results', version: '1.0.0' });

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);

  await client.connect(clientTransport);

  return client;
};

const unscoped = await connect(context);

const scoped = await connect({
  ...context,
  grant: { projectId: PROJECT.sql, scopes: null },
});

type Case = {
  client: Client;
  name: string;
  arguments: Record<string, Json>;
};

const CASES = {
  'unknown tool': { client: unscoped, name: 'no_such_tool', arguments: {} },
  'input fails the listed schema': {
    client: unscoped,
    name: 'describe_project',
    arguments: { project_id: 123 },
  },
  'project_id does not match a scoped connection': {
    client: scoped,
    name: 'describe_project',
    arguments: { project_id: 'proj-other' },
  },
  'project_id missing on an unscoped connection': {
    client: unscoped,
    name: 'describe_branch',
    arguments: { branch_id: BRANCH_ID },
  },
  'no organizations': {
    client: unscoped,
    name: 'list_projects',
    arguments: {},
  },
  'input fails a refinement the listed schema omits': {
    client: unscoped,
    name: 'search_docs',
    arguments: { query: 'branching', categories: ['docs', 'docs'] },
  },
  'SDK rejects a path parameter': {
    client: unscoped,
    name: 'run_sql',
    arguments: { project_id: '.', sql: 'select 1' },
  },
  'Neon API 404': {
    client: unscoped,
    name: 'describe_project',
    arguments: { project_id: PROJECT.notFound },
  },
  'Neon API 403 with a reason': {
    client: unscoped,
    name: 'describe_project',
    arguments: { project_id: PROJECT.forbidden },
  },
  'Neon API 500': {
    client: unscoped,
    name: 'describe_project',
    arguments: { project_id: PROJECT.serverError },
  },
  'network failure': {
    client: unscoped,
    name: 'describe_project',
    arguments: { project_id: PROJECT.network },
  },
  'Postgres rejects the statement': {
    client: unscoped,
    name: 'run_sql',
    arguments: { project_id: PROJECT.sql, sql: 'select missing_column' },
  },
  'SQL endpoint fails': {
    client: unscoped,
    name: 'run_sql',
    arguments: { project_id: PROJECT.sql, sql: 'select 1 /* endpoint down */' },
  },
  'query tuning completion fails': {
    client: unscoped,
    name: 'complete_query_tuning',
    arguments: {
      project_id: PROJECT.tuning,
      tuning_id: 'tuning-123',
      database_name: DATABASE,
      temporary_branch_id: 'br-temp-123',
      suggested_sql_statements: ['create index on t (c)'],
    },
  },
} satisfies Record<string, Case>;

const Rejection = z.object({ code: z.number(), message: z.string() });

const response = async ({ client, name, arguments: args }: Case) => {
  try {
    return await client.callTool({ name, arguments: args });
  } catch (error) {
    return { rejected: Rejection.parse(error) };
  }
};

const call = async (testCase: Case) =>
  startSpan({ name: 'tool error case', op: 'test' }, async () => {
    const traceId = getActiveSpan()?.spanContext().traceId;

    return { traceId, response: await response(testCase) };
  });

const toolSpanEnded = async (toolName: string) => {
  const { promise, resolve } = Promise.withResolvers<true>();

  const unsubscribe = getClient()?.on('spanEnd', (span) => {
    if (spanToJSON(span).description === `tools/call ${toolName}`) {
      unsubscribe?.();
      resolve(true);
    }
  });

  return promise;
};

const CANCELLED = {
  client: unscoped,
  name: 'list_branches',
  arguments: { project_id: PROJECT.cancelled },
} satisfies Case;

// The client gets no result for a cancelled call, so the case waits for the
// server's tool span to end before its trace is read.
const cancelledCall = async () =>
  startSpan({ name: 'tool error case', op: 'test' }, async () => {
    const traceId = getActiveSpan()?.spanContext().traceId;
    const ended = toolSpanEnded(CANCELLED.name);
    const controller = new AbortController();

    const settled = CANCELLED.client
      .callTool(
        { name: CANCELLED.name, arguments: CANCELLED.arguments },
        { signal: controller.signal },
      )
      .then(
        () => 'resolved',
        () => 'rejected',
      );

    await cancelledRequest.promise;

    controller.abort();

    const client = await settled;

    await ended;

    return { traceId, response: { cancelledByClient: client } };
  });

const Trace = z.object({
  trace_id: z.string(),
  status: z.string().optional(),
});

const SentryItem = z.object({ type: z.string(), payload: z.unknown() });

const ErrorEvent = z.object({ contexts: z.object({ trace: Trace }) });

const Transaction = z.object({
  transaction: z.string(),
  contexts: z.object({ trace: Trace }),
  spans: z.array(
    z.object({ description: z.string().optional(), status: z.string() }),
  ),
});

const sentryItems = async () => {
  await flush(5000);
  const fetched = await fetch(SENTRY_FIXTURE_ITEMS_URL);

  return z.array(SentryItem).parse(await fetched.json());
};

type SentryItems = Awaited<ReturnType<typeof sentryItems>>;

const payloadsOf = <T>(
  items: SentryItems,
  type: string,
  schema: z.ZodType<T>,
) =>
  items
    .filter((item) => item.type === type)
    .map((item) => schema.parse(item.payload));

const toolSpanStatus = (
  items: SentryItems,
  traceId: string | undefined,
  toolName: string,
) =>
  payloadsOf(items, 'transaction', Transaction)
    .filter(({ contexts }) => contexts.trace.trace_id === traceId)
    .flatMap(({ spans }) => spans)
    .find(({ description }) => description === `tools/call ${toolName}`)
    ?.status ?? 'absent';

const errorEventCount = (items: SentryItems, traceId: string | undefined) =>
  payloadsOf(items, 'event', ErrorEvent).filter(
    ({ contexts }) => contexts.trace.trace_id === traceId,
  ).length;

const goldenEntries = async () => {
  const outcomes = await Promise.all([
    ...Object.entries(CASES).map(async ([caseName, testCase]) => ({
      caseName,
      testCase,
      outcome: await call(testCase),
    })),
    cancelledCall().then((outcome) => ({
      caseName: 'client cancels the call',
      testCase: CANCELLED,
      outcome,
    })),
  ]);

  const items = await sentryItems();

  return Object.fromEntries(
    outcomes.map(({ caseName, testCase, outcome }) => [
      caseName,
      {
        tool: testCase.name,
        arguments: testCase.arguments,
        response: outcome.response,
        sentryErrorEvents: errorEventCount(items, outcome.traceId),
        toolSpan: toolSpanStatus(items, outcome.traceId, testCase.name),
      },
    ]),
  );
};

describe('tool error results', () => {
  afterAll(async () => {
    await unscoped.close();
    await scoped.close();
    api.close();
    sqlEndpoint.close();
    sentry.close();
  });

  it('match the golden file', async () => {
    const golden = `${JSON.stringify(await goldenEntries(), null, 2)}\n`;

    await expect(golden).toMatchFileSnapshot(
      './__snapshots__/tool-error-results.json',
    );
  });
});
