export const SQL_DEFAULT_MAX_ROWS = 100;
export const SQL_MAX_ROWS_LIMIT = 10_000;

type SqlRowsResult = {
  rows: Record<string, unknown>[];
  totalRowCount: number;
  truncated: boolean;
  note?: string;
};

function truncationNote(maxRows: number, totalRowCount: number): string {
  if (maxRows < SQL_MAX_ROWS_LIMIT) {
    return `Showing the first ${maxRows} of ${totalRowCount} rows. Raise \`max_rows\` or narrow the query with WHERE or LIMIT to see more.`;
  }
  return `Showing the first ${maxRows} of ${totalRowCount} rows, which is the maximum this tool returns. Narrow the query with WHERE or LIMIT to see the rest.`;
}

export function capSqlRows(
  rows: Record<string, unknown>[],
  maxRows: number,
): SqlRowsResult {
  const truncated = rows.length > maxRows;
  return {
    rows: truncated ? rows.slice(0, maxRows) : rows,
    totalRowCount: rows.length,
    truncated,
    ...(truncated && { note: truncationNote(maxRows, rows.length) }),
  };
}
