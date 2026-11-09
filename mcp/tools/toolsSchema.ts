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
import { SQL_DEFAULT_MAX_ROWS, SQL_MAX_ROWS_LIMIT } from './sql-rows';

const DATABASE_NAME_DESCRIPTION = `The name of the database. If not provided, the default ${NEON_DEFAULT_DATABASE_NAME} or first available database is used.`;

const INSPECT_DATABASE_NAME_DESCRIPTION =
  'For a database-scoped check, the database to inspect. Omit to cover every database on the branch. Ranking and SQL row limits stay per database. One failing database fails the whole run. For a compute-wide check, the database to connect through; the check still runs once for the whole compute and the result does not include `databaseName`. The response `limit` applies to the combined rows after that.';

const SQL_ROLE_NAME_DESCRIPTION =
  'An optional Postgres role to log in as. The server resolves its credentials internally and never returns them. If not provided, the database owner is used. On a connection pinned to a role, omit this or pass that role.';

const SQL_COMPUTE_ID_DESCRIPTION =
  'An optional ID of the compute/endpoint to run on. If not provided, the read-write compute of the branch is used.';

const sqlMaxRowsSchema = z
  .number()
  .int()
  .min(1)
  .max(SQL_MAX_ROWS_LIMIT)
  .optional()
  .default(SQL_DEFAULT_MAX_ROWS)
  .describe(
    'Maximum number of rows to return per statement. When a statement returns more, the response adds a second block with `totalRowCount` and `truncated: true`; raise this only then.',
  );

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
    role_name: z.string().optional().describe(SQL_ROLE_NAME_DESCRIPTION),
    compute_id: z.string().optional().describe(SQL_COMPUTE_ID_DESCRIPTION),
    max_rows: sqlMaxRowsSchema,
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
    role_name: z.string().optional().describe(SQL_ROLE_NAME_DESCRIPTION),
    compute_id: z.string().optional().describe(SQL_COMPUTE_ID_DESCRIPTION),
    max_rows: sqlMaxRowsSchema,
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
      .default(false)
      .describe(
        'Whether to execute the statement with EXPLAIN ANALYZE. Defaults to false because execution may cause side effects.',
      ),
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

export const describeBranchInputSchema = z
  .object({
    project_id: z.string().describe('The ID of the project'),
    branch_id: z.string().describe('An ID of the branch to describe'),
    database_name: z.string().optional().describe(DATABASE_NAME_DESCRIPTION),
  })
  .strict();

export const getConnectionStringInputSchema = z
  .object({
    project_id: z.string().describe('The ID of the project.'),
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

const SITE_SEARCH_CATEGORIES = [
  'docs',
  'api',
  'postgresql',
  'guides',
  'faqs',
  'blog',
  'changelog',
] as const;

export const searchDocsInputSchema = z
  .object({
    query: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .describe(
        'What to search for, in words, e.g. "reset a branch" or "connection pooling".',
      ),
    categories: z
      .array(z.enum(SITE_SEARCH_CATEGORIES))
      .min(1)
      .max(SITE_SEARCH_CATEGORIES.length)
      .refine((values) => new Set(values).size === values.length, {
        message: 'categories must not repeat a value',
      })
      .optional()
      .describe(
        'Only return pages in these categories: docs, api (API reference), postgresql (PostgreSQL tutorial), guides, faqs, blog, changelog. Omit to search everything.',
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(40)
      .default(10)
      .describe('Maximum number of pages to return (1-40).'),
  })
  .strict();

// The feedback service truncates longer messages, so reject them instead.
export const MAX_FEEDBACK_LENGTH = 10_000;

export const sendFeedbackInputSchema = z
  .object({
    feedback: z
      .string()
      .trim()
      .min(1)
      .max(MAX_FEEDBACK_LENGTH)
      .describe(
        'The feedback to send to Neon. Do not include passwords, API keys, connection strings, or other secrets.',
      ),
  })
  .strict();

export const getDocInputSchema = z
  .object({
    slug: z
      .string()
      .describe(
        "The slug of a hit returned by search_docs, e.g. 'docs/guides/prisma' or 'postgresql/tutorial/inner-join'.",
      ),
  })
  .strict();
