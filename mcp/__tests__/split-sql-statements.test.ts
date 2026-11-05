import { describe, expect, it } from 'vitest';
import { InvalidArgumentError } from '../server/errors';
import { splitSqlStatements } from '../tools/utils';

describe('splitSqlStatements', () => {
  it('splits on top-level semicolons and drops empty pieces', () => {
    expect(
      splitSqlStatements(
        'CREATE TABLE t (id int);\nINSERT INTO t VALUES (1);\n',
      ),
    ).toEqual(['CREATE TABLE t (id int)', 'INSERT INTO t VALUES (1)']);
    expect(splitSqlStatements(' ;\n; SELECT 1 ;; ')).toEqual(['SELECT 1']);
  });

  it('keeps semicolons inside string literals and quoted identifiers', () => {
    expect(
      splitSqlStatements(
        `INSERT INTO notes(body) VALUES ('a;b'), ('it''s; fine'), (E'x\\';y');
         CREATE TABLE "odd;name" (id int);`,
      ),
    ).toEqual([
      "INSERT INTO notes(body) VALUES ('a;b'), ('it''s; fine'), (E'x\\';y')",
      'CREATE TABLE "odd;name" (id int)',
    ]);
  });

  it('keeps dollar-quoted function bodies and DO blocks whole', () => {
    const fn = `CREATE FUNCTION touch() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql`;
    const block = `DO $body$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'mood') THEN
    CREATE TYPE mood AS ENUM ('ok', 'sad');
  END IF;
END
$body$`;
    expect(
      splitSqlStatements(
        `CREATE TABLE t (id int);\n${fn};\n${block};\nCREATE TRIGGER t_touch BEFORE UPDATE ON t FOR EACH ROW EXECUTE FUNCTION touch();`,
      ),
    ).toEqual([
      'CREATE TABLE t (id int)',
      fn,
      block,
      'CREATE TRIGGER t_touch BEFORE UPDATE ON t FOR EACH ROW EXECUTE FUNCTION touch()',
    ]);
  });

  it('ignores semicolons in comments and drops comment-only pieces', () => {
    expect(
      splitSqlStatements(
        `-- add a column; then backfill\nALTER TABLE t ADD COLUMN n int; /* step 2; /* nested; */ */\nUPDATE t SET n = 0;\n-- done;`,
      ),
    ).toEqual([
      '-- add a column; then backfill\nALTER TABLE t ADD COLUMN n int',
      '/* step 2; /* nested; */ */\nUPDATE t SET n = 0',
    ]);
  });

  it('does not treat parameters or identifiers with $ as dollar quotes', () => {
    expect(
      splitSqlStatements('PREPARE p AS SELECT $1; SELECT a$b$ FROM t;'),
    ).toEqual(['PREPARE p AS SELECT $1', 'SELECT a$b$ FROM t']);
  });

  it('keeps BEGIN ATOMIC function and procedure bodies whole', () => {
    const fn = `CREATE OR REPLACE FUNCTION grade(n int) RETURNS text
LANGUAGE sql
BEGIN ATOMIC
  SELECT CASE WHEN n > 50 THEN 'pass' ELSE 'fail' END;
END`;
    const proc = `CREATE PROCEDURE reset_counts()
LANGUAGE sql
BEGIN ATOMIC
  DELETE FROM counts;
  INSERT INTO counts VALUES (0);
END`;
    expect(
      splitSqlStatements(
        `${fn};\n${proc};\nBEGIN;\nCALL reset_counts();\nEND;`,
      ),
    ).toEqual([fn, proc, 'BEGIN', 'CALL reset_counts()', 'END']);
  });

  it('reads begin, case and end inside parentheses as names, as psql does', () => {
    const fn = `CREATE FUNCTION shift(begin int, "end" int) RETURNS int
LANGUAGE sql
RETURN (CASE WHEN begin > 0 THEN begin ELSE 0 END)`;
    expect(splitSqlStatements(`${fn};\nSELECT shift(1, 2);`)).toEqual([
      fn,
      'SELECT shift(1, 2)',
    ]);
  });

  it('rejects unterminated strings, identifiers, dollar quotes and comments', () => {
    const cases: [string, RegExp][] = [
      ['SELECT 1; /* unfinished', /unterminated block comment .* line 1/],
      [
        'SELECT 1;\n/* outer /* inner */',
        /unterminated block comment .* line 2/,
      ],
      ["INSERT INTO t VALUES ('a;b);", /unterminated string/],
      ["SELECT E'it\\'s;", /unterminated string/],
      ['CREATE TABLE "odd (id int);', /unterminated quoted identifier/],
      [
        'CREATE FUNCTION f() RETURNS int AS $body$ SELECT 1; $$ LANGUAGE sql;',
        /unterminated \$body\$ dollar quote/,
      ],
    ];
    for (const [sql, message] of cases) {
      expect(() => splitSqlStatements(sql), sql).toThrow(InvalidArgumentError);
      expect(() => splitSqlStatements(sql), sql).toThrow(message);
    }
    expect(splitSqlStatements('SELECT 1; -- no newline at the end')).toEqual([
      'SELECT 1',
    ]);
  });
});
