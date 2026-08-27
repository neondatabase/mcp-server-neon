import {
  INSPECT_MAX_LIMIT,
  type InspectCheck,
  type InspectQuery,
} from './queries';

export type InspectDatabaseBatch = {
  database: string;
  rows: Record<string, unknown>[];
};

export type InspectDatabaseResult = {
  check: InspectCheck;
  describe: string;
  projectId: string;
  branchId: string;
  databaseName?: string;
  databases: string[];
  fields: readonly string[];
  totalRowCount: number;
  rows: Record<string, unknown>[];
  truncated: boolean;
  note?: string;
};

type AssembleInspectReportInput = {
  check: InspectCheck;
  query: InspectQuery;
  projectId: string;
  branchId: string;
  batches: InspectDatabaseBatch[];
  includeDatabaseColumn: boolean;
  includeDatabaseName: boolean;
  limit: number;
};

function databasesIn(rows: Record<string, unknown>[]): string[] {
  const names: string[] = [];
  for (const row of rows) {
    if (typeof row.database === 'string' && !names.includes(row.database)) {
      names.push(row.database);
    }
  }
  return names;
}

function truncationNote(
  displayed: Record<string, unknown>[],
  totalRowCount: number,
  limit: number,
  includeDatabaseColumn: boolean,
  ran: string[],
  allRows: Record<string, unknown>[],
): string {
  const dropped = includeDatabaseColumn
    ? databasesIn(allRows).filter(
        (name) => !databasesIn(displayed).includes(name),
      )
    : [];
  if (dropped.length > 0) {
    const covered = databasesIn(displayed).join(', ');
    return `Showing the first ${limit} of ${totalRowCount} rows, which cover only the databases ${covered} (of ${ran.length}). ${
      limit < INSPECT_MAX_LIMIT
        ? 'Raise `limit` to reach the rest.'
        : 'Narrow the question with `run_sql` to see the rest.'
    }`;
  }
  if (limit < INSPECT_MAX_LIMIT) {
    return `Showing the first ${limit} of ${totalRowCount} rows. Raise \`limit\` to see more.`;
  }
  return `Showing the first ${limit} of ${totalRowCount} rows, which is the maximum this tool returns. Narrow the question with \`run_sql\` to see the rest.`;
}

export function assembleInspectReport({
  check,
  query,
  projectId,
  branchId,
  batches,
  includeDatabaseColumn,
  includeDatabaseName,
  limit,
}: AssembleInspectReportInput): InspectDatabaseResult {
  const databases = batches.map((batch) => batch.database);
  const rows = includeDatabaseColumn
    ? batches.flatMap((batch) =>
        batch.rows.map((row) => ({ database: batch.database, ...row })),
      )
    : batches.flatMap((batch) => batch.rows);
  const fields = includeDatabaseColumn
    ? ['database', ...query.fields]
    : query.fields;

  const truncated = rows.length > limit;
  const displayed = truncated ? rows.slice(0, limit) : rows;
  let note: string | undefined;
  if (rows.length === 0) {
    note = includeDatabaseColumn
      ? (query.emptyMessageAll ?? query.emptyMessage)
      : query.emptyMessage;
  } else if (truncated) {
    note = truncationNote(
      displayed,
      rows.length,
      limit,
      includeDatabaseColumn,
      databases,
      rows,
    );
  }

  // Combined length is not a per-database cap: 25+25 would miss it and 24+1
  // would invent it.
  if (
    query.sqlLimit !== undefined &&
    batches.some((batch) => batch.rows.length === query.sqlLimit)
  ) {
    const sqlCapNote = includeDatabaseColumn
      ? `The \`${check}\` check returns at most ${query.sqlLimit} rows per database, and at least one database hit that cap, so there may be more. Use \`run_sql\` for the full ranking.`
      : `The \`${check}\` check returns at most ${query.sqlLimit} rows, and hit that cap, so there may be more. Use \`run_sql\` for the full ranking.`;
    note = note === undefined ? sqlCapNote : `${note} ${sqlCapNote}`;
  }

  return {
    check,
    describe: query.describe,
    projectId,
    branchId,
    ...(includeDatabaseName && query.scope === 'database'
      ? { databaseName: databases[0] }
      : {}),
    databases,
    fields,
    totalRowCount: rows.length,
    rows: displayed,
    truncated,
    ...(note !== undefined && { note }),
  };
}
