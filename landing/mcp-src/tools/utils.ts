import { NEON_DEFAULT_DATABASE_NAME } from "../constants";
import { Api, Organization, Branch } from "@neondatabase/api-client";
import { ToolHandlerExtraParams } from "./types";
import { NotFoundError } from "../server/errors";

export const splitSqlStatements = (sql: string) => {
  return sql.split(";").filter(Boolean);
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
    throw new NotFoundError("No databases found in your project branch");
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
  extra: ToolHandlerExtraParams,
): Promise<Organization | undefined> {
  // 1. If org_id is provided use it
  // 2. If using Org API key, use the account id
  if (params.org_id || extra.account.isOrg) {
    const orgId = params.org_id || extra.account.id;
    const { data } = await neonClient.getOrganization(orgId);
    return data;
  }

  const { data: user } = await neonClient.getCurrentUserInfo();
  if (user.billing_account) {
    return undefined;
  }

  const { data: response } = await neonClient.getCurrentUserOrganizations();
  const organizations = response.organizations || [];

  // 1. Filter organizations by managed_by==console, if there is only one organization, return that
  const consoleOrganizations = organizations.filter(
    (org) => org.managed_by === "console",
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
    throw new NotFoundError("No organizations found for this user");
  }

  // 4. If there are multiple organizations, then throw error mentioning list of all these orgs (unfiltered)
  const orgList = organizations
    .map(
      (org) => `- ${org.name} (ID: ${org.id}) [managed by: ${org.managed_by}]`,
    )
    .join("\n");
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

/**
 * Checks if a string looks like a branch ID based on the neonctl format
 * Branch IDs have format like "br-small-term-683261" (br- prefix + haiku pattern)
 */
export function looksLikeBranchId(branch: string): boolean {
  const HAIKU_REGEX = /^[a-z0-9]+-[a-z0-9]+-[a-z0-9]+$/;
  return branch.startsWith("br-") && HAIKU_REGEX.test(branch.substring(3));
}

/**
 * Checks if a string looks like a project ID based on format from console
 * Project IDs have format like "small-term-683261"
 */
export function looksLikeProjectId(projectId: string): boolean {
  const HAIKU_REGEX = /^[a-zA-Z]+-[a-zA-Z]+-[0-9]{8}$/;
  return HAIKU_REGEX.test(projectId);
}

/**
 * Resolves a branch name or ID to the actual branch ID
 * If the input looks like a branch ID, returns it as-is
 * Otherwise, searches for a branch with matching name and returns its ID
 */
export async function resolveBranchId(
  branchNameOrId: string,
  projectId: string,
  neonClient: Api<unknown>,
): Promise<{ branchId: string; branches: Branch[] }> {
  // Get all branches (we'll need this data anyway)
  const branchResponse = await neonClient.listProjectBranches({
    projectId,
  });
  const branches = branchResponse.data.branches;

  if (looksLikeBranchId(branchNameOrId)) {
    // Verify the branch ID actually exists
    const branch = branches.find((b) => b.id === branchNameOrId);
    if (!branch) {
      throw new NotFoundError(
        `Branch ID "${branchNameOrId}" not found in project ${projectId}`,
      );
    }
    return { branchId: branchNameOrId, branches };
  }

  // Search by name
  const branch = branches.find((b) => b.name === branchNameOrId);
  if (!branch) {
    const availableBranches = branches.map((b) => b.name).join(", ");
    throw new NotFoundError(
      `Branch name "${branchNameOrId}" not found in project ${projectId}.\nAvailable branches: ${availableBranches}`,
    );
  }

  return { branchId: branch.id, branches };
}
