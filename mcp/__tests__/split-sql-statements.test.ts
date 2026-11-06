import { describe, expect, it } from 'vitest';
import { splitSqlStatements } from '../tools/utils';

describe('splitSqlStatements', () => {
  it('keeps semicolons inside strings, bodies, and comments in their statement', async () => {
    const sql = [
      "INSERT INTO notes (body) VALUES ('a;b'), (E'c\\;d');",
      'CREATE FUNCTION touch() RETURNS trigger AS $$ BEGIN NEW.at := now(); RETURN NEW; END; $$ LANGUAGE plpgsql;',
      '-- a comment; with a semicolon',
      'CREATE FUNCTION add1(i int) RETURNS int LANGUAGE sql BEGIN ATOMIC SELECT i + 1; END;',
    ].join('\n');
    expect(await splitSqlStatements(sql)).toEqual([
      "INSERT INTO notes (body) VALUES ('a;b'), (E'c\\;d')",
      'CREATE FUNCTION touch() RETURNS trigger AS $$ BEGIN NEW.at := now(); RETURN NEW; END; $$ LANGUAGE plpgsql',
      'CREATE FUNCTION add1(i int) RETURNS int LANGUAGE sql BEGIN ATOMIC SELECT i + 1; END',
    ]);
  });

  it('splits where Postgres does: CR-only line endings, a function named begin, COMMIT', async () => {
    expect(
      await splitSqlStatements(
        '-- comment\rCREATE FUNCTION begin() RETURNS int LANGUAGE sql RETURN 1;\nSELECT begin();\nCOMMIT;\nCREATE INDEX CONCURRENTLY i ON t (id)',
      ),
    ).toEqual([
      'CREATE FUNCTION begin() RETURNS int LANGUAGE sql RETURN 1',
      'SELECT begin()',
      'COMMIT',
      'CREATE INDEX CONCURRENTLY i ON t (id)',
    ]);
  });

  it('returns no statements for SQL that holds only comments', async () => {
    expect(await splitSqlStatements('-- nothing to run\n')).toEqual([]);
  });

  it('rejects SQL that does not parse with the Postgres message and position', async () => {
    await expect(
      splitSqlStatements(
        "CREATE TABLE t (id int);\nINSERT INTO t VALUES ('a);",
      ),
    ).rejects.toThrow(
      `Migration SQL does not parse at position 48: unterminated quoted string at or near "'a);"`,
    );
  });
});
