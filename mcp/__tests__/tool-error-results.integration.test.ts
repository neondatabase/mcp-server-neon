/**
 * What a client receives for every failing tool call today, and whether the
 * failure reached Sentry and failed the tool span. Each case is a stateless
 * `POST /mcp` through the deployed route handler, against a local Neon API, a
 * local SQL-over-HTTP endpoint, and the e2e Sentry stand-in; the golden file is
 * the contract a change to the tool-call pipeline must keep.
 */
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { once } from 'node:events';
import { text } from 'node:stream/consumers';
import { neonConfig } from '@neondatabase/serverless';
import {
  flush,
  getActiveSpan,
  getClient,
  httpIntegration,
  init,
  spanToJSON,
  startSpan,
} from '@sentry/node';
import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

const PROJECT = {
  notFound: 'proj-not-found',
  forbidden: 'proj-forbidden',
  serverError: 'proj-server-error',
  network: 'proj-network',
  sql: 'proj-sql',
  tuning: 'proj-tuning',
  cancelled: 'proj-cancelled',
} as const;

// A cancelled call's upstream request is never answered; its arrival is the
// point the client cancels.
const cancelledApiRequest = Promise.withResolvers<true>();
const cancelledSqlRequest = Promise.withResolvers<true>();
const cancelledSearchRequest = Promise.withResolvers<true>();

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

const SQL_PROJECT = `/projects/${PROJECT.sql}`;
const SQL_BRANCH = `${SQL_PROJECT}/branches/${BRANCH_ID}`;

const ROUTES = new Map<string, Json>([
  ['/auth', { auth_method: 'api_key_user', account_id: 'user_test_123' }],
  [
    '/users/me',
    { id: 'user_test_123', name: 'Test User', email: 'test@example.com' },
  ],
  ['/users/me/organizations', { organizations: [] }],
  [
    `${SQL_PROJECT}/connection_uri`,
    {
      uri: `postgresql://${OWNER}:password@ep-test-123.example.test/${DATABASE}?sslmode=require`,
    },
  ],
  [`${SQL_PROJECT}/branches`, { branches: [BRANCH] }],
  [SQL_BRANCH, { branch: BRANCH }],
  [`${SQL_BRANCH}/databases`, { databases: [DATABASE_RECORD] }],
  [`${SQL_BRANCH}/databases/${DATABASE}`, { database: DATABASE_RECORD }],
]);

const FAILING_PROJECTS = new Map<string, { status: number; body: Json }>([
  [
    PROJECT.notFound,
    { status: 404, body: { code: '', message: 'project not found' } },
  ],
  [
    PROJECT.forbidden,
    {
      status: 403,
      body: {
        code: 'FEATURE_NOT_AVAILABLE',
        message: 'This feature is not available on your plan',
        reason: 'plan_limit',
      },
    },
  ],
  [
    PROJECT.serverError,
    { status: 500, body: { message: 'internal server error' } },
  ],
  [PROJECT.tuning, { status: 500, body: { message: 'internal server error' } }],
]);

const answerApi = (req: IncomingMessage, res: ServerResponse) => {
  const [path = ''] = (req.url ?? '').replace(/^\/api\/v2/u, '').split('?');
  const route = ROUTES.get(path);

  if (route !== undefined) {
    json(res, 200, route);

    return;
  }

  const projectId =
    /^\/projects\/(?<projectId>[^/]+)/u.exec(path)?.groups?.projectId ?? '';

  if (projectId === PROJECT.cancelled) {
    cancelledApiRequest.resolve(true);

    return;
  }

  if (path === '/site-search') {
    cancelledSearchRequest.resolve(true);

    return;
  }

  if (projectId === PROJECT.network) {
    req.socket.destroy();

    return;
  }

  const failure = FAILING_PROJECTS.get(projectId);

  if (failure !== undefined) {
    json(res, failure.status, failure.body);

    return;
  }

  json(res, 404, { message: `no fake for ${path}` });
};

const api = createServer(answerApi);

const answerSql = async (req: IncomingMessage, res: ServerResponse) => {
  const body = await text(req);

  if (body.includes('cancelled by the client')) {
    cancelledSqlRequest.resolve(true);

    return;
  }

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

process.env.NEON_SITE_SEARCH_URL = `http://127.0.0.1:${portOf(api)}/site-search`;

// The route reads OAuth tokens and the API-key cache before verifying a key.
// A closed port makes those reads fail at once, as the route tolerates, so the
// test never reaches an inherited database.
process.env.OAUTH_DATABASE_URL = 'postgresql://127.0.0.1:1/golden';

neonConfig.fetchEndpoint = `http://127.0.0.1:${portOf(sqlEndpoint)}/sql`;

const {
  SENTRY_FIXTURE_DSN,
  SENTRY_FIXTURE_ITEMS_URL,
  startSentryFixtureServer,
} = await import('../../e2e/sentry-fixture');

const { POST } = await import('../../app/api/[transport]/route');

const { SERVER_HOST } = await import('../../lib/config');

const sentry = await startSentryFixtureServer();

// The local Neon API and SQL endpoint run in this process; tracing their
// incoming requests fills the transport buffer, which then drops error events.
init({
  dsn: SENTRY_FIXTURE_DSN,
  tracesSampleRate: 1,
  integrations: [httpIntegration({ ignoreIncomingRequests: () => true })],
});

// Tool span status by trace, read when the server ends the span: the exporter
// sends transactions on a timer of its own, and a cancelled request's
// transaction may never be sent.
const toolSpanStatus = new Map<string, string>();
const toolSpanWaiters = new Map<string, (ended: true) => void>();

const toolSpanEnded = async (traceId: string) => {
  const { promise, resolve } = Promise.withResolvers<true>();

  toolSpanWaiters.set(traceId, resolve);

  return promise;
};

getClient()?.on('spanEnd', (span) => {
  const { description, status } = spanToJSON(span);

  if (description?.startsWith('tools/call ') === true) {
    const { traceId } = span.spanContext();

    toolSpanStatus.set(traceId, status ?? 'unset');
    toolSpanWaiters.get(traceId)?.(true);
  }
});

type Case = {
  /** Connection query string: none, a scoped project, or docs-only. */
  query: '' | `?projectId=${string}` | '?category=docs';
  name: string;
  arguments: Record<string, Json>;
};

const CASES = {
  'unknown tool': { query: '', name: 'no_such_tool', arguments: {} },
  'input fails the listed schema': {
    query: '',
    name: 'describe_project',
    arguments: { project_id: 123 },
  },
  'project_id does not match a scoped connection': {
    query: `?projectId=${PROJECT.sql}`,
    name: 'describe_project',
    arguments: { project_id: 'proj-other' },
  },
  'project_id missing on an unscoped connection': {
    query: '',
    name: 'describe_branch',
    arguments: { branch_id: BRANCH_ID },
  },
  'no organizations': { query: '', name: 'list_projects', arguments: {} },
  'input fails a refinement the listed schema omits': {
    query: '',
    name: 'search_docs',
    arguments: { query: 'branching', categories: ['docs', 'docs'] },
  },
  'docs-only connection, input fails a refinement': {
    query: '?category=docs',
    name: 'search_docs',
    arguments: { query: 'branching', categories: ['docs', 'docs'] },
  },
  'SDK rejects a path parameter': {
    query: '',
    name: 'run_sql',
    arguments: { project_id: '.', sql: 'select 1' },
  },
  'Neon API 404': {
    query: '',
    name: 'describe_project',
    arguments: { project_id: PROJECT.notFound },
  },
  'Neon API 403 with a reason': {
    query: '',
    name: 'describe_project',
    arguments: { project_id: PROJECT.forbidden },
  },
  'Neon API 500': {
    query: '',
    name: 'describe_project',
    arguments: { project_id: PROJECT.serverError },
  },
  'network failure': {
    query: '',
    name: 'describe_project',
    arguments: { project_id: PROJECT.network },
  },
  'Postgres rejects the statement': {
    query: '',
    name: 'run_sql',
    arguments: { project_id: PROJECT.sql, sql: 'select missing_column' },
  },
  'SQL endpoint fails': {
    query: '',
    name: 'run_sql',
    arguments: { project_id: PROJECT.sql, sql: 'select 1 /* endpoint down */' },
  },
  'query tuning completion fails': {
    query: '',
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

const toolCall = (testCase: Case, signal?: AbortSignal) => {
  const headers = new Headers({
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'mcp-method': 'tools/call',
    'mcp-name': testCase.name,
  });

  if (testCase.query !== '?category=docs') {
    headers.set('authorization', 'Bearer test-api-key');
  }

  return new Request(`${SERVER_HOST}/mcp${testCase.query}`, {
    method: 'POST',
    headers,
    signal,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: testCase.name,
        arguments: testCase.arguments,
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientInfo': {
            name: 'tool-error-results',
            version: '1.0.0',
          },
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    }),
  });
};

const SERVER_INFO_META = 'io.modelcontextprotocol/serverInfo';

// Every result carries the same server metadata, package version included,
// which has its own tests; the golden leaves it out so a release bump doesn't
// change it.
const withoutServerInfo = (message: Json): Json =>
  z
    .json()
    .parse(
      JSON.parse(
        JSON.stringify(message, (key, value: Json) =>
          key === SERVER_INFO_META ? undefined : value,
        ),
      ),
    );

// A stateless response is either JSON or a single SSE message.
const jsonRpcMessage = async (response: Response) => {
  const body = await response.text();

  const data =
    response.headers.get('content-type')?.includes('event-stream') === true
      ? body
          .split('\n')
          .find((line) => line.startsWith('data: '))
          ?.slice('data: '.length)
      : body;

  return withoutServerInfo(z.json().parse(JSON.parse(data ?? 'null')));
};

const call = async (testCase: Case) =>
  startSpan({ name: 'tool error case', op: 'test' }, async () => {
    const traceId = getActiveSpan()?.spanContext().traceId;
    const response = await POST(toolCall(testCase));

    return {
      traceId,
      response: {
        status: response.status,
        message: await jsonRpcMessage(response),
      },
    };
  });

type Cancellation = Case & { upstreamReached: Promise<true> };

const CANCELLATIONS = {
  'client cancels the call': {
    query: '',
    name: 'list_branches',
    arguments: { project_id: PROJECT.cancelled },
    upstreamReached: cancelledApiRequest.promise,
  },
  'client cancels run_sql while the query runs': {
    query: '',
    name: 'run_sql',
    arguments: {
      project_id: PROJECT.sql,
      sql: 'select 1 /* cancelled by the client */',
    },
    upstreamReached: cancelledSqlRequest.promise,
  },
  'docs-only client cancels search_docs': {
    query: '?category=docs',
    name: 'search_docs',
    arguments: { query: 'branching' },
    upstreamReached: cancelledSearchRequest.promise,
  },
} satisfies Record<string, Cancellation>;

// A stateless client cancels by closing its request, so it reads no result;
// the case waits for the server's tool span to end before reading telemetry.
const cancelledCall = async (cancellation: Cancellation) =>
  startSpan({ name: 'tool error case', op: 'test' }, async () => {
    const traceId = getActiveSpan()?.spanContext().traceId;
    const ended = toolSpanEnded(traceId ?? '');
    const controller = new AbortController();
    const response = POST(toolCall(cancellation, controller.signal));

    await cancellation.upstreamReached;

    controller.abort();

    const { status } = await response;

    await ended;

    return { traceId, response: { cancelledByClient: true, status } };
  });

const Trace = z.object({
  trace_id: z.string(),
  status: z.string().optional(),
});

const SentryItem = z.object({ type: z.string(), payload: z.unknown() });

const ErrorEvent = z.object({ contexts: z.object({ trace: Trace }) });

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

const errorEventCount = (items: SentryItems, traceId: string | undefined) =>
  payloadsOf(items, 'event', ErrorEvent).filter(
    ({ contexts }) => contexts.trace.trace_id === traceId,
  ).length;

const goldenEntries = async () => {
  const caseOutcomes = await Promise.all(
    Object.entries(CASES).map(async ([caseName, testCase]) => ({
      caseName,
      testCase,
      outcome: await call(testCase),
    })),
  );

  const cancellationOutcomes = await Promise.all(
    Object.entries(CANCELLATIONS).map(async ([caseName, cancellation]) => ({
      caseName,
      testCase: cancellation,
      outcome: await cancelledCall(cancellation),
    })),
  );

  const outcomes = [...caseOutcomes, ...cancellationOutcomes];

  const items = await sentryItems();

  return Object.fromEntries(
    outcomes.map(({ caseName, testCase, outcome }) => [
      caseName,
      {
        tool: testCase.name,
        query: testCase.query,
        arguments: testCase.arguments,
        response: outcome.response,
        sentryErrorEvents: errorEventCount(items, outcome.traceId),
        toolSpan: toolSpanStatus.get(outcome.traceId ?? '') ?? 'absent',
      },
    ]),
  );
};

describe('tool error results', () => {
  afterAll(() => {
    api.closeAllConnections();
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
