import { vi } from 'vitest';

/**
 * Answers the Neon API requests the SQL tools make and the SQL-over-HTTP
 * requests `@neondatabase/serverless` sends, by stubbing global `fetch`. Both
 * the `@neon/tools` client and the serverless driver call it, so a test sees
 * which role each connection asked for and which SQL ran where.
 */

export const FAKE_PASSWORD = 'FAKE_TEST_PASSWORD_123';

type Cell = string | number | boolean | null;

export type FakeNeonOptions = {
  projectId: string;
  branchId: string;
  database: string;
  owner: string;
  /** Rows every SQL statement returns. */
  rows?: (sql: string) => Record<string, Cell>[];
  /** Overrides the response to `GET /connection_uri` for a role. */
  connectionUri?: (role: string) => Response | undefined;
  /** Overrides the response to a SQL request. */
  sqlResponse?: () => Response | undefined;
  /** Overrides the response to `DELETE` on a branch. */
  deleteBranch?: (branchId: string) => Response | undefined;
  /** Answers any other API path, given without the `/api/v2` prefix. */
  api?: (method: string, path: string) => Response | undefined;
};

type ApiRequest = {
  method: string;
  path: string;
  search: URLSearchParams;
};

type SqlRequest = {
  connectionString: string;
  role: string;
  host: string;
  queries: string[];
  readOnly: boolean;
  transaction: boolean;
};

export function connectionUriFor(role: string, database: string): string {
  return `postgresql://${role}:${FAKE_PASSWORD}@ep-example-123.example.test/${database}?sslmode=require`;
}

const TYPE_IDS = { text: 25, bool: 16, int4: 23 } as const;

function field(name: string, value: Cell) {
  const dataTypeID =
    typeof value === 'boolean'
      ? TYPE_IDS.bool
      : typeof value === 'number'
        ? TYPE_IDS.int4
        : TYPE_IDS.text;
  return { name, dataTypeID };
}

function wireValue(value: Cell): string | null {
  if (value === null) return null;
  if (typeof value === 'boolean') return value ? 't' : 'f';
  return String(value);
}

function queryResult(rows: Record<string, Cell>[]) {
  const first = rows[0] ?? {};
  return {
    command: 'SELECT',
    rowCount: rows.length,
    fields: Object.entries(first).map(([name, value]) => field(name, value)),
    rows: rows.map((row) => Object.values(row).map(wireValue)),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function statementText(value: unknown): string {
  if (!isRecord(value) || typeof value.query !== 'string') {
    throw new Error('SQL request without a query');
  }
  return value.query;
}

export function stubFakeNeon(options: FakeNeonOptions) {
  const api: ApiRequest[] = [];
  const sql: SqlRequest[] = [];
  const branch = {
    id: options.branchId,
    project_id: options.projectId,
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
  const database = {
    id: 1,
    branch_id: options.branchId,
    name: options.database,
    owner_name: options.owner,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };

  async function answerSql(request: Request): Promise<Response> {
    const connectionString = request.headers.get('Neon-Connection-String');
    if (connectionString === null) throw new Error('not a SQL request');
    const url = new URL(connectionString);
    const body: unknown = await request.json();
    const transaction = isRecord(body) && Array.isArray(body.queries);
    const queries =
      isRecord(body) && Array.isArray(body.queries)
        ? body.queries.map(statementText)
        : [statementText(body)];
    sql.push({
      connectionString,
      role: decodeURIComponent(url.username),
      host: url.hostname,
      queries,
      readOnly: request.headers.get('Neon-Batch-Read-Only') === 'true',
      transaction,
    });
    const override = options.sqlResponse?.();
    if (override) return override;
    const rowsFor = options.rows ?? (() => [{ ok: true }]);
    return transaction
      ? Response.json({
          results: queries.map((query) => queryResult(rowsFor(query))),
        })
      : Response.json(queryResult(rowsFor(queries[0] ?? '')));
  }

  function answerApi(request: Request): Response {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/v2/, '');
    api.push({ method: request.method, path, search: url.searchParams });
    const answered = options.api?.(request.method, path);
    if (answered) return answered;
    const project = `/projects/${options.projectId}`;
    const branchPath = `${project}/branches/${options.branchId}`;
    if (path === `${project}/connection_uri`) {
      const role = url.searchParams.get('role_name') ?? options.owner;
      const database = url.searchParams.get('database_name') ?? '';
      return (
        options.connectionUri?.(role) ??
        Response.json({ uri: connectionUriFor(role, database) })
      );
    }
    if (path === `${project}/branches`) {
      return Response.json({ branches: [branch] });
    }
    const deleted = new RegExp(`^${project}/branches/([^/]+)$`).exec(path);
    if (request.method === 'DELETE' && deleted?.[1] !== undefined) {
      return (
        options.deleteBranch?.(deleted[1]) ??
        Response.json({
          branch: { ...branch, id: deleted[1] },
          operations: [],
        })
      );
    }
    if (path === branchPath) {
      return Response.json({ branch });
    }
    if (path === `${branchPath}/databases`) {
      return Response.json({ databases: [database] });
    }
    if (path === `${branchPath}/databases/${options.database}`) {
      return Response.json({ database });
    }
    return Response.json({ message: `no fake for ${path}` }, { status: 404 });
  }

  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      return request.headers.has('Neon-Connection-String')
        ? answerSql(request)
        : answerApi(request);
    },
  );
  vi.stubGlobal('fetch', fetchMock);

  return {
    api,
    sql,
    connectionUriRequests: () =>
      api.filter((request) => request.path.endsWith('/connection_uri')),
    requestedRoles: () =>
      api
        .filter((request) => request.path.endsWith('/connection_uri'))
        .map((request) => request.search.get('role_name')),
    ownerLookups: () =>
      api.filter((request) =>
        request.path.endsWith(`/databases/${options.database}`),
      ),
  };
}

export type FakeNeon = ReturnType<typeof stubFakeNeon>;
