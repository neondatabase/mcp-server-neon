import { describe, expect, it } from 'vitest';
import { capStatementRows, SQL_MAX_ROWS_LIMIT } from '../tools/sql-rows';

const rows = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ n: index + 1 }));

const select = (count: number) => ({ command: 'SELECT', rows: rows(count) });

describe('capStatementRows', () => {
  it('returns the rows and no summary when every statement fits', () => {
    expect(capStatementRows([select(3), select(0)], 3)).toEqual({
      rows: [rows(3), []],
    });
  });

  it('keeps the first rows of a SELECT and says how to see more', () => {
    expect(capStatementRows([select(5), select(1)], 2)).toEqual({
      rows: [rows(2), rows(1)],
      summaries: [
        {
          totalRowCount: 5,
          truncated: true,
          note: 'Showing the first 2 of 5 rows. Raise `max_rows` or narrow the query with WHERE or LIMIT to see more.',
        },
        { totalRowCount: 1, truncated: false },
      ],
    });
  });

  it('stops suggesting max_rows once it is at the limit', () => {
    const { summaries } = capStatementRows(
      [select(SQL_MAX_ROWS_LIMIT + 1)],
      SQL_MAX_ROWS_LIMIT,
    );
    expect(summaries?.[0].note).toBe(
      `Showing the first ${SQL_MAX_ROWS_LIMIT} of ${SQL_MAX_ROWS_LIMIT + 1} rows. That is the maximum this tool returns. Narrow the query with WHERE or LIMIT to see the rest.`,
    );
  });

  it('does not suggest rerunning a SELECT that shares a transaction with a write', () => {
    const { summaries } = capStatementRows(
      [{ command: 'UPDATE', rows: [] }, select(5)],
      2,
    );
    expect(summaries?.[1].note).toBe(
      'Showing the first 2 of 5 rows. The SQL already ran, so running it again to see more rows would repeat its changes.',
    );
  });
});
