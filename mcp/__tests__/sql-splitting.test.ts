import { describe, expect, it } from 'vitest';

import { splitSqlStatements } from '../tools/utils';

describe('splitSqlStatements', () => {
  it('splits ordinary top-level SQL statements', () => {
    expect(
      splitSqlStatements(`
        CREATE TABLE test_a(id integer);
        CREATE TABLE test_b(id integer);
      `),
    ).toEqual([
      'CREATE TABLE test_a(id integer)',
      'CREATE TABLE test_b(id integer)',
    ]);
  });

  it('does not split semicolons inside line and block comments', () => {
    expect(
      splitSqlStatements(`
        -- migration note; keep this together
        CREATE TABLE audit_log(id integer);
        /* comment with ; and nested /* inner ; */ still comment */
        CREATE INDEX audit_log_id_idx ON audit_log(id);
      `),
    ).toEqual([
      '-- migration note; keep this together\n        CREATE TABLE audit_log(id integer)',
      '/* comment with ; and nested /* inner ; */ still comment */\n        CREATE INDEX audit_log_id_idx ON audit_log(id)',
    ]);
  });

  it('does not split semicolons inside quoted strings', () => {
    expect(
      splitSqlStatements(`
        INSERT INTO notes(body) VALUES ('alpha;beta');
        INSERT INTO quotes(body) VALUES ('it''s;still;one');
      `),
    ).toEqual([
      "INSERT INTO notes(body) VALUES ('alpha;beta')",
      "INSERT INTO quotes(body) VALUES ('it''s;still;one')",
    ]);
  });

  it('keeps plpgsql procedure bodies intact', () => {
    expect(
      splitSqlStatements(`
        CREATE OR REPLACE PROCEDURE refresh_signal_validation_price_cache()
        LANGUAGE plpgsql
        AS $$
        BEGIN
          REFRESH MATERIALIZED VIEW signal_validation_price_cache;
          RAISE NOTICE 'Refreshed signal_validation_price_cache at %', NOW();
        END;
        $$;
      `),
    ).toEqual([
      `CREATE OR REPLACE PROCEDURE refresh_signal_validation_price_cache()
        LANGUAGE plpgsql
        AS $$
        BEGIN
          REFRESH MATERIALIZED VIEW signal_validation_price_cache;
          RAISE NOTICE 'Refreshed signal_validation_price_cache at %', NOW();
        END;
        $$`,
    ]);
  });

  it('supports tagged dollar-quoted bodies with embedded semicolons', () => {
    expect(
      splitSqlStatements(`
        CREATE OR REPLACE FUNCTION demo()
        RETURNS text
        LANGUAGE plpgsql
        AS $fn$
        BEGIN
          RETURN 'a;b';
        END;
        $fn$;
      `),
    ).toEqual([
      `CREATE OR REPLACE FUNCTION demo()
        RETURNS text
        LANGUAGE plpgsql
        AS $fn$
        BEGIN
          RETURN 'a;b';
        END;
        $fn$`,
    ]);
  });
});
