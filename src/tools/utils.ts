import { NEON_DEFAULT_DATABASE_NAME } from '../constants.js';
import { Api, Organization } from '@neondatabase/api-client';

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
    throw new Error('No databases found in your project branch');
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
 * Resolves the organization ID for API calls that require org_id parameter.
 *
 * For new users (those without billing_account), this function fetches user's organizations and auto-selects only organization managed by console. If there are multiple organizations managed by console, it throws an error asking user to specify org_id.
 *
 * For existing users (with billing_account), returns undefined to use default behavior.
 *
 * @param params - The parameters object that may contain org_id
 * @param neonClient - The Neon API client
 * @returns The organization to use, or undefined for default behavior
 */
export async function getOrgByOrgIdOrDefault(
  params: { org_id?: string },
  neonClient: Api<unknown>,
): Promise<Organization | undefined> {
  if (params.org_id) {
    const { data } = await neonClient.getOrganization(params.org_id);
    return data;
  }

  const { data: account } = await neonClient.getAuthDetails();
  if (account.auth_method == 'api_key_org') {
    const { data } = await neonClient.getOrganization(account.account_id);
    return data;
  }

  const { data: user } = await neonClient.getCurrentUserInfo();
  if (user.billing_account) {
    return undefined;
  }

  const { data: response } = await neonClient.getCurrentUserOrganizations();
  const organizations = response.organizations || [];
  const consoleOrganizations = organizations.filter(
    (org) => org.managed_by === 'console',
  );

  if (consoleOrganizations.length === 0) {
    throw new Error('No organizations found for this user');
  }

  if (consoleOrganizations.length === 1) {
    return consoleOrganizations[0];
  } else {
    const orgList = consoleOrganizations
      .map((org) => `- ${org.name} (ID: ${org.id})`)
      .join('\n');
    throw new Error(
      `Multiple organizations found. Please specify the org_id parameter with one of the following organization IDs:\n${orgList}`,
    );
  }
}
