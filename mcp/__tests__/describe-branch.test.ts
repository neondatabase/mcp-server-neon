import { describe, expect, it } from 'vitest';
import { DESCRIBE_DATABASE_STATEMENTS } from '../tools/utils';

describe('DESCRIBE_DATABASE_STATEMENTS', () => {
  it('drops the show_db_tree helper function in the same transaction', () => {
    const lastStatement =
      DESCRIBE_DATABASE_STATEMENTS[DESCRIBE_DATABASE_STATEMENTS.length - 1];

    expect(lastStatement).toContain(
      'DROP FUNCTION IF EXISTS public.show_db_tree',
    );
  });

  it('runs the tree query before the cleanup statement', () => {
    const selectIndex = DESCRIBE_DATABASE_STATEMENTS.findIndex((sql) =>
      sql.includes('SELECT * FROM show_db_tree()'),
    );
    const dropIndex = DESCRIBE_DATABASE_STATEMENTS.findIndex((sql) =>
      sql.includes('DROP FUNCTION IF EXISTS public.show_db_tree'),
    );

    expect(selectIndex).toBeGreaterThanOrEqual(0);
    expect(dropIndex).toBeGreaterThan(selectIndex);
  });
});
