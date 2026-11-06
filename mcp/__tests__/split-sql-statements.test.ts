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

  it('keeps a trailing U+00A0, which Postgres reads as part of an identifier', async () => {
    expect(
      await splitSqlStatements(
        'CREATE SCHEMA foo\u00a0;\nDROP SCHEMA foo\u00a0;',
      ),
    ).toEqual(['CREATE SCHEMA foo\u00a0', 'DROP SCHEMA foo\u00a0']);
  });

  it('returns no statements for SQL that holds only comments', async () => {
    expect(await splitSqlStatements('-- nothing to run\n')).toEqual([]);
  });

  it('splits SQL the parser rejects on semicolons, for Postgres to judge', async () => {
    expect(
      await splitSqlStatements(
        "SET standard_conforming_strings = off;\nSELECT 'it\\'s'",
      ),
    ).toEqual(['SET standard_conforming_strings = off', "\nSELECT 'it\\'s'"]);
  });
});
