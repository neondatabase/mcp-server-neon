import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { NEON_DEFAULT_DATABASE_NAME } from '../constants';
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
    description: `
    <use_case>
      Use this tool to execute a single SQL statement against a Neon database.
    </use_case>

    <important_notes>
      If you have a temporary branch from a prior step, you MUST:
      1. Pass the branch ID to this tool unless explicitly told otherwise
      2. Tell the user that you are using the temporary branch with ID [branch_id]

      NEVER run destructive SQL (DROP, DELETE, TRUNCATE, UPDATE without WHERE) autonomously; always ask the user first. Prefer testing on a temporary branch first.
    </important_notes>`,
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
    description: `
    <use_case>
      Use this tool to execute a SQL transaction against a Neon database, should be used for multiple SQL statements.
    </use_case>

    <important_notes>
      If you have a temporary branch from a prior step, you MUST:
      1. Pass the branch ID to this tool unless explicitly told otherwise
      2. Tell the user that you are using the temporary branch with ID [branch_id]

      NEVER run destructive SQL (DROP, DELETE, TRUNCATE, UPDATE without WHERE) autonomously; always ask the user first. Prefer testing on a temporary branch first.
    </important_notes>`,
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
    description: `
  <use_case>
    This tool performs database schema migrations by automatically generating and executing DDL statements.
    
    Supported operations:
    CREATE operations:
    - Add new columns (e.g., "Add email column to users table")
    - Create new tables (e.g., "Create posts table with title and content columns")
    - Add constraints (e.g., "Add unique constraint on \`users.email\`")

    ALTER operations:
    - Modify column types (e.g., "Change posts.views to bigint")
    - Rename columns (e.g., "Rename user_name to username in users table")
    - Add/modify indexes (e.g., "Add index on \`posts.title\`")
    - Add/modify foreign keys (e.g., "Add foreign key from \`posts.user_id\` to \`users.id\`")

    DROP operations:
    - Remove columns (e.g., "Drop temporary_field from users table")
    - Drop tables (e.g., "Drop the old_logs table")
    - Remove constraints (e.g., "Remove unique constraint from posts.slug")

    The tool will:
    1. Parse your natural language request
    2. Generate appropriate SQL
    3. Execute in a temporary branch for safety
    4. Verify the changes before applying to main branch

    Project ID and database name will be automatically extracted from your request.
    If the database name is not provided, the default ${NEON_DEFAULT_DATABASE_NAME} or first available database is used.
  </use_case>

  <workflow>
    1. Creates a temporary branch
    2. Applies the migration SQL in that branch
    3. Returns migration details for verification
  </workflow>

  <important_notes>
    After executing this tool, you MUST:
    1. Test the migration in the temporary branch using the \`run_sql\` tool
    2. Ask for confirmation before proceeding
    3. Use \`complete_database_migration\` tool to apply changes to main branch
  </important_notes>

  <example>
    For a migration like:
    \`\`\`sql
    ALTER TABLE users ADD COLUMN last_login TIMESTAMP;
    \`\`\`
    
    You should test it with:
    \`\`\`sql
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'users' AND column_name = 'last_login';
    \`\`\`
    
    You can use \`run_sql\` to test the migration in the temporary branch that this tool creates.
  </example>


  <next_steps>
  After executing this tool, you MUST follow these steps:
    1. Use \`run_sql\` to verify changes on temporary branch
    2. Follow these instructions to respond to the client: 

      <response_instructions>
        <instructions>
          Provide a brief confirmation of the requested change and ask for migration commit approval.

          You MUST include ALL of the following fields in your response:
          - Migration ID (this is required for commit and must be shown first)  
          - Temporary Branch Name (always include exact branch name)
          - Temporary Branch ID (always include exact ID)
          - Migration Result (include brief success/failure status)

          Even if some fields are missing from the tool's response, use placeholders like "not provided" rather than omitting fields.
        </instructions>

        <do_not_include>
          IMPORTANT: Your response MUST NOT contain ANY technical implementation details such as:
          - Data types (e.g., DO NOT mention if a column is boolean, varchar, timestamp, etc.)
          - Column specifications or properties
          - SQL syntax or statements
          - Constraint definitions or rules
          - Default values
          - Index types
          - Foreign key specifications
          
          Keep the response focused ONLY on confirming the high-level change and requesting approval.
          
          <example>
            INCORRECT: "I've added a boolean \`is_published\` column to the \`posts\` table..."
            CORRECT: "I've added the \`is_published\` column to the \`posts\` table..."
          </example>
        </do_not_include>

        <example>
          I've verified that [requested change] has been successfully applied to a temporary branch. Would you like to commit the migration \`[migration_id]\` to the main branch?
          
          Migration Details:
          - Migration ID (required for commit)
          - Temporary Branch Name
          - Temporary Branch ID
          - Migration Result
        </example>
      </response_instructions>

    3. If approved, use \`complete_database_migration\` tool with the \`migration_id\`
  </next_steps>

  <error_handling>
    On error, the tool will:
    1. Automatically attempt ONE retry of the exact same operation
    2. If the retry fails:
      - Terminate execution
      - Return error details
      - DO NOT attempt any other tools or alternatives
    
    Error response will include:
    - Original error details
    - Confirmation that retry was attempted
    - Final error state
    
    Important: After a failed retry, you must terminate the current flow completely. Do not attempt to use alternative tools or workarounds.
  </error_handling>`,
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
    description: `Complete a database migration by applying changes to the main branch and cleaning up the temporary branch. NEVER run autonomously; always ask the user first and verify in the temporary branch.

    <important_notes>
      You MUST pass ALL values from the \`prepare_database_migration\` response:
      - migrationId: The migration ID
      - migrationSql: The exact SQL from prepare step
      - databaseName: The database name
      - projectId: The project ID
      - temporaryBranchId: The temporary branch to delete
      - parentBranchId: The branch to apply migration to
      - applyChanges: Set to true to apply the migration, or false to just delete the temp branch without applying
    </important_notes>

    <workflow>
      1. If applyChanges is true, applies the migration SQL to the parent branch
      2. Deletes the temporary branch (cleanup)
      3. Returns confirmation of the operation
    </workflow>`,
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
      'Get a PostgreSQL connection string for a Neon database. The branch must have a compute endpoint. `create_project` and `create_branch` already return one. All parameters are optional; the tool resolves the project, branch, and database automatically if not specified. Requires write access: the connection string carries a privileged role password, so it is unavailable in read-only mode. A read-only caller who needs a DATABASE_URL must copy it from https://console.neon.tech manually.',
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
    description: `
    Read full Neon Auth configuration for a branch with secrets redacted. Do not use when you need to update config (use the generated Neon Auth write tools such as \`update_neon_auth_config\` or \`add_branch_neon_auth_oauth_provider\`). Requires Neon Auth to be provisioned first (use \`create_neon_auth\`). Returns Neon Auth (Better Auth) for a branch as one JSON object: integration metadata (base_url, jwks_url, db_name, auth_provider, branch_id, created_at, owned_by, transfer_status, auth_provider_project_id), branch_name from the Neon branch API, project_id and resolved branch_id, plus configurable fields (trusted_origins, allow_localhost, auth_methods.email_password, oauth_providers, email_provider). Top-level base_url, jwks_url, and db_name duplicate integration for quick copy. Optional _errors records partial fetch failures for configurable slices.

    Secrets — OAuth client_secret and the SMTP password — are NEVER returned. When the upstream config indicates a secret is set, this endpoint surfaces it as the literal sentinel "***redacted***"; when no secret is set the field is null. Use the matching generated Neon Auth write tools to write or rotate these values.
    `,
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
    description: `
  <use_case>
    This tool helps developers improve PostgreSQL query performance for slow queries or DML statements by analyzing execution plans and suggesting optimizations.
    
    The tool will:
    1. Create a temporary branch for testing optimizations and remember the branch ID
    2. Extract and analyze the current query execution plan
    3. Extract all fully qualified table names (\`schema.table\`) referenced in the plan 
    4. Gather detailed schema information for each referenced table using \`describe_table_schema\`
    5. Suggest and implement improvements like:
      - Adding or modifying indexes based on table schemas and query patterns
      - Query structure modifications
      - Identifying potential performance bottlenecks
    6. Apply the changes to the temporary branch using \`run_sql\`
    7. Compare performance before and after changes (but ONLY on the temporary branch passing branch ID to all tools)
    8. Continue with next steps using \`complete_query_tuning\` tool (on \`main\` branch)
    
    Project ID and database name will be automatically extracted from your request.
    The temporary branch ID will be added when invoking other tools.
    Default database is \`${NEON_DEFAULT_DATABASE_NAME}\` if not specified.

    <important_notes>
      This tool is part of the query tuning workflow. Any suggested changes (like creating indexes) must first be applied to the temporary branch using the \`run_sql\` tool.
      And then to the main branch using the \`complete_query_tuning\` tool, NOT the \`prepare_database_migration\` tool. 
      To apply using the \`complete_query_tuning\` tool, you must pass the \`tuning_id\`, NOT the temporary branch ID to it.
    </important_notes>
  </use_case>

  <workflow>
    1. Creates a temporary branch
    2. Analyzes current query performance and extracts table information
    3. Implements and tests improvements (using tool \`run_sql\` for schema modifications and \`explain_sql_statement\` for performance analysis, but ONLY on the temporary branch created in step 1 passing the same branch ID to all tools)
    4. Returns tuning details for verification
  </workflow>

  <important_notes>
    After executing this tool, you MUST:
    1. Review the suggested changes
    2. Verify the performance improvements on temporary branch - by applying the changes with \`run_sql\` and running \`explain_sql_statement\` again)
    3. Decide whether to keep or discard the changes
    4. Use \`complete_query_tuning\` tool to apply or discard changes to the main branch
    
    DO NOT use \`prepare_database_migration\` tool for applying query tuning changes.
    Always use \`complete_query_tuning\` to ensure changes are properly tracked and applied.

    Note: 
    - Some operations like creating indexes can take significant time on large tables
    - Table statistics updates (ANALYZE) are NOT automatically performed as they can be long-running
    - Table statistics maintenance should be handled by PostgreSQL auto-analyze or scheduled maintenance jobs
    - If statistics are suspected to be stale, suggest running ANALYZE as a separate maintenance task
  </important_notes>

  <example>
    For a query like:
    \`\`\`sql
    SELECT o.*, c.name 
    FROM orders o 
    JOIN customers c ON c.id = o.customer_id 
    WHERE o.status = 'pending' 
    AND o.created_at > '2024-01-01';
    \`\`\`
    
    The tool will:
    1. Extract referenced tables: \`public.orders\`, \`public.customers\`
    2. Gather schema information for both tables
    3. Analyze the execution plan
    4. Suggest improvements like:
       - Creating a composite index on orders(status, created_at)
       - Optimizing the join conditions
    5. If confirmed, apply the suggested changes to the temporary branch using \`run_sql\`
    6. Compare execution plans and performance before and after changes (but ONLY on the temporary branch passing branch ID to all tools)
  </example>

  <next_steps>
  After executing this tool, you MUST follow these steps:
    1. Review the execution plans and suggested changes
    2. Follow these instructions to respond to the client: 

      <response_instructions>
        <instructions>
          Provide a brief summary of the performance analysis and ask for approval to apply changes on the temporary branch.

          You MUST include ALL of the following fields in your response:
          - Tuning ID (this is required for completion)
          - Temporary Branch Name
          - Temporary Branch ID
          - Original Query Cost
          - Improved Query Cost
          - Referenced Tables (list all tables found in the plan)
          - Suggested Changes

          Even if some fields are missing from the tool's response, use placeholders like "not provided" rather than omitting fields.
        </instructions>

        <do_not_include>
          IMPORTANT: Your response MUST NOT contain ANY technical implementation details such as:
          - Exact index definitions
          - Internal PostgreSQL settings
          - Complex query rewrites
          - Table partitioning details
          
          Keep the response focused on high-level changes and performance metrics.
        </do_not_include>

        <example>
          I've analyzed your query and found potential improvements that could reduce execution time by [X]%.
          Would you like to apply these changes to improve performance?
          
          Analysis Details:
          - Tuning ID: [id]
          - Temporary Branch: [name]
          - Branch ID: [id]
          - Original Cost: [cost]
          - Improved Cost: [cost]
          - Referenced Tables:
            * public.orders
            * public.customers
          - Suggested Changes:
            * Add index for frequently filtered columns
            * Optimize join conditions

          To apply these changes, I will use the \`complete_query_tuning\` tool after your approval and pass the \`tuning_id\`, NOT the temporary branch ID to it.
        </example>
      </response_instructions>

    3. If approved, use ONLY the \`complete_query_tuning\` tool with the \`tuning_id\`
  </next_steps>

  <error_handling>
    On error, the tool will:
    1. Automatically attempt ONE retry of the exact same operation
    2. If the retry fails:
      - Terminate execution
      - Return error details
      - Clean up temporary branch
      - DO NOT attempt any other tools or alternatives
    
    Error response will include:
    - Original error details
    - Confirmation that retry was attempted
    - Final error state
    
    Important: After a failed retry, you must terminate the current flow completely.
  </error_handling>
    `,
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
    description: `Complete a query tuning session by either applying the changes to the main branch or discarding them. NEVER run autonomously; always ask the user first and verify on the temporary branch. 
    <important_notes>
        BEFORE RUNNING THIS TOOL: test out the changes in the temporary branch first by running 
        - \`run_sql\` with the suggested DDL statements.
        - \`explain_sql_statement\` with the original query and the temporary branch.
        This tool is the ONLY way to finally apply changes after the \`prepare_query_tuning\` tool to the main branch.
        You MUST NOT use \`prepare_database_migration\` or other tools to apply query tuning changes.
        You MUST pass the \`tuning_id\` obtained from the \`prepare_query_tuning\` tool, NOT the temporary branch ID as \`tuning_id\` to this tool.
        You MUST pass the temporary branch ID used in the \`prepare_query_tuning\` tool as TEMPORARY branchId to this tool.
        The tool OPTIONALLY receives a second branch ID or name which can be used instead of the main branch to apply the changes.
        This tool MUST be called after tool \`prepare_query_tuning\` even when the user rejects the changes, to ensure proper cleanup of temporary branches.
    </important_notes>    

    This tool:
    1. Applies suggested changes (like creating indexes) to the main branch (or specified branch) if approved
    2. Handles cleanup of temporary branch
    3. Must be called even when changes are rejected to ensure proper cleanup

    Workflow:
    1. After \`prepare_query_tuning\` suggests changes
    2. User reviews and approves/rejects changes
    3. This tool is called to either:
      - Apply approved changes to main branch and cleanup
      - OR just cleanup if changes are rejected
    `,
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
    description: `
    <use_case>
      Use this tool to list slow queries from your Neon database.
    </use_case>

    <important_notes>
      This tool queries the pg_stat_statements extension to find queries that are taking longer than expected.
      The tool will return queries sorted by execution time, with the slowest queries first.
      For sizes, index and scan usage, locks, cache hit rate, bloat, or replication state, use \`inspect_database\`.
    </important_notes>`,
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
    description: `
    <use_case>
      Reach for this first when asked why a database is slow, large, bloated, or behind. It runs one predefined, read-only Postgres diagnostic against a Neon branch — pick the one that answers the question from the \`check\` parameter's list, instead of writing catalog SQL by hand. These are the same checks as the \`neon inspect db\` CLI command.
    </use_case>

    <important_notes>
      Not for: arbitrary SQL (\`run_sql\`), the slowest queries by average execution time with your own threshold and limit (\`list_slow_queries\`), the plan of one statement (\`explain_sql_statement\`), applying an optimization (\`prepare_query_tuning\`), compute and Neon Function logs (\`query_project_branch_logs\`), or listing tables and columns (\`get_database_tables\`, \`describe_table_schema\`).

      Three checks read alike and are not: \`long-running-queries\` is what is running right now and has been for over five minutes, \`outliers\` is cumulative execution time since statistics were last reset, and \`calls\` is call frequency over that same history.

      Omit \`databaseName\` to run a database-scoped check against every database on the branch. The result adds a \`database\` column. \`lfc-hit-rate\`, \`working-set\`, and \`replication-slots\` are compute-wide: they run once against the first listed database, and cache counters reset when the compute restarts. One failing database fails the whole run. \`bloat\` is a statistical estimate, not a measurement.

      When a check needs an extension that is not installed, the tool says so and names the \`CREATE EXTENSION\` statement. Installing it writes to the user's database — ask before running it.
    </important_notes>`,
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
    description: `
  <use_case>
    Lists all available Neon documentation pages by fetching the index from https://neon.com/docs/llms.txt.
    Returns a markdown index of documentation page URLs (with .md file endings) and titles that can be fetched individually using the get_doc_resource tool.

    Use this tool when:
    - You need to find the right Neon documentation page for a topic
    - The user asks about Neon features, setup, configuration, or best practices
    - You want to discover what documentation is available before fetching a specific page
    - The user says "Get started with Neon" or similar onboarding phrases
  </use_case>

  <workflow>
    1. Call this tool (no parameters needed) to get the full list of Neon docs pages
    2. Identify the relevant page(s) based on the user's question
    3. Use the get_doc_resource tool with the page slug (including .md extension) to fetch the full content
  </workflow>

  <important_notes>
    - This tool returns a markdown index of all Neon documentation pages with their .md URLs
    - Documentation URLs use .md file endings (e.g. https://neon.com/docs/guides/prisma.md)
    - Always call this tool first before using get_doc_resource to find the correct slug
    - Do not guess documentation page slugs — use this index to find them
  </important_notes>`,
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
    description: `
  <use_case>
    Fetches a specific Neon documentation page as markdown content.
    Use the list_docs_resources tool first to discover available page slugs, then pass the slug to this tool.

    Use this tool when:
    - You have identified a specific docs page to fetch (from list_docs_resources results)
    - You need detailed guidance on a Neon feature, workflow, or configuration
    - The user needs step-by-step instructions for a Neon-related task
  </use_case>

  <workflow>
    1. First call list_docs_resources to get the index of available pages
    2. Pick the relevant page slug from the list (e.g. "docs/guides/prisma.md")
    3. Call this tool with that slug to get the full page content as markdown
  </workflow>

  <important_notes>
    - The slug parameter is the path portion of the docs .md URL (e.g. "docs/connect/connection-pooling.md")
    - Slugs use .md file endings matching the URLs in the documentation index
    - Always use list_docs_resources first to discover the correct slug — do not guess slugs
    - This tool fetches the page directly from https://neon.com/{slug} as markdown
    - Returns the full documentation page content as markdown text
  </important_notes>`,
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
