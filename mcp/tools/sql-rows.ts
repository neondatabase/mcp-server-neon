export const SQL_DEFAULT_MAX_ROWS = 100;
export const SQL_MAX_ROWS_LIMIT = 10_000;

type Row = Record<string, unknown>;

type StatementResult = {
  command: string;
  rows: Row[];
};

type StatementSummary = {
  totalRowCount: number;
  truncated: boolean;
  note?: string;
};

function truncationNote(
  maxRows: number,
  totalRowCount: number,
  rerunSafe: boolean,
): string {
  const shown = `Showing the first ${maxRows} of ${totalRowCount} rows.`;
  if (!rerunSafe) {
    return `${shown} The SQL already ran, so running it again to see more rows would repeat its changes.`;
  }
  if (maxRows < SQL_MAX_ROWS_LIMIT) {
    return `${shown} Raise \`max_rows\` or narrow the query with WHERE or LIMIT to see more.`;
  }
  return `${shown} That is the maximum this tool returns. Narrow the query with WHERE or LIMIT to see the rest.`;
}

/**
 * Caps each statement's rows at `maxRows`. `summaries` is set only when a
 * statement was truncated, so a result that fits keeps the bare row array
 * callers already parse. Rerunning is suggested only when every statement is a
 * SELECT: rerunning an `UPDATE ... RETURNING`, or a transaction that contains
 * one, repeats the write.
 */
export function capStatementRows(
  results: StatementResult[],
  maxRows: number,
): { rows: Row[][]; summaries?: StatementSummary[] } {
  const rows = results.map((result) => result.rows.slice(0, maxRows));
  if (results.every((result) => result.rows.length <= maxRows)) {
    return { rows };
  }
  const rerunSafe = results.every((result) => result.command === 'SELECT');
  const summaries = results.map((result): StatementSummary => {
    const truncated = result.rows.length > maxRows;
    return {
      totalRowCount: result.rows.length,
      truncated,
      ...(truncated && {
        note: truncationNote(maxRows, result.rows.length, rerunSafe),
      }),
    };
  });
  return { rows, summaries };
}
