import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { NEON_DEFAULT_DATABASE_NAME } from '../constants';
import type { ScopeCategory } from '../utils/grant-context';
import {
  completeDatabaseMigrationInputSchema,
  completeQueryTuningInputSchema,
  createBranchInputSchema,
  createProjectInputSchema,
  deleteBranchInputSchema,
  deleteProjectInputSchema,
  describeBranchInputSchema,
  describeProjectInputSchema,
  describeTableSchemaInputSchema,
  explainSqlStatementInputSchema,
  getConnectionStringInputSchema,
  getDatabaseTablesInputSchema,
  listBranchComputesInputSchema,
  listProjectsInputSchema,
  prepareDatabaseMigrationInputSchema,
  prepareQueryTuningInputSchema,
  provisionNeonAuthInputSchema,
  provisionNeonDataApiInputSchema,
  runSqlInputSchema,
  runSqlTransactionInputSchema,
  listSlowQueriesInputSchema,
  listOrganizationsInputSchema,
  listSharedProjectsInputSchema,
  resetFromParentInputSchema,
  compareDatabaseSchemaInputSchema,
  searchInputSchema,
  fetchInputSchema,
  listDocsResourcesInputSchema,
  getDocResourceInputSchema,
} from './toolsSchema';

type NeonToolDefinition = {
  name: string;
  scope: ScopeCategory | null;
  description: string;
  inputSchema: unknown;
  readOnlySafe: boolean;
  annotations: ToolAnnotations;
};

export const NEON_TOOLS = [
  {
    name: 'list_projects' as const,
    scope: 'projects',
    description: `List the first 10 Neon projects in your account. Use when the user wants to browse, review, or find their existing Neon projects by name or ID. Do not use when you need projects shared with you by others (use list_shared_projects instead). Accepts `limit` (optional integer to retrieve more than 10 projects), e.g., limit=25 to get the first 25 projects. Raises an error if authentication credentials are invalid or expired.`limit\` parameter. Optionally filter by project name or ID using the \`search\` parameter.`,
    inputSchema: listProjectsInputSchema,
    readOnlySafe: true,
    annotations: {
      title: 'List Projects',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    } satisfies ToolAnnotations,
  },
  {
    name: 'list_organizations' as const,
    scope: 'projects',
    description: `List all organizations that the current user has access to in their Neon account. Use when the user wants to browse available organizations, check organization membership, or find a specific organization by name or ID. Accepts optional `name` and `id` parameters for filtering results. e.g., name="my-company" or id="org-12345". Do not use when you need to list projects within an organization (use list_projects instead). Returns an error if the authentication token lacks organization read permissions.`search\` parameter.`,
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
    name: 'list_shared_projects' as const,
    scope: 'projects',
    description: `List projects that have been shared with the current user for collaboration access. Use when the user wants to view projects they can collaborate on but don't own directly. Do not use when you need to see your own created projects (use list_projects instead). Accepts optional `project_name` or `project_id` filters to narrow results. e.g., project_name="analytics-dashboard" or project_id="proj_abc123". Returns an error if authentication credentials are invalid or expired.`search\` parameter.`,
    inputSchema: listSharedProjectsInputSchema,
    readOnlySafe: true,
    annotations: {
      title: 'List Shared Projects',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    } satisfies ToolAnnotations,
  },
  {
    name: 'create_project' as const,
    scope: 'projects',
    description:
      'Create a new Neon project with default database and compute settings. Use when the user wants to set up a fresh PostgreSQL environment or start a new application project. Do not use when you need to work with existing projects (use list_projects or describe_project instead). Accepts `name` (required), `region` (optional), and `org_id` (optional for organization assignment). e.g., name="my-app-db", region="us-east-1". Raises an error if the project name already exists or if you exceed your account's project limit.',
    inputSchema: createProjectInputSchema,
    readOnlySafe: false,
    annotations: {
      title: 'Create Project',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    } satisfies ToolAnnotations,
  },
  {
    name: 'delete_project' as const,
    scope: 'projects',
    description: 'Delete a Neon project permanently from your account. Use when the user wants to completely remove a project and all its associated databases, branches, and data. Do not use when you only need to remove a specific branch (use delete_branch instead). Accepts `project_id` (required string), e.g., "ep-cool-darkness-123456". Raises an error if the project does not exist or you lack deletion permissions.',
    inputSchema: deleteProjectInputSchema,
    readOnlySafe: false,
    annotations: {
      title: 'Delete Project',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    } satisfies ToolAnnotations,
  },
  {
    name: 'describe_project' as const,
    scope: 'projects',
    description: 'Retrieve the details and configuration of a specific Neon project. Use when the user wants to view project metadata, settings, or technical specifications for an existing project. Do not use when you need to see all projects in your account (use list_projects instead). Accepts `project_id` (required string), e.g., "ep-cool-darkness-123456". Raises an error if the project ID does not exist or you lack access permissions.',
    inputSchema: describeProjectInputSchema,
    readOnlySafe: true,
    annotations: {
      title: 'Describe Project',
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
    description: 'Retrieve the column structure, data types, and constraints of a specific table in a Neon database. Use when the user wants to examine table definitions, understand column properties, or review schema details for a particular table. Do not use when you need to see all tables in a database (use get_database_tables instead) or execute queries against the table data (use run_sql instead). Accepts `project_id` (required), `database_name` (required), and `table_name` (required), e.g., project_id="prj_abc123", table_name="users". Raises an error if the table does not exist or the database connection fails.',
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
    description: 'List all tables in a Neon database. Use when the user wants to explore database structure, review available tables, or understand the schema layout. Do not use when you need detailed column information for a specific table (use describe_table_schema instead). Accepts `project_id` (required) and `branch_id` (optional, defaults to main branch). e.g., project_id="ep-cool-darkness-123456", branch_id="br-wispy-meadow-a5xp9hi". Raises an error if the project does not exist or access is denied.',
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
    name: 'create_branch' as const,
    scope: 'branches',
    description: 'Create a new branch in a Neon project for database development or testing. Use when the user wants to create an isolated environment for schema changes, data experiments, or feature development. Do not use when you need to view existing branches (use describe_branch instead) or remove branches (use delete_branch instead). Accepts `project_id` (required), `branch_name` (required), and `parent_branch` (optional, defaults to main branch). e.g., project_id="prj_abc123", branch_name="feature-auth", parent_branch="main". Raises an error if the project does not exist or branch name already exists.',
    inputSchema: createBranchInputSchema,
    readOnlySafe: false,
    annotations: {
      title: 'Create Branch',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
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
    description: `Complete a database migration by applying changes to the main branch and cleaning up the temporary branch.

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
      'Get a hierarchical tree view of all database objects in a Neon branch, including databases, schemas, tables, views, and functions. Use when the user wants to explore or audit the complete structure and organization of database objects within a specific branch. Do not use when you only need table names (use get_database_tables instead) or specific table details (use describe_table_schema instead). Accepts `project_id` (required) and `branch_id` (required), e.g., project_id="prj_abc123", branch_id="br_main_456". Raises an error if the branch does not exist or access is denied.',
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
    name: 'delete_branch' as const,
    scope: 'branches',
    description: 'Delete a branch from a Neon project. Use when the user wants to remove an unused development branch or clean up completed feature branches. Do not use when you need to delete the entire project (use delete_project instead). Accepts `project_id` (required) and `branch_id` (required). e.g., project_id="ep-cool-darkness-123456", branch_id="br-aged-salad-a5xbr9". Raises an error if the branch is the primary branch or contains active compute endpoints.',
    inputSchema: deleteBranchInputSchema,
    readOnlySafe: false,
    annotations: {
      title: 'Delete Branch',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    } satisfies ToolAnnotations,
  },
  {
    name: 'reset_from_parent' as const,
    scope: 'branches',
    description: `Reset a branch to match its parent's current state, effectively discarding all changes made on the branch. Use when the user wants to undo all commits and modifications on a feature branch and start fresh from the parent. Do not use when you need to create a new branch from scratch (use create_branch instead). Accepts `branch_name` (optional, to preserve current changes in a new branch before reset). e.g., providing "backup-branch" will save current work before resetting. Raises an error if the branch does not exist or has no parent branch configured.`preserveUnderName\` parameter. This tool is commonly used to create fresh development branches from updated parent branch, undo experimental changes, or restore a branch to a known good state. Warning: This operation will discard all changes if \`preserveUnderName\` is not provided.`,
    inputSchema: resetFromParentInputSchema,
    readOnlySafe: false,
    annotations: {
      title: 'Reset Branch from Parent',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    } satisfies ToolAnnotations,
  },
  {
    name: 'get_connection_string' as const,
    scope: 'branches',
    description:
      'Retrieve a PostgreSQL connection string for a Neon database. Use when the user wants to connect to their database from external applications or tools that require connection parameters. Do not use when you need to execute SQL queries directly (use run_sql instead). Accepts optional parameters for `project_id`, `database_name`, `branch_name`, and `role_name` to customize the connection. e.g., project_id="ep-cool-darkness-123456", database_name="neondb", branch_name="main". Returns an error if the specified project or branch does not exist.',
    inputSchema: getConnectionStringInputSchema,
    readOnlySafe: true,
    annotations: {
      title: 'Get Connection String',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    } satisfies ToolAnnotations,
  },
  {
    name: 'provision_neon_auth' as const,
    scope: 'neon_auth',
    inputSchema: provisionNeonAuthInputSchema,
    readOnlySafe: false,
    description: `
    Provisions Neon Auth for a Neon branch. Neon Auth is a managed authentication service built on Better Auth, fully integrated into the Neon platform.

    
    <workflow>
      The tool will:
        1. Create the \`neon_auth\` schema in your database to store users, sessions, project configs and organizations
        2. Set up secure Auth related APIs for your branch
        3. Deploy an auth service in the same region as your Neon compute for low-latency requests
        4. Return the Auth URL specific to your branch, along with credentials for your application
    </workflow>

    <key_features>
      - Branch-compatible: Auth data (users, sessions, config) branches with your database
      - Google and GitHub OAuth included out of the box
      - Works with RLS: JWTs are validated by the Data API for authenticated queries
      - Better Auth compatible: Exposes the same APIs and schema as Better Auth
    </key_features>
    `,
    annotations: {
      title: 'Provision Neon Auth',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    } satisfies ToolAnnotations,
  },
  {
    name: 'provision_neon_data_api' as const,
    scope: 'data_api',
    inputSchema: provisionNeonDataApiInputSchema,
    readOnlySafe: false,
    description: `
    Provisions the Neon Data API for a Neon branch. The Data API enables HTTP-based access to your Postgres database with automatic JWT authentication support.

    <interactive_behavior>
      When called WITHOUT an authProvider:
        1. Automatically checks if Neon Auth is already provisioned
        2. Checks if Data API already exists
        3. Returns authentication options for user selection:
           - neon_auth: Use Neon Auth (recommended)
           - external: Use external provider (Clerk, Auth0, Stytch)
           - none: No authentication (not recommended)
        4. User selects an option, then call this tool again with authProvider specified

      When called WITH authProvider="neon_auth" and provisionNeonAuthFirst=true:
        - Automatically provisions Neon Auth first (if not already set up)
        - Then provisions the Data API with Neon Auth integration

      When called WITH authProvider="none":
        - Provisions Data API without a pre-configured JWKS
        - User will need to manually configure a JWKS URL before the Data API can be used
    </interactive_behavior>

    <workflow>
      The tool will:
        1. Resolve the default branch if branchId is not provided
        2. Resolve the default database if databaseName is not provided
        3. If no authProvider: check existing config and return options for selection
        4. If authProvider specified: create the Data API endpoint with that auth
        5. If provisionNeonAuthFirst: set up Neon Auth before Data API
        6. Return the Data API URL for your application
    </workflow>

    <key_features>
      - HTTP-based API: Access your Postgres database via REST endpoints
      - JWT Authentication: Supports Neon Auth or external providers (Clerk, Auth0, Stytch, etc.)
      - Row Level Security: Works with RLS policies for fine-grained access control
      - Branch-compatible: Data API configuration branches with your database
      - PostgREST-compatible: Uses the same API patterns as PostgREST
    </key_features>
    `,
    annotations: {
      title: 'Provision Neon Data API',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    } satisfies ToolAnnotations,
  },
  {
    name: 'explain_sql_statement' as const,
    scope: 'performance',
    description:
      'Analyze the PostgreSQL query execution plan for a SQL statement by running EXPLAIN (ANALYZE, BUFFERS) against the database. Use when the user wants to understand query performance, identify bottlenecks, or optimize slow database operations. Do not use when you need to execute the query for results (use run_sql instead). Accepts `sql` (required string containing the SELECT, INSERT, UPDATE, or DELETE statement to analyze), e.g., "SELECT * FROM users WHERE created_at > '2024-01-01'". Returns detailed execution plan with timing, cost estimates, and buffer usage statistics. Raises an error if the SQL statement contains syntax errors or references non-existent tables.',
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
    scope: 'performance',
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
    scope: 'performance',
    readOnlySafe: false,
    description: `Complete a query tuning session by either applying the changes to the main branch or discarding them. 
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
    scope: 'performance',
    description: `
    <use_case>
      Use this tool to list slow queries from your Neon database.
    </use_case>

    <important_notes>
      This tool queries the pg_stat_statements extension to find queries that are taking longer than expected.
      The tool will return queries sorted by execution time, with the slowest queries first.
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
    name: 'list_branch_computes' as const,
    scope: 'branches',
    description: 'List compute endpoints for a Neon project or specific branch. Use when the user wants to view available database connections, check compute status, or troubleshoot connectivity issues. Accepts `project_id` (required) and `branch_id` (optional to filter by specific branch). e.g., project_id="ep-cool-darkness-123456" or branch_id="br-wispy-meadow-a5xp9hi7". Do not use when you need general project information (use describe_project instead). Returns an error if the project does not exist or you lack access permissions.',
    inputSchema: listBranchComputesInputSchema,
    readOnlySafe: true,
    annotations: {
      title: 'List Branch Computes',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    } satisfies ToolAnnotations,
  },
  {
    name: 'compare_database_schema' as const,
    scope: 'schema',
    readOnlySafe: true,
    description: `
    <use_case>
      Use this tool to compare the schema of a database between two branches.
      The output of the tool is a JSON object with one field: \`diff\`.

      <example>
        \`\`\`json
        {
          "diff": "--- a/neondb\n+++ b/neondb\n@@ -27,7 +27,10 @@\n \n CREATE TABLE public.users (\n id integer NOT NULL,\n- username character varying(50) NOT NULL\n+ username character varying(50) NOT NULL,\n+ is_deleted boolean DEFAULT false NOT NULL,\n+ created_at timestamp with time zone DEFAULT now() NOT NULL,\n+ updated_at timestamp with time zone\n );\n \n \n@@ -79,6 +82,13 @@\n \n \n --\n+-- Name: users_created_at_idx; Type: INDEX; Schema: public; Owner: neondb_owner\n+--\n+\n+CREATE INDEX users_created_at_idx ON public.users USING btree (created_at DESC) WHERE (is_deleted = false);\n+\n+\n+--\n -- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: cloud_admin\n --\n \n"
        }
        \`\`\`
      </example>

      At this field you will find a difference between two schemas.
      The diff represents the changes required to make the parent branch schema match the child branch schema.
      The diff field contains a unified diff (git-style patch) as a string.

      You MUST be able to generate a zero-downtime migration from the diff and apply it to the parent branch.
      (This branch is a child and has a parent. You can get parent id just querying the branch details.)
    </use_case>

    <important_notes>
      To generate schema diff, you MUST SPECIFY the \`database_name\`.
      If \`database_name\` is not specified, you MUST fall back to the default database name: \`${NEON_DEFAULT_DATABASE_NAME}\`.

      You MUST TAKE INTO ACCOUNT the PostgreSQL version. The PostgreSQL version is the same for both branches.
      You MUST ASK user consent before running each generated SQL query.
      You SHOULD USE \`run_sql\` tool to run each generated SQL query.
      You SHOULD suggest creating a backup or point-in-time restore before running the migration.
      Generated queries change the schema of the parent branch and MIGHT BE dangerous to execute.
      Generated SQL migrations SHOULD be idempotent where possible (i.e., safe to run multiple times without failure) and include \`IF NOT EXISTS\` / \`IF EXISTS\` where applicable.
      You SHOULD recommend including comments in generated SQL linking back to diff hunks (e.g., \`-- from diff @@ -27,7 +27,10 @@\`) to make audits easier.
      Generated SQL should be reviewed for dependencies (e.g., foreign key order) before execution.
    </important_notes>

    <next_steps>
      After executing this tool, you MUST follow these steps:
        1. Review the schema diff and suggest generating a zero-downtime migration.
        2. Follow these instructions to respond to the client:

        <response_instructions>
          <instructions>
            Provide brief information about the changes:
              * Tables
              * Views
              * Indexes
              * Ownership
              * Constraints
              * Triggers
              * Policies
              * Extensions
              * Schemas
              * Sequences
              * Tablespaces
              * Users
              * Roles
              * Privileges
          </instructions>
        </response_instructions>

        3. If a migration fails, you SHOULD guide the user on how to revert the schema changes, for example by using backups, point-in-time restore, or generating reverse SQL statements (if safe).
    </next_steps>

    This tool:
    1. Generates a diff between the child branch and its parent.
    2. Generates a SQL migration from the diff.
    3. Suggest generating zero-downtime migration.

    <workflow>
      1. User asks you to generate a diff between two branches.
      2. You suggest generating a SQL migration from the diff.
      3. Ensure the generated migration is zero-downtime; otherwise, warn the user.
      4. You ensure that your suggested migration is also matching the PostgreSQL version.
      5. You use \`run_sql\` tool to run each generated SQL query and ask the user consent before running it.
        Before requesting user consent, present a summary of all generated SQL statements along with their potential impact (e.g., table rewrites, lock risks, validation steps) so the user can make an informed decision.
      6. Propose to rerun the schema diff tool one more time to ensure that the migration is applied correctly.
      7. If the diff is empty, confirm that the parent schema now matches the child schema.
      8. If the diff is not empty after migration, warn the user and assist in resolving the remaining differences.
    </workflow>

    <hints>
      <hint>
        Adding the column with a \`DEFAULT\` static value will not have any locks.
        But if the function is called that is not deterministic, it will have locks.

        <example>
          \`\`\`sql
          -- No table rewrite, minimal lock time
          ALTER TABLE users ADD COLUMN status text DEFAULT 'active';
          \`\`\`
        </example>

        There is an example of a case where the function is not deterministic and will have locks:

        <example>
          \`\`\`sql
          -- Table rewrite, potentially longer lock time
          ALTER TABLE users ADD COLUMN created_at timestamptz DEFAULT now();
          \`\`\`

          The fix for this is next:

          \`\`\`sql
          -- Adding a nullable column first
          ALTER TABLE users ADD COLUMN created_at timestamptz;

          -- Setting the default value because the rows are updated
          UPDATE users SET created_at = now();
          \`\`\`
        </example>
      </hint>

      <hint>
        Adding constraints in two phases (including foreign keys)

        <example>
          \`\`\`sql
          -- Step 1: Add constraint without validating existing data
          -- Fast - only blocks briefly to update catalog
          ALTER TABLE users ADD CONSTRAINT users_age_positive
            CHECK (age > 0) NOT VALID;

          -- Step 2: Validate existing data (can take time but doesn't block writes)
          -- Uses SHARE UPDATE EXCLUSIVE lock - allows reads/writes
          ALTER TABLE users VALIDATE CONSTRAINT users_age_positive;
          \`\`\`
        </example>

        <example>
         \`\`\`sql
          -- Step 1: Add foreign key without validation
          -- Fast - only updates catalog, doesn't validate existing data
          ALTER TABLE orders ADD CONSTRAINT orders_user_id_fk
            FOREIGN KEY (user_id) REFERENCES users(id) NOT VALID;

          -- Step 2: Validate existing relationships
          -- Can take time but allows concurrent operations
          ALTER TABLE orders VALIDATE CONSTRAINT orders_user_id_fk;
          \`\`\`
        </example>
      </hint>

      <hint>
        Setting columns to NOT NULL

        <example>
         \`\`\`sql
          -- Step 1: Add a check constraint (fast with NOT VALID)
          ALTER TABLE users ADD CONSTRAINT users_email_not_null
            CHECK (email IS NOT NULL) NOT VALID;

          -- Step 2: Validate the constraint (allows concurrent operations)
          ALTER TABLE users VALIDATE CONSTRAINT users_email_not_null;

          -- Step 3: Set NOT NULL (fast since constraint guarantees no nulls)
          ALTER TABLE users ALTER COLUMN email SET NOT NULL;

          -- Step 4: Drop the redundant check constraint
          ALTER TABLE users DROP CONSTRAINT users_email_not_null;
          \`\`\`
        </example>

        <example>
          For PostgreSQL v18+
          (to get PostgreSQL version, you can use \`describe_project\` tool or \`run_sql\` tool and execute \`SELECT version();\` query)

          \`\`\`sql
          -- PostgreSQL 18+ - Simplified approach
          ALTER TABLE users ALTER COLUMN email SET NOT NULL NOT VALID;
          ALTER TABLE users VALIDATE CONSTRAINT users_email_not_null;
          \`\`\`
        </example>
      </hint>

      <hint>
        In some cases, you need to combine two approaches to achieve a zero-downtime migration.

        <example>
          \`\`\`sql
          -- Step 1: Adding a nullable column first
          ALTER TABLE users ADD COLUMN created_at timestamptz;

          -- Step 2: Updating the all rows with the default value
          UPDATE users SET created_at = now() WHERE created_at IS NULL;

          -- Step 3: Creating a not null constraint
          ALTER TABLE users ADD CONSTRAINT users_created_at_not_null
            CHECK (created_at IS NOT NULL) NOT VALID;

          -- Step 4: Validating the constraint
          ALTER TABLE users VALIDATE CONSTRAINT users_created_at_not_null;

          -- Step 5: Setting the column to NOT NULL
          ALTER TABLE users ALTER COLUMN created_at SET NOT NULL;

          -- Step 6: Dropping the redundant NOT NULL constraint
          ALTER TABLE users DROP CONSTRAINT users_created_at_not_null;

          -- Step 7: Adding the default value
          ALTER TABLE users ALTER COLUMN created_at SET DEFAULT now();
          \`\`\`
        </example>

        For PostgreSQL v18+
        <example>
          \`\`\`sql
          -- Step 1: Adding a nullable column first
          ALTER TABLE users ADD COLUMN created_at timestamptz;

          -- Step 2: Updating the all rows with the default value
          UPDATE users SET created_at = now() WHERE created_at IS NULL;

          -- Step 3: Creating a not null constraint
          ALTER TABLE users ALTER COLUMN created_at SET NOT NULL NOT VALID;

          -- Step 4: Validating the constraint
          ALTER TABLE users VALIDATE CONSTRAINT users_created_at_not_null;

          -- Step 5: Adding the default value
          ALTER TABLE users ALTER COLUMN created_at SET DEFAULT now();
          \`\`\`
        </example>
      </hint>

      <hint>
        Create index CONCURRENTLY

        <example>
          \`\`\`sql
          CREATE INDEX CONCURRENTLY idx_users_email ON users (email);
          \`\`\`
        </example>
      </hint>

      <hint>
        Drop index CONCURRENTLY

        <example>
          \`\`\`sql
          DROP INDEX CONCURRENTLY idx_users_email;
          \`\`\`
        </example>
      </hint>

      <hint>
        Create materialized view WITH NO DATA

        <example>
          \`\`\`sql
          CREATE MATERIALIZED VIEW mv_users AS SELECT name FROM users WITH NO DATA;
          \`\`\`
        </example>
      </hint>

      <hint>
        Refresh materialized view CONCURRENTLY

        <example>
          \`\`\`sql
          REFRESH MATERIALIZED VIEW CONCURRENTLY mv_users;
          \`\`\`
        </example>
      </hint>
    </hints>
    `,
    inputSchema: compareDatabaseSchemaInputSchema,
    annotations: {
      title: 'Compare Database Schema',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    } satisfies ToolAnnotations,
  },
  {
    name: 'search' as const,
    scope: null,
    description: `Search across all user organizations, projects, and branches that match a query term. Use when the user wants to find specific Neon resources by name or keyword across their entire account. Accepts `query` (required string) to match against resource names and metadata. Returns objects with id, title, and url for direct Console access. e.g., query="production" to find all production-related projects and branches. Do not use when you need to list all projects without filtering (use list_projects instead) or when searching within a specific project's branches (use describe_project instead). Fails if the query string is empty or contains only whitespace.`,
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
    description: `Fetch detailed information about a specific Neon organization, project, or branch using its unique identifier. Use when the user wants to retrieve comprehensive details about a specific resource for analysis or management purposes. Do not use when you need to list multiple resources (use list_projects, list_organizations, or describe_project instead). Accepts `resource_id` (required string) and `resource_type` (required: "organization", "project", or "branch"). e.g., resource_id="proj_abc123", resource_type="project". Raises an error if the resource ID does not exist or you lack access permissions.`,
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
] as const satisfies readonly NeonToolDefinition[];
