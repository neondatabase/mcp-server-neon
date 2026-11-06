import { describe, expect, it } from 'vitest';
import { capStatementRows, SQL_MAX_ROWS_LIMIT } from '../tools/sql-rows';

const rows = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ n: index + 1 }));

describe('capStatementRows', () => {
  it('returns the rows and no summary when every statement fits', () => {
    expect(capStatementRows([rows(3), []], 3)).toEqual({
      rows: [rows(3), []],
    });
  });

  it('keeps the first rows and summarizes every statement once one is cut', () => {
    expect(capStatementRows([rows(5), rows(1)], 2)).toEqual({
      rows: [rows(2), rows(1)],
      summaries: [
        {
          totalRowCount: 5,
          truncated: true,
          note: 'Showing the first 2 of 5 rows. To see more, raise `max_rows` or narrow the query with WHERE or LIMIT. The SQL already ran, so if it changed data, running it again repeats the change.',
        },
        { totalRowCount: 1, truncated: false },
      ],
    });
  });

  it('stops suggesting max_rows once it is at the limit', () => {
    const { summaries } = capStatementRows(
      [rows(SQL_MAX_ROWS_LIMIT + 1)],
      SQL_MAX_ROWS_LIMIT,
    );
    expect(summaries?.[0].note).toBe(
      `Showing the first ${SQL_MAX_ROWS_LIMIT} of ${SQL_MAX_ROWS_LIMIT + 1} rows. That is the maximum this tool returns. To see the rest, narrow the query with WHERE or LIMIT. The SQL already ran, so if it changed data, running it again repeats the change.`,
    );
  });
});
