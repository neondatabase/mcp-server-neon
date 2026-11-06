import { describe, expect, it } from 'vitest';
import { capSqlRows, SQL_MAX_ROWS_LIMIT } from '../tools/sql-rows';

const rows = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ n: index + 1 }));

describe('capSqlRows', () => {
  it('returns every row without a note when the result fits', () => {
    expect(capSqlRows(rows(3), 3)).toEqual({
      rows: rows(3),
      totalRowCount: 3,
      truncated: false,
    });
  });

  it('keeps the first rows and says how to see more', () => {
    expect(capSqlRows(rows(5), 2)).toEqual({
      rows: rows(2),
      totalRowCount: 5,
      truncated: true,
      note: 'Showing the first 2 of 5 rows. Raise `max_rows` or narrow the query with WHERE or LIMIT to see more.',
    });
  });

  it('stops suggesting max_rows once it is at the limit', () => {
    const result = capSqlRows(rows(SQL_MAX_ROWS_LIMIT + 1), SQL_MAX_ROWS_LIMIT);
    expect(result.note).toBe(
      `Showing the first ${SQL_MAX_ROWS_LIMIT} of ${SQL_MAX_ROWS_LIMIT + 1} rows, which is the maximum this tool returns. Narrow the query with WHERE or LIMIT to see the rest.`,
    );
  });
});
