import { describe, expect, it } from 'vitest';
import { assembleInspectReport } from '../inspect/report';
import { INSPECT_MAX_LIMIT, INSPECT_QUERIES } from '../inspect/queries';

const bloatRow = {
  type: 'table',
  schema: 'public',
  object_name: 't',
  bloat: 1.2,
  waste: '8 kB',
};

describe('assembleInspectReport', () => {
  it('keeps the single-database schema when the column is off', () => {
    const report = assembleInspectReport({
      check: 'table-sizes',
      query: INSPECT_QUERIES['table-sizes'],
      projectId: 'proj-1',
      branchId: 'br-1',
      batches: [
        {
          database: 'neondb',
          rows: [{ schema: 'public', name: 't', size: '8 kB' }],
        },
      ],
      includeDatabaseColumn: false,
      includeDatabaseName: true,
      limit: 50,
    });

    expect(report.databaseName).toBe('neondb');
    expect(report.databases).toEqual(['neondb']);
    expect(report.fields).toEqual(INSPECT_QUERIES['table-sizes'].fields);
    expect(report.rows[0]).not.toHaveProperty('database');
  });

  it('prefixes database even when the branch only has one', () => {
    const report = assembleInspectReport({
      check: 'table-sizes',
      query: INSPECT_QUERIES['table-sizes'],
      projectId: 'proj-1',
      branchId: 'br-1',
      batches: [
        {
          database: 'neondb',
          rows: [{ schema: 'public', name: 't', size: '8 kB' }],
        },
      ],
      includeDatabaseColumn: true,
      includeDatabaseName: false,
      limit: 50,
    });

    expect(report.databaseName).toBeUndefined();
    expect(report.fields[0]).toBe('database');
    expect(report.rows[0]?.database).toBe('neondb');
  });

  it('uses the all-database empty message when every batch is empty', () => {
    const report = assembleInspectReport({
      check: 'locks',
      query: INSPECT_QUERIES.locks,
      projectId: 'proj-1',
      branchId: 'br-1',
      batches: [
        { database: 'analytics', rows: [] },
        { database: 'neondb', rows: [] },
      ],
      includeDatabaseColumn: true,
      includeDatabaseName: false,
      limit: 50,
    });

    expect(report.note).toBe(INSPECT_QUERIES.locks.emptyMessageAll);
  });

  it('does not treat 25+25 combined rows as a single-database SQL cap', () => {
    const report = assembleInspectReport({
      check: 'bloat',
      query: INSPECT_QUERIES.bloat,
      projectId: 'proj-1',
      branchId: 'br-1',
      batches: [
        {
          database: 'analytics',
          rows: Array.from({ length: 25 }, () => ({ ...bloatRow })),
        },
        {
          database: 'neondb',
          rows: Array.from({ length: 25 }, () => ({ ...bloatRow })),
        },
      ],
      includeDatabaseColumn: true,
      includeDatabaseName: false,
      limit: 1000,
    });

    expect(report.totalRowCount).toBe(50);
    expect(report.note).toContain('at most 25 rows per database');
    expect(report.note).not.toMatch(/at most 25 rows, and hit that cap/);
  });

  it('does not invent a SQL cap from 24+1 combined rows', () => {
    const report = assembleInspectReport({
      check: 'bloat',
      query: INSPECT_QUERIES.bloat,
      projectId: 'proj-1',
      branchId: 'br-1',
      batches: [
        {
          database: 'analytics',
          rows: Array.from({ length: 24 }, () => ({ ...bloatRow })),
        },
        { database: 'neondb', rows: [{ ...bloatRow }] },
      ],
      includeDatabaseColumn: true,
      includeDatabaseName: false,
      limit: 50,
    });

    expect(report.note).toBeUndefined();
  });

  it('keeps the single-database SQL-cap wording when the column is off', () => {
    const report = assembleInspectReport({
      check: 'bloat',
      query: INSPECT_QUERIES.bloat,
      projectId: 'proj-1',
      branchId: 'br-1',
      batches: [
        {
          database: 'neondb',
          rows: Array.from({ length: 25 }, () => ({ ...bloatRow })),
        },
      ],
      includeDatabaseColumn: false,
      includeDatabaseName: true,
      limit: 50,
    });

    expect(report.note).toBe(
      'The `bloat` check returns at most 25 rows, and hit that cap, so there may be more. Use `run_sql` for the full ranking.',
    );
  });

  it('applies limit to the combined rows', () => {
    const report = assembleInspectReport({
      check: 'table-sizes',
      query: INSPECT_QUERIES['table-sizes'],
      projectId: 'proj-1',
      branchId: 'br-1',
      batches: [
        {
          database: 'analytics',
          rows: [{ schema: 'public', name: 'a', size: '8 kB' }],
        },
        {
          database: 'neondb',
          rows: [{ schema: 'public', name: 'b', size: '8 kB' }],
        },
      ],
      includeDatabaseColumn: true,
      includeDatabaseName: false,
      limit: 1,
    });

    expect(report.rows).toHaveLength(1);
    expect(report.totalRowCount).toBe(2);
    expect(report.truncated).toBe(true);
    expect(report.note).toBe(
      'Showing the first 1 of 2 rows, which cover only the databases analytics (of 2). Raise `limit` to reach the rest.',
    );
  });

  it('does not put databaseName on a compute-wide omit', () => {
    const report = assembleInspectReport({
      check: 'replication-slots',
      query: INSPECT_QUERIES['replication-slots'],
      projectId: 'proj-1',
      branchId: 'br-1',
      batches: [{ database: 'other_db', rows: [] }],
      includeDatabaseColumn: false,
      includeDatabaseName: false,
      limit: 50,
    });

    expect(report.databaseName).toBeUndefined();
    expect(report.databases).toEqual(['other_db']);
  });

  it('names the response ceiling when limit is already at the maximum', () => {
    const report = assembleInspectReport({
      check: 'table-sizes',
      query: INSPECT_QUERIES['table-sizes'],
      projectId: 'proj-1',
      branchId: 'br-1',
      batches: [
        {
          database: 'neondb',
          rows: Array.from({ length: INSPECT_MAX_LIMIT + 1 }, (_, index) => ({
            schema: 'public',
            name: `t${index}`,
            size: '8 kB',
          })),
        },
      ],
      includeDatabaseColumn: false,
      includeDatabaseName: true,
      limit: INSPECT_MAX_LIMIT,
    });

    expect(report.truncated).toBe(true);
    expect(report.note).toContain('which is the maximum this tool returns');
  });
});
