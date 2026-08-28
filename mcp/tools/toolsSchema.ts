// IMPORTANT: Use zod/v3 types for MCP registration compatibility.
// @modelcontextprotocol/sdk@1.25.x accepts schemas typed through its zod-compat layer
// (zod/v3 or zod/v4/core). Using plain `zod` imports here can create type-identity
// mismatches at registerTool boundaries in Next.js builds.
//
// Revisit this once the MCP SDK publishes a single-zod type surface that no longer
// requires cross-version compatibility shims.
import { z } from 'zod/v3';
import { NEON_DEFAULT_DATABASE_NAME } from '../constants';
import {
  INSPECT_CHECK_LIST,
  INSPECT_CHECKS,
  INSPECT_DEFAULT_LIMIT,
  INSPECT_MAX_LIMIT,
} from '../inspect/queries';

const DATABASE_NAME_DESCRIPTION = `The name of the database. If not provided, the default ${NEON_DEFAULT_DATABASE_NAME} or first available database is used.`;

const INSPECT_DATABASE_NAME_DESCRIPTION =
  'Database to inspect. Omit to cover every database on the branch. Ranking and SQL row limits stay per database. One failing database fails the whole run. Compute-wide checks run once against the first listed database. The response `limit` applies to the combined rows after that.';

export const runSqlInputSchema = z
  .object({
    sql: z.string().describe('The SQL query to execute'),
    project_id: z
      .string()
      .describe('The ID of the project to execute the query against'),
    branch_id: z
      .string()
      .optional()
      .describe(
        'An optional ID of the branch to execute the query against. If not provided the default branch is used.',
      ),
    database_name: z.string().optional().describe(DATABASE_NAME_DESCRIPTION),
  })
  .strict();

export const runSqlTransactionInputSchema = z
  .object({
    sql_statements: z
      .array(z.string())
      .describe('The SQL statements to execute'),
    project_id: z
      .string()
      .describe('The ID of the project to execute the query against'),
    branch_id: z
      .string()
      .optional()
      .describe(
        'An optional ID of the branch to execute the query against. If not provided the default branch is used.',
      ),
    database_name: z.string().optional().describe(DATABASE_NAME_DESCRIPTION),
  })
  .strict();

export const explainSqlStatementInputSchema = z
  .object({
    sql: z.string().describe('The SQL statement to analyze'),
    project_id: z
      .string()
      .describe('The ID of the project to execute the query against'),
    branch_id: z
      .string()
      .optional()
      .describe(
        'An optional ID of the branch to execute the query against. If not provided the default branch is used.',
      ),
    database_name: z.string().optional().describe(DATABASE_NAME_DESCRIPTION),
    analyze: z
      .boolean()
      .default(true)
      .describe('Whether to include ANALYZE in the EXPLAIN command'),
  })
  .strict();

export const describeTableSchemaInputSchema = z
  .object({
    table_name: z
      .string()
      .describe(
        'The table name, optionally schema-qualified (for example, crm.contacts)',
      ),
    project_id: z
      .string()
      .describe('The ID of the project to execute the query against'),
    branch_id: z
      .string()
      .optional()
      .describe(
        'An optional ID of the branch to execute the query against. If not provided the default branch is used.',
      ),
    database_name: z.string().optional().describe(DATABASE_NAME_DESCRIPTION),
  })
  .strict();

export const getDatabaseTablesInputSchema = z
  .object({
    project_id: z.string().describe('The ID of the project'),
    branch_id: z
      .string()
      .optional()
      .describe(
        'An optional ID of the branch. If not provided the default branch is used.',
      ),
    database_name: z.string().optional().describe(DATABASE_NAME_DESCRIPTION),
  })
  .strict();

export const prepareDatabaseMigrationInputSchema = z
  .object({
    migration_sql: z
      .string()
      .describe('The SQL to execute to create the migration'),
    project_id: z
      .string()
      .describe('The ID of the project to execute the query against'),
    database_name: z.string().optional().describe(DATABASE_NAME_DESCRIPTION),
  })
  .strict();

export const completeDatabaseMigrationInputSchema = z
  .object({
    migration_id: z
      .string()
      .describe('The migration ID from prepare_database_migration.'),
    migration_sql: z
      .string()
      .describe(
        'The SQL statements to apply. Pass the exact value from prepare_database_migration.',
      ),
    database_name: z
      .string()
      .describe(
        'The database name. Pass the exact value from prepare_database_migration.',
      ),
    project_id: z
      .string()
      .describe(
        'The project ID. Pass the exact value from prepare_database_migration.',
      ),
    temporary_branch_id: z
      .string()
      .describe('The temporary branch ID to delete after migration.'),
    parent_branch_id: z
      .string()
      .describe('The parent branch ID where migration will be applied.'),
    apply_changes: z
      .boolean()
      .default(true)
      .describe(
        'Whether to apply the migration. Set to false to just delete the temp branch without applying.',
      ),
  })
  .strict();

export const describeBranchInputSchema = z
  .object({
    project_id: z.string().describe('The ID of the project'),
    branch_id: z.string().describe('An ID of the branch to describe'),
    database_name: z.string().optional().describe(DATABASE_NAME_DESCRIPTION),
  })
  .strict();

export const getConnectionStringInputSchema = z
  .object({
    project_id: z
      .string()
      .describe(
        'The ID of the project. If not provided, the only available project will be used.',
      ),
    branch_id: z
      .string()
      .optional()
      .describe(
        'The ID or name of the branch. If not provided, the default branch will be used.',
      ),
    compute_id: z
      .string()
      .optional()
      .describe(
        'The ID of the compute/endpoint. If not provided, the read-write compute associated with the branch will be used.',
      ),
    database_name: z.string().optional().describe(DATABASE_NAME_DESCRIPTION),
    role_name: z
      .string()
      .optional()
      .describe(
        'The name of the role to connect with. If not provided, the database owner name will be used.',
      ),
  })
  .strict();

export const getNeonAuthConfigInputSchema = z
  .object({
    project_id: z.string().describe('Neon project ID'),
    branch_id: z
      .string()
      .optional()
      .describe(
        'Branch ID. If omitted, the project default branch is used (same as provision_neon_auth).',
      ),
  })
  .strict();

export const prepareQueryTuningInputSchema = z
  .object({
    sql: z.string().describe('The SQL statement to analyze and tune'),
    database_name: z
      .string()
      .describe('The name of the database to execute the query against'),
    project_id: z
      .string()
      .describe('The ID of the project to execute the query against'),
    role_name: z
      .string()
      .optional()
      .describe(
        'The name of the role to connect with. If not provided, the default role (usually "neondb_owner") will be used.',
      ),
  })
  .strict();

export const completeQueryTuningInputSchema = z
  .object({
    suggested_sql_statements: z
      .array(z.string())
      .describe(
        'The SQL DDL statements to execute to improve performance. These statements are the result of the prior steps, for example creating additional indexes.',
      ),
    apply_changes: z
      .boolean()
      .default(false)
      .describe('Whether to apply the suggested changes to the main branch'),
    tuning_id: z
      .string()
      .describe(
        'The ID of the tuning to complete. This is NOT the branch ID. Remember this ID from the prior step using tool prepare_query_tuning.',
      ),
    database_name: z
      .string()
      .describe('The name of the database to execute the query against'),
    project_id: z
      .string()
      .describe('The ID of the project to execute the query against'),
    role_name: z
      .string()
      .optional()
      .describe(
        'The name of the role to connect with. If you have used a specific role in prepare_query_tuning you MUST pass the same role again to this tool. If not provided, the default role (usually "neondb_owner") will be used.',
      ),
    should_delete_temporary_branch: z
      .boolean()
      .default(true)
      .describe('Whether to delete the temporary branch after tuning'),
    temporary_branch_id: z
      .string()
      .describe(
        'The ID of the temporary branch that needs to be deleted after tuning.',
      ),
    branch_id: z
      .string()
      .optional()
      .describe(
        'The ID or name of the branch that receives the changes. If not provided, the default (main) branch will be used.',
      ),
  })
  .strict();

export const listSlowQueriesInputSchema = z
  .object({
    project_id: z
      .string()
      .describe('The ID of the project to list slow queries from'),
    branch_id: z
      .string()
      .optional()
      .describe(
        'An optional ID of the branch. If not provided the default branch is used.',
      ),
    database_name: z.string().optional().describe(DATABASE_NAME_DESCRIPTION),
    compute_id: z
      .string()
      .optional()
      .describe(
        'The ID of the compute/endpoint. If not provided, the read-write compute associated with the branch will be used.',
      ),
    limit: z
      .number()
      .optional()
      .default(10)
      .describe('Maximum number of slow queries to return'),
    min_execution_time: z
      .number()
      .optional()
      .default(1000)
      .describe(
        'Minimum execution time in milliseconds to consider a query as slow',
      ),
  })
  .strict();

export const inspectDatabaseInputSchema = z
  .object({
    check: z
      .enum(INSPECT_CHECKS)
      .describe(`Which diagnostic to run:\n${INSPECT_CHECK_LIST}`),
    project_id: z.string().describe('The ID of the project to inspect'),
    branch_id: z
      .string()
      .optional()
      .describe(
        'An optional ID of the branch. If not provided the default branch is used.',
      ),
    database_name: z
      .string()
      .min(1, 'database_name cannot be empty. Omit it to cover every database.')
      .optional()
      .describe(INSPECT_DATABASE_NAME_DESCRIPTION),
    compute_id: z
      .string()
      .optional()
      .describe(
        'The ID of the compute/endpoint. If not provided, the read-write compute associated with the branch will be used.',
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(INSPECT_MAX_LIMIT)
      .optional()
      .default(INSPECT_DEFAULT_LIMIT)
      .describe(
        'Maximum number of rows to return from the combined result. Per-database ranking and SQL caps are applied first. The response reports how many rows the check produced and whether they were truncated, so raise this only when `truncated` is true. A few checks are capped in SQL and say so in their description.',
      ),
  })
  .strict();

export const listOrganizationsInputSchema = z
  .object({
    search: z
      .string()
      .optional()
      .describe(
        'Search organizations by name or ID. You can specify partial name or ID values to filter results.',
      ),
  })
  .strict();

export const searchInputSchema = z
  .object({
    query: z
      .string()
      .min(3)
      .describe(
        'The search query to find matching organizations, projects, or branches',
      ),
  })
  .strict();

export const fetchInputSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .describe(
        'The ID returned by the search tool to fetch detailed information about the entity',
      ),
  })
  .strict();

export const listDocsResourcesInputSchema = z.object({}).strict();

export const getDocResourceInputSchema = z
  .object({
    slug: z
      .string()
      .describe(
        "The docs page slug (path) to fetch, e.g. 'docs/guides/prisma.md'. Slugs use .md file endings matching the URLs in the documentation index. Use the list_docs_resources tool first to discover available slugs.",
      ),
  })
  .strict();
