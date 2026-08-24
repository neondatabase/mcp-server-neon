import { describe, expect, it } from 'vitest';
import { assembleInspectReport } from '../inspect/report';
import {
  INSPECT_CHECK_LIST,
  INSPECT_CHECKS,
  INSPECT_DEFAULT_LIMIT,
  INSPECT_MAX_LIMIT,
  INSPECT_QUERIES,
} from '../inspect/queries';
import { selectInspectTargets } from '../inspect/targets';
import { inspectDatabaseInputSchema } from '../tools/toolsSchema';

const STALLED_QUERY_ROW = {
  observed_at: '2026-08-24 10:00:00+00',
  query_start: '2026-08-24 09:59:00+00',
  query_group: 42,
  pid: 42,
  leader_pid: null,
  role: 'leader',
  backend_type: 'client backend',
  database: 'neondb',
  application_name: 'psql',
  query_id: '1234567890',
  state: 'active',
  wait_event_type: 'Lock',
  wait_event: 'transactionid',
  blocking_pids: '99',
  duration: '00:01:00',
  query: 'SELECT pg_sleep(60)',
};

describe('inspect query catalog', () => {
  it('offers a query for every check and no orphans', () => {
    expect(Object.keys(INSPECT_QUERIES).sort()).toEqual(
      [...INSPECT_CHECKS].sort(),
    );
  });

  it.each(INSPECT_CHECKS)('%s declares a complete entry', (check) => {
    const query = INSPECT_QUERIES[check];
    expect(query.describe.length).toBeGreaterThan(0);
    expect(query.emptyMessage.length).toBeGreaterThan(0);
    expect(query.fields.length).toBeGreaterThan(0);
    expect(query.sql.trim().length).toBeGreaterThan(0);
  });

  // The HTTP driver rejects multiple statements per query, so a check that
  // accidentally vendored two would only fail at runtime against a real database.
  it.each(INSPECT_CHECKS)('%s is a single statement', (check) => {
    const statements = INSPECT_QUERIES[check].sql
      .split(';')
      .filter((part) => part.trim().length > 0);
    expect(statements).toHaveLength(1);
  });

  // A `LIMIT` in the SQL makes a capped result look complete, so the catalog has
  // to declare it. This keeps the declaration honest in both directions.
  it.each(INSPECT_CHECKS)('%s declares any SQL-level row cap', (check) => {
    const query = INSPECT_QUERIES[check];
    const limitInSql = query.sql.match(/LIMIT\s+(\d+)/i);
    expect(query.sqlLimit).toBe(limitInSql ? Number(limitInSql[1]) : undefined);
  });

  it('names the cap in the description of every capped check', () => {
    for (const check of INSPECT_CHECKS) {
      const query = INSPECT_QUERIES[check];
      if (query.sqlLimit === undefined) continue;
      expect(query.describe).toContain(String(query.sqlLimit));
    }
  });

  it('documents every check for the model', () => {
    for (const check of INSPECT_CHECKS) {
      expect(INSPECT_CHECK_LIST).toContain(
        `\`${check}\`: ${INSPECT_QUERIES[check].describe}`,
      );
    }
  });

  it.each([
    [
      'long-running-queries',
      'datname = current_database()',
      'No long-running queries in this database.',
      'No long-running queries in any database.',
    ],
    [
      'locks',
      'a.datname = current_database()',
      'No locks held in this database.',
      'No locks held in any database.',
    ],
  ] as const)(
    '%s is scoped to the inspected database',
    (check, filter, note, noteAll) => {
      expect(INSPECT_QUERIES[check].sql).toContain(filter);
      expect(INSPECT_QUERIES[check].emptyMessage).toBe(note);
      expect(INSPECT_QUERIES[check].emptyMessageAll).toBe(noteAll);
    },
  );

  it('scopes locks by the holding session, not the lock database', () => {
    expect(INSPECT_QUERIES.locks.sql).not.toMatch(/\bl\.database\s*=/);
  });

  it.each([
    'table-sizes',
    'index-sizes',
    'unused-indexes',
    'seq-scans',
    'long-running-queries',
    'locks',
    'outliers',
    'calls',
    'vacuum-stats',
    'bloat',
    'subscriptions',
  ] as const)('%s is database-scoped', (check) => {
    expect(INSPECT_QUERIES[check].scope).toBe('database');
  });

  it.each([
    'stalled-queries',
    'lfc-hit-rate',
    'working-set',
    'replication-slots',
  ] as const)('%s is compute-scoped and says so', (check) => {
    expect(INSPECT_QUERIES[check].scope).toBe('compute');
    expect(INSPECT_QUERIES[check].describe).toContain('compute-wide');
  });

  it('stalled-queries preserves its diagnostic SQL filter and fields', () => {
    expect(INSPECT_QUERIES['stalled-queries']).toMatchObject({
      scope: 'compute',
      sql: expect.stringContaining(
        "backend_type IN ('client backend', 'parallel worker')",
      ),
      fields: [
        'observed_at',
        'query_start',
        'query_group',
        'pid',
        'leader_pid',
        'role',
        'backend_type',
        'database',
        'application_name',
        'query_id',
        'state',
        'wait_event_type',
        'wait_event',
        'blocking_pids',
        'duration',
        'query',
      ],
    });
    expect(INSPECT_QUERIES['stalled-queries'].sql).toContain(
      "interval '30 seconds'",
    );
    expect(INSPECT_QUERIES['stalled-queries'].sql).toContain(
      "array_to_string(pg_blocking_pids(a.pid), ',')",
    );
  });

  it('stalled-queries runs once when multiple databases exist', () => {
    expect(
      selectInspectTargets({
        branchDatabases: ['analytics', 'neondb'],
        scope: INSPECT_QUERIES['stalled-queries'].scope,
      }),
    ).toEqual({
      databases: ['analytics'],
      includeDatabaseColumn: false,
    });
  });

  it('stalled-queries reports and retains every structured field', () => {
    const report = assembleInspectReport({
      check: 'stalled-queries',
      query: INSPECT_QUERIES['stalled-queries'],
      projectId: 'proj-1',
      branchId: 'br-1',
      batches: [{ database: 'analytics', rows: [STALLED_QUERY_ROW] }],
      includeDatabaseColumn: false,
      includeDatabaseName: false,
      limit: 50,
    });

    expect(report.fields).toEqual(INSPECT_QUERIES['stalled-queries'].fields);
    expect(report.rows).toEqual([STALLED_QUERY_ROW]);
    expect(Object.keys(report.rows[0] ?? {}).sort()).toEqual(
      [...report.fields].sort(),
    );
  });
});

describe('inspectDatabaseInputSchema', () => {
  it('accepts every check the catalog offers', () => {
    for (const check of INSPECT_CHECKS) {
      const parsed = inspectDatabaseInputSchema.parse({
        check,
        projectId: 'project-1',
      });
      expect(parsed.check).toBe(check);
    }
  });

  it('rejects a check that is not in the catalog', () => {
    const result = inspectDatabaseInputSchema.safeParse({
      check: 'cache-hit',
      projectId: 'project-1',
    });
    expect(result.success).toBe(false);
  });

  it('caps rows by default and keeps the ceiling in range', () => {
    expect(
      inspectDatabaseInputSchema.parse({
        check: 'locks',
        projectId: 'project-1',
      }).limit,
    ).toBe(INSPECT_DEFAULT_LIMIT);
    expect(
      inspectDatabaseInputSchema.safeParse({
        check: 'locks',
        projectId: 'project-1',
        limit: 0,
      }).success,
    ).toBe(false);
    expect(
      inspectDatabaseInputSchema.safeParse({
        check: 'locks',
        projectId: 'project-1',
        limit: INSPECT_MAX_LIMIT,
      }).success,
    ).toBe(true);
    expect(
      inspectDatabaseInputSchema.safeParse({
        check: 'locks',
        projectId: 'project-1',
        limit: INSPECT_MAX_LIMIT + 1,
      }).success,
    ).toBe(false);
  });

  it('requires a project id', () => {
    expect(
      inspectDatabaseInputSchema.safeParse({ check: 'locks' }).success,
    ).toBe(false);
  });

  it('rejects an empty databaseName', () => {
    const result = inspectDatabaseInputSchema.safeParse({
      check: 'locks',
      projectId: 'project-1',
      databaseName: '',
    });
    expect(result.success).toBe(false);
  });
});
