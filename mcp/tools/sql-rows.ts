export const SQL_DEFAULT_MAX_ROWS = 100;
export const SQL_MAX_ROWS_LIMIT = 10_000;

type Row = Record<string, unknown>;

type StatementSummary = {
  totalRowCount: number;
  truncated: boolean;
  note?: string;
};

// Whether a rerun is safe can't be read from the result: a data-modifying CTE
// or a function call with side effects still reports a SELECT command tag.
function truncationNote(maxRows: number, totalRowCount: number): string {
  const shown = `Showing the first ${maxRows} of ${totalRowCount} rows.`;
  const rerun =
    'The SQL already ran, so if it changed data, running it again repeats the change.';
  if (maxRows < SQL_MAX_ROWS_LIMIT) {
    return `${shown} To see more, raise \`max_rows\` or narrow the query with WHERE or LIMIT. ${rerun}`;
  }
  return `${shown} That is the maximum this tool returns. To see the rest, narrow the query with WHERE or LIMIT. ${rerun}`;
}

/**
 * Caps each statement's rows at `maxRows`. `summaries` is set only when a
 * statement was truncated, so a result that fits keeps the bare row array
 * callers already parse.
 */
export function capStatementRows(
  statements: Row[][],
  maxRows: number,
): { rows: Row[][]; summaries?: StatementSummary[] } {
  const rows = statements.map((statementRows) =>
    statementRows.slice(0, maxRows),
  );
  if (statements.every((statementRows) => statementRows.length <= maxRows)) {
    return { rows };
  }
  const summaries = statements.map((statementRows): StatementSummary => {
    const truncated = statementRows.length > maxRows;
    return {
      totalRowCount: statementRows.length,
      truncated,
      ...(truncated && {
        note: truncationNote(maxRows, statementRows.length),
      }),
    };
  });
  return { rows, summaries };
}

export function sqlRowsContent(
  rows: unknown,
  summaries: unknown,
): { type: 'text'; text: string }[] {
  const content = [
    { type: 'text' as const, text: JSON.stringify(rows, null, 2) },
  ];
  if (summaries !== undefined) {
    content.push({ type: 'text', text: JSON.stringify(summaries, null, 2) });
  }
  return content;
}
