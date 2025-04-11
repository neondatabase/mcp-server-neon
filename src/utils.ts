export const splitSqlStatements = (sql: string) => {
  return sql.split(';').filter(Boolean);
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

import { neonClient } from './index.js';
import { NEON_DEFAULT_DATABASE_NAME } from './constants.js';

/**
 * Returns the default database for a project branch
 * If a database name is provided, it returns that name
 * Otherwise, it looks for a database named 'neondb' and returns that
 * If 'neondb' doesn't exist, it returns the first available database
 * Throws an error if no databases are found
 */
export async function getDefaultDatabase({
  projectId,
  branchId,
  databaseName,
}: {
  projectId: string;
  branchId: string;
  databaseName?: string;
}): Promise<string> {
  if (databaseName) return databaseName;

  const { data } = await neonClient.listProjectBranchDatabases(
    projectId,
    branchId,
  );
  const databases = data.databases;
  if (databases.length === 0) {
    throw new Error('No databases found in your project branch');
  }

  const defaultDatabase = databases.find(
    (db) => db.name === NEON_DEFAULT_DATABASE_NAME,
  );
  return defaultDatabase ? defaultDatabase.name : databases[0].name;
}
