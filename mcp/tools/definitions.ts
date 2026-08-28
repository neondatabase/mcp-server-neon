import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { ScopeCategory } from '../utils/grant-context';
import type { ZodTypeAny } from 'zod/v3';
import { createGeneratedToolDefinitions } from './generated/adapt';
import type { NeonTool } from './tool-definition';
import {
  completeDatabaseMigrationInputSchema,
  completeQueryTuningInputSchema,
  describeBranchInputSchema,
  describeTableSchemaInputSchema,
  explainSqlStatementInputSchema,
  getConnectionStringInputSchema,
  getDatabaseTablesInputSchema,
  inspectDatabaseInputSchema,
  prepareDatabaseMigrationInputSchema,
  prepareQueryTuningInputSchema,
  getNeonAuthConfigInputSchema,
  runSqlInputSchema,
  runSqlTransactionInputSchema,
  listSlowQueriesInputSchema,
  listOrganizationsInputSchema,
  searchInputSchema,
  fetchInputSchema,
  listDocsResourcesInputSchema,
  getDocResourceInputSchema,
} from './toolsSchema';

type HostToolDraft = {
  name: string;
  scope: ScopeCategory | null;
  description: string;
  inputSchema: ZodTypeAny;
  readOnlySafe: boolean;
  annotations: ToolAnnotations;
};

const HOST_NOT_PROJECT_SCOPED = new Set([
  'list_organizations',
  'search',
  'fetch',
]);

const HOST_TOOL_DRAFTS = [
  {
    name: 'list_organizations' as const,
    scope: 'projects',
    description: `List all organizations the current user belongs to. Supports optional \`search\` parameter to filter by name or ID.`,
    inputSchema: listOrganizationsInputSchema,
    readOnlySafe: true,
    annotations: {
      title: 'List Organizations',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    } satisfies ToolAnnotations,
  },
  {
    name: 'run_sql' as const,
    scope: 'querying',
    description:
      'Execute one SQL statement on a Neon database. If a prior step created a temporary branch, pass that branch_id. NEVER run destructive SQL autonomously; always ask the user first.',
    inputSchema: runSqlInputSchema,
    readOnlySafe: true,
    annotations: {
      title: 'Run SQL',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    } satisfies ToolAnnotations,
  },
  {
    name: 'run_sql_transaction' as const,
    scope: 'querying',
    description:
      'Execute multiple SQL statements as one transaction. If a prior step created a temporary branch, pass that branch_id. NEVER run destructive SQL autonomously; always ask the user first.',
    inputSchema: runSqlTransactionInputSchema,
    readOnlySafe: true,
    annotations: {
      title: 'Run SQL Transaction',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    } satisfies ToolAnnotations,
  },
  {
    name: 'describe_table_schema' as const,
    scope: 'schema',
    description:
      'Get column definitions, data types, and constraints for a specific table. Do not use when you need all tables in a database (use `get_database_tables` instead).',
    inputSchema: describeTableSchemaInputSchema,
    readOnlySafe: true,
    annotations: {
      title: 'Describe Table Schema',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    } satisfies ToolAnnotations,
  },
  {
    name: 'get_database_tables' as const,
    scope: 'schema',
    description:
      'List all tables in a Neon database. Do not use when you need column-level detail for a specific table (use `describe_table_schema` instead).',
    inputSchema: getDatabaseTablesInputSchema,
    readOnlySafe: true,
    annotations: {
      title: 'Get Database Tables',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    } satisfies ToolAnnotations,
  },
  {
    name: 'prepare_database_migration' as const,
    scope: 'querying',
    readOnlySafe: false,
    description:
      'Apply a schema change on a temporary branch and return a migration_id. Test with run_sql on that branch, ask the user, then complete_database_migration — even if they reject, so the temporary branch is deleted. Pass every field from the prepare response.',
    inputSchema: prepareDatabaseMigrationInputSchema,
    annotations: {
      title: 'Prepare Database Migration',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    } satisfies ToolAnnotations,
  },
  {
    name: 'complete_database_migration' as const,
    scope: 'querying',
    description:
      'Apply or discard a prepared migration and delete the temporary branch. NEVER run autonomously; always ask the user first. Pass migration_id, migration_sql, database_name, project_id, temporary_branch_id, and parent_branch_id from prepare_database_migration. Set apply_changes false to discard; omitting it applies the migration.',
    inputSchema: completeDatabaseMigrationInputSchema,
    readOnlySafe: false,
    annotations: {
      title: 'Complete Database Migration',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    } satisfies ToolAnnotations,
  },
  {
    name: 'describe_branch' as const,
    scope: 'branches',
    description:
      'Get a tree view of all objects in a branch, including databases, schemas, tables, views, and functions. Do not use when you only need table names (use `get_database_tables` instead) or column detail (use `describe_table_schema` instead).',
    inputSchema: describeBranchInputSchema,
    readOnlySafe: true,
    annotations: {
      title: 'Describe Branch',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    } satisfies ToolAnnotations,
  },
  {
    name: 'get_connection_string' as const,
    scope: 'branches',
    description:
      'Get a PostgreSQL connection string for a Neon database. The branch must have a compute endpoint. `create_project` and `create_branch` do not return one; call this after they succeed. All parameters are optional; the tool resolves the project, branch, and database automatically if not specified. Requires write access: the connection string carries a privileged role password, so it is unavailable in read-only mode. A read-only caller who needs a DATABASE_URL must copy it from https://console.neon.tech manually.',
    inputSchema: getConnectionStringInputSchema,
    // Not `readOnlySafe` despite `readOnlyHint: true`: the call mutates nothing,
    // but the URI it returns embeds the branch owner role's password. That role
    // is a `neon_superuser` member with `CREATEROLE`, and its password
    // authenticates against the read-write compute no matter which endpoint
    // host the URI names — so handing it to a read-only caller lets them leave
    // the sandbox entirely and run DDL/DML directly.
    readOnlySafe: false,
    annotations: {
      title: 'Get Connection String',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    } satisfies ToolAnnotations,
  },
  {
    name: 'get_neon_auth_config' as const,
    scope: 'neon_auth',
    inputSchema: getNeonAuthConfigInputSchema,
    readOnlySafe: true,
    description:
      'Read Neon Auth config for a branch with OAuth and SMTP secrets redacted as "***redacted***". Requires provision_neon_auth first.',
    annotations: {
      title: 'Get Neon Auth configuration',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    } satisfies ToolAnnotations,
  },
  {
    name: 'explain_sql_statement' as const,
    scope: 'querying',
    description:
      'Analyze the query execution plan for a SQL statement using EXPLAIN ANALYZE. Do not use when you need to execute the query for results (use `run_sql` instead).',
    inputSchema: explainSqlStatementInputSchema,
    readOnlySafe: true,
    annotations: {
      title: 'Explain SQL Statement',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    } satisfies ToolAnnotations,
  },
  {
    name: 'prepare_query_tuning' as const,
    scope: 'querying',
    readOnlySafe: false,
    description:
      'Analyze a slow query on a temporary branch and return a tuning_id. Apply suggested SQL with run_sql on that branch, re-run explain_sql_statement there, then complete_query_tuning with the tuning_id (not the branch id) — even if the user rejects, so the temporary branch is deleted. Do not use prepare_database_migration.',
    inputSchema: prepareQueryTuningInputSchema,
    annotations: {
      title: 'Prepare Query Tuning',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    } satisfies ToolAnnotations,
  },
  {
    name: 'complete_query_tuning' as const,
    scope: 'querying',
    readOnlySafe: false,
    description:
      'Apply or discard query-tuning changes and delete the temporary branch. NEVER run autonomously. Before calling, apply suggested SQL with run_sql on the temporary branch and re-run explain_sql_statement. Pass the tuning_id from prepare_query_tuning, not the branch id, plus temporary_branch_id. Call this even when the user rejects the changes. Do not use prepare_database_migration.',
    inputSchema: completeQueryTuningInputSchema,
    annotations: {
      title: 'Complete Query Tuning',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    } satisfies ToolAnnotations,
  },
  {
    name: 'list_slow_queries' as const,
    scope: 'querying',
    description:
      'List queries from pg_stat_statements by execution time, slowest first. For sizes, indexes, locks, cache, bloat, or replication use inspect_database.',
    inputSchema: listSlowQueriesInputSchema,
    readOnlySafe: true,
    annotations: {
      title: 'List Slow Queries',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    } satisfies ToolAnnotations,
  },
  {
    name: 'inspect_database' as const,
    scope: 'querying',
    description:
      "Run one read-only neon inspect db check (pick `check` from the input schema). Not for arbitrary SQL (`run_sql`), one statement's plan (`explain_sql_statement`), or applying indexes (`prepare_query_tuning`). Omit `database_name` to cover every database; some checks are compute-wide. If a check needs an extension, the tool names `CREATE EXTENSION`; ask before running it.",
    inputSchema: inspectDatabaseInputSchema,
    readOnlySafe: true,
    annotations: {
      title: 'Inspect Database',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    } satisfies ToolAnnotations,
  },
  {
    name: 'search' as const,
    scope: null,
    description: `Search across all organizations, projects, and branches by keyword. Returns matching items with id, title, and URL. Query must be at least 3 characters. Do not use when you need all projects (use \`list_projects\` instead).`,
    inputSchema: searchInputSchema,
    readOnlySafe: true,
    annotations: {
      title: 'Search',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    } satisfies ToolAnnotations,
  },
  {
    name: 'fetch' as const,
    scope: null,
    description: `Fetch detailed information about a specific organization, project, or branch using the ID returned by the \`search\` tool.`,
    inputSchema: fetchInputSchema,
    readOnlySafe: true,
    annotations: {
      title: 'Fetch',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    } satisfies ToolAnnotations,
  },
  {
    name: 'list_docs_resources' as const,
    scope: 'docs',
    description:
      'List Neon documentation page slugs from neon.com/docs/llms.txt. Call this before get_doc_resource; do not guess slugs.',
    inputSchema: listDocsResourcesInputSchema,
    readOnlySafe: true,
    annotations: {
      title: 'List Documentation Resources',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    } satisfies ToolAnnotations,
  },
  {
    name: 'get_doc_resource' as const,
    scope: 'docs',
    description:
      'Fetch one Neon documentation page as markdown. Pass a slug from list_docs_resources (for example docs/guides/prisma.md).',
    inputSchema: getDocResourceInputSchema,
    readOnlySafe: true,
    annotations: {
      title: 'Get Documentation Resource',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    } satisfies ToolAnnotations,
  },
] as const satisfies readonly HostToolDraft[];

export const HOST_TOOLS: NeonTool[] = HOST_TOOL_DRAFTS.map((tool) => ({
  ...tool,
  kind: 'host',
  projectScoped: !HOST_NOT_PROJECT_SCOPED.has(tool.name),
}));

export const NEON_TOOLS: NeonTool[] = [
  ...HOST_TOOLS,
  ...createGeneratedToolDefinitions(),
];
