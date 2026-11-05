import { NEON_DEFAULT_DATABASE_NAME } from '../constants';
import { Api, Organization } from '../neon-client';
import { ToolHandlerExtraParams } from './types';
import { InvalidArgumentError, NotFoundError } from '../server/errors';

/**
 * Splits a migration into statements on top-level semicolons, as psql does.
 * Semicolons inside quoted strings ('...', E'...'), quoted identifiers ("..."),
 * dollar-quoted bodies ($$...$$, $tag$...$tag$), comments (--, nested /* *\/)
 * and the BEGIN ATOMIC ... END body of a CREATE FUNCTION or CREATE PROCEDURE do
 * not end a statement. Pieces that hold only whitespace and comments are
 * dropped. An unterminated string, identifier, dollar quote or block comment is
 * rejected rather than sent or dropped.
 */
export const splitSqlStatements = (sql: string): string[] => {
  const statements: string[] = [];
  let start = 0;
  let hasCode = false;
  // Leading words of the statement, parenthesis depth, and BEGIN ... END
  // depth inside a CREATE FUNCTION or PROCEDURE, tracked like psql's lexer.
  let words: string[] = [];
  let parenDepth = 0;
  let beginDepth = 0;
  let i = 0;
  const end = (to: number) => {
    if (hasCode) statements.push(sql.slice(start, to).trim());
    start = to + 1;
    hasCode = false;
    words = [];
    parenDepth = 0;
    beginDepth = 0;
  };
  const unterminated = (what: string, at: number): never => {
    const line = sql.slice(0, at).split('\n').length;
    throw new InvalidArgumentError(
      `Migration SQL has an unterminated ${what} starting on line ${line}.`,
    );
  };
  const routine = () =>
    words[0] === 'create' &&
    (['function', 'procedure'].includes(words[1] ?? '') ||
      (words[1] === 'or' &&
        words[2] === 'replace' &&
        ['function', 'procedure'].includes(words[3] ?? '')));
  while (i < sql.length) {
    const char = sql[i];
    const next = sql[i + 1];
    if (char === '-' && next === '-') {
      const newline = sql.indexOf('\n', i);
      i = newline === -1 ? sql.length : newline + 1;
    } else if (char === '/' && next === '*') {
      const from = i;
      let depth = 1;
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') {
          depth++;
          i += 2;
        } else if (sql[i] === '*' && sql[i + 1] === '/') {
          depth--;
          i += 2;
        } else i++;
      }
      if (depth > 0) unterminated('block comment', from);
    } else if (char === "'" || char === '"') {
      // E'...' strings also end at an unescaped quote; '' or "" is an escape.
      const from = i;
      const escapes =
        char === "'" &&
        /[eE]/.test(sql[i - 1] ?? '') &&
        !/\w/.test(sql[i - 2] ?? '');
      hasCode = true;
      i++;
      while (i < sql.length) {
        if (escapes && sql[i] === '\\') i += 2;
        else if (sql[i] === char && sql[i + 1] === char) i += 2;
        else if (sql[i] === char) break;
        else i++;
      }
      if (i >= sql.length)
        unterminated(char === "'" ? 'string' : 'quoted identifier', from);
      i++;
    } else if (char === '$') {
      const tag = /^\$(?:[A-Za-z_\u0080-\uffff][\w\u0080-\uffff]*)?\$/.exec(
        sql.slice(i),
      );
      // A $n parameter is not a quote; identifiers holding $ are read as words.
      if (tag) {
        const close = sql.indexOf(tag[0], i + tag[0].length);
        if (close === -1) unterminated(`${tag[0]} dollar quote`, i);
        i = close + tag[0].length;
      } else i++;
      hasCode = true;
    } else if (/[A-Za-z_\u0080-\uffff]/.test(char)) {
      const word = /^[\w$\u0080-\uffff]+/.exec(sql.slice(i))![0];
      const lower = word.toLowerCase();
      if (words.length < 4) words.push(lower);
      // As in psql: only outside parentheses, and CASE ... END counts only
      // inside a BEGIN, so a parameter named begin does not open a body.
      if (parenDepth === 0 && routine()) {
        if (lower === 'begin' || (lower === 'case' && beginDepth > 0))
          beginDepth++;
        else if (lower === 'end' && beginDepth > 0) beginDepth--;
      }
      hasCode = true;
      i += word.length;
    } else if (char === '(' || char === ')') {
      parenDepth = Math.max(0, parenDepth + (char === '(' ? 1 : -1));
      hasCode = true;
      i++;
    } else if (char === ';' && beginDepth === 0) {
      end(i);
      i++;
    } else {
      if (!/\s/.test(char)) hasCode = true;
      i++;
    }
  }
  end(sql.length);
  return statements;
};

export const DESCRIBE_DATABASE_STATEMENTS = [
  `
CREATE OR REPLACE FUNCTION public.show_db_tree()
RETURNS TABLE (tree_structure text) AS
$$
BEGIN
    -- First show all databases
    RETURN QUERY
    SELECT ':file_folder: ' || datname || ' (DATABASE)'
    FROM pg_database 
    WHERE datistemplate = false;

    -- Then show current database structure
    RETURN QUERY
    WITH RECURSIVE 
    -- Get schemas
    schemas AS (
        SELECT 
            n.nspname AS object_name,
            1 AS level,
            n.nspname AS path,
            'SCHEMA' AS object_type
        FROM pg_namespace n
        WHERE n.nspname NOT LIKE 'pg_%' 
        AND n.nspname != 'information_schema'
    ),

    -- Get all objects (tables, views, functions, etc.)
    objects AS (
        SELECT 
            c.relname AS object_name,
            2 AS level,
            s.path || ' → ' || c.relname AS path,
            CASE c.relkind
                WHEN 'r' THEN 'TABLE'
                WHEN 'v' THEN 'VIEW'
                WHEN 'm' THEN 'MATERIALIZED VIEW'
                WHEN 'i' THEN 'INDEX'
                WHEN 'S' THEN 'SEQUENCE'
                WHEN 'f' THEN 'FOREIGN TABLE'
            END AS object_type
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN schemas s ON n.nspname = s.object_name
        WHERE c.relkind IN ('r','v','m','i','S','f')

        UNION ALL

        SELECT 
            p.proname AS object_name,
            2 AS level,
            s.path || ' → ' || p.proname AS path,
            'FUNCTION' AS object_type
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        JOIN schemas s ON n.nspname = s.object_name
    ),

    -- Combine schemas and objects
    combined AS (
        SELECT * FROM schemas
        UNION ALL
        SELECT * FROM objects
    )

    -- Final output with tree-like formatting
    SELECT 
        REPEAT('    ', level) || 
        CASE 
            WHEN level = 1 THEN '└── :open_file_folder: '
            ELSE '    └── ' || 
                CASE object_type
                    WHEN 'TABLE' THEN ':bar_chart: '
                    WHEN 'VIEW' THEN ':eye: '
                    WHEN 'MATERIALIZED VIEW' THEN ':newspaper: '
                    WHEN 'FUNCTION' THEN ':zap: '
                    WHEN 'INDEX' THEN ':mag: '
                    WHEN 'SEQUENCE' THEN ':1234: '
                    WHEN 'FOREIGN TABLE' THEN ':globe_with_meridians: '
                    ELSE ''
                END
        END || object_name || ' (' || object_type || ')'
    FROM combined
    ORDER BY path;
END;
$$ LANGUAGE plpgsql;
`,
  `     
-- To use the function:
SELECT * FROM show_db_tree();
`,
];

export const DROP_DB_TREE_FUNCTION_STATEMENT =
  'DROP FUNCTION IF EXISTS public.show_db_tree();';

/**
 * Returns the default database for a project branch
 * If a database name is provided, it fetches and returns that database
 * Otherwise, it looks for a database named 'neondb' and returns that
 * If 'neondb' doesn't exist, it returns the first available database
 * Throws an error if no databases are found
 */
export async function getDefaultDatabase(
  {
    projectId,
    branchId,
    databaseName,
  }: {
    projectId: string;
    branchId: string;
    databaseName?: string;
  },
  neonClient: Api<unknown>,
) {
  const { data } = await neonClient.listProjectBranchDatabases(
    projectId,
    branchId,
  );
  const databases = data.databases;
  if (databases.length === 0) {
    throw new NotFoundError('No databases found in your project branch');
  }

  if (databaseName) {
    const requestedDatabase = databases.find((db) => db.name === databaseName);
    if (requestedDatabase) {
      return requestedDatabase;
    }
  }

  const defaultDatabase = databases.find(
    (db) => db.name === NEON_DEFAULT_DATABASE_NAME,
  );
  return defaultDatabase || databases[0];
}

/**
 * The projects API requires org_id. Take it from the argument, an org API key,
 * or the account's unique organization.
 */
export async function getOrgByOrgIdOrDefault(
  params: { org_id?: string },
  neonClient: Api<unknown>,
  extra: ToolHandlerExtraParams,
): Promise<{ id: string }> {
  if (params.org_id) {
    return { id: params.org_id };
  }
  if (extra.account.isOrg) {
    return { id: extra.account.id };
  }

  const { data: response } = await neonClient.getCurrentUserOrganizations();
  const organizations = response.organizations || [];

  // 1. Filter organizations by managed_by==console, if there is only one organization, return that
  const consoleOrganizations = organizations.filter(
    (org) => org.managed_by === 'console',
  );

  if (consoleOrganizations.length === 1) {
    return consoleOrganizations[0];
  }

  // 2. If there are no organizations managed by console, and if there is only one organization (unfiltered), then return that organization
  if (consoleOrganizations.length === 0 && organizations.length === 1) {
    return organizations[0];
  }

  // 3. If there are no organizations at all, then throw error saying there are no organizations
  if (organizations.length === 0) {
    throw new NotFoundError('No organizations found for this user');
  }

  // 4. If there are multiple organizations, then throw error mentioning list of all these orgs (unfiltered)
  const orgList = organizations
    .map(
      (org) => `- ${org.name} (ID: ${org.id}) [managed by: ${org.managed_by}]`,
    )
    .join('\n');
  throw new NotFoundError(
    `Multiple organizations found. Please specify the org_id parameter with one of the following organization IDs:\n${orgList}`,
  );
}

export function filterOrganizations(
  organizations: Organization[],
  search?: string,
) {
  if (!search) {
    return organizations;
  }
  const searchLower = search.toLowerCase();
  return organizations.filter(
    (org) =>
      org.name.toLowerCase().includes(searchLower) ||
      org.id.toLowerCase().includes(searchLower),
  );
}
