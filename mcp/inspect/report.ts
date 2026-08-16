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
  limit: number;
};

export function assembleInspectReport({
  check,
  query,
  projectId,
  branchId,
  batches,
  includeDatabaseColumn,
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
  let note: string | undefined;
  if (rows.length === 0) {
    note = includeDatabaseColumn
      ? (query.emptyMessageAll ?? query.emptyMessage)
      : query.emptyMessage;
  } else if (truncated && limit < INSPECT_MAX_LIMIT) {
    note = `Showing the first ${limit} of ${rows.length} rows. Raise \`limit\` to see more.`;
  } else if (truncated) {
    note = `Showing the first ${limit} of ${rows.length} rows, which is the maximum this tool returns. Narrow the question with \`run_sql\` to see the rest.`;
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
    ...(includeDatabaseColumn ? {} : { databaseName: databases[0] }),
    databases,
    fields,
    totalRowCount: rows.length,
    rows: truncated ? rows.slice(0, limit) : rows,
    truncated,
    ...(note !== undefined && { note }),
  };
}
