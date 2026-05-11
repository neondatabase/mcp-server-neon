import {
  ListProjectsParams,
  ListSharedProjectsParams,
} from '@neondatabase/api-client';
// IMPORTANT: Use zod/v3 types for MCP registration compatibility.
// @modelcontextprotocol/sdk@1.25.x accepts schemas typed through its zod-compat layer
// (zod/v3 or zod/v4/core). Using plain `zod` imports here can create type-identity
// mismatches at registerTool/registerPrompt boundaries in Next.js builds.
//
// Revisit this once the MCP SDK publishes a single-zod type surface that no longer
// requires cross-version compatibility shims.
import { z } from 'zod/v3';
import { NEON_DEFAULT_DATABASE_NAME } from '../constants';

type ZodObjectParams<T> = z.ZodObject<{ [key in keyof T]: z.ZodType<T[key]> }>;

const DATABASE_NAME_DESCRIPTION = `The name of the database. If not provided, the default ${NEON_DEFAULT_DATABASE_NAME} or first available database is used.`;

export const listProjectsInputSchema = z.object({
  cursor: z
    .string()
    .optional()
    .describe(
      'Specify the cursor value from the previous response to retrieve the next batch of projects.',
    ),
  limit: z
    .number()
    .default(10)
    .describe(
      'Specify a value from 1 to 400 to limit number of projects in the response.',
    ),
  search: z
    .string()
    .optional()
    .describe(
      'Search by project name or id. You can specify partial name or id values to filter results.',
    ),
  org_id: z.string().optional().describe('Search for projects by org_id.'),
}) satisfies ZodObjectParams<ListProjectsParams>;

export const createProjectInputSchema = z.object({
  name: z
    .string()
    .optional()
    .describe('An optional name of the project to create.'),
  org_id: z
    .string()
    .optional()
    .describe('Create project in a specific organization.'),
});

export const deleteProjectInputSchema = z.object({
  projectId: z.string().describe('The ID of the project to delete'),
});

export const describeProjectInputSchema = z.object({
  projectId: z.string().describe('The ID of the project to describe'),
});

export const runSqlInputSchema = z.object({
  sql: z.string().describe('The SQL query to execute'),
  projectId: z
    .string()
    .describe('The ID of the project to execute the query against'),
  branchId: z
    .string()
    .optional()
    .describe(
      'An optional ID of the branch to execute the query against. If not provided the default branch is used.',
    ),
  databaseName: z.string().optional().describe(DATABASE_NAME_DESCRIPTION),
});

export const runSqlTransactionInputSchema = z.object({
  sqlStatements: z.array(z.string()).describe('The SQL statements to execute'),
  projectId: z
    .string()
    .describe('The ID of the project to execute the query against'),
  branchId: z
    .string()
    .optional()
    .describe(
      'An optional ID of the branch to execute the query against. If not provided the default branch is used.',
    ),
  databaseName: z.string().optional().describe(DATABASE_NAME_DESCRIPTION),
});

export const explainSqlStatementInputSchema = z.object({
  sql: z.string().describe('The SQL statement to analyze'),
  projectId: z
    .string()
    .describe('The ID of the project to execute the query against'),
  branchId: z
    .string()
    .optional()
    .describe(
      'An optional ID of the branch to execute the query against. If not provided the default branch is used.',
    ),
  databaseName: z.string().optional().describe(DATABASE_NAME_DESCRIPTION),
  analyze: z
    .boolean()
    .default(true)
    .describe('Whether to include ANALYZE in the EXPLAIN command'),
});
export const describeTableSchemaInputSchema = z.object({
  tableName: z.string().describe('The name of the table'),
  projectId: z
    .string()
    .describe('The ID of the project to execute the query against'),
  branchId: z
    .string()
    .optional()
    .describe(
      'An optional ID of the branch to execute the query against. If not provided the default branch is used.',
    ),
  databaseName: z.string().optional().describe(DATABASE_NAME_DESCRIPTION),
});

export const getDatabaseTablesInputSchema = z.object({
  projectId: z.string().describe('The ID of the project'),
  branchId: z
    .string()
    .optional()
    .describe(
      'An optional ID of the branch. If not provided the default branch is used.',
    ),
  databaseName: z.string().optional().describe(DATABASE_NAME_DESCRIPTION),
});

export const createBranchInputSchema = z.object({
  projectId: z
    .string()
    .describe('The ID of the project to create the branch in'),
  branchName: z.string().optional().describe('An optional name for the branch'),
});

export const prepareDatabaseMigrationInputSchema = z.object({
  migrationSql: z
    .string()
    .describe('The SQL to execute to create the migration'),
  projectId: z
    .string()
    .describe('The ID of the project to execute the query against'),
  databaseName: z.string().optional().describe(DATABASE_NAME_DESCRIPTION),
});

export const completeDatabaseMigrationInputSchema = z.object({
  migrationId: z
    .string()
    .describe('The migration ID from prepare_database_migration.'),
  migrationSql: z
    .string()
    .describe(
      'The SQL statements to apply. Pass the exact value from prepare_database_migration.',
    ),
  databaseName: z
    .string()
    .describe(
      'The database name. Pass the exact value from prepare_database_migration.',
    ),
  projectId: z
    .string()
    .describe(
      'The project ID. Pass the exact value from prepare_database_migration.',
    ),
  temporaryBranchId: z
    .string()
    .describe('The temporary branch ID to delete after migration.'),
  parentBranchId: z
    .string()
    .describe('The parent branch ID where migration will be applied.'),
  applyChanges: z
    .boolean()
    .default(true)
    .describe(
      'Whether to apply the migration. Set to false to just delete the temp branch without applying.',
    ),
});

export const describeBranchInputSchema = z.object({
  projectId: z.string().describe('The ID of the project'),
  branchId: z.string().describe('An ID of the branch to describe'),
  databaseName: z.string().optional().describe(DATABASE_NAME_DESCRIPTION),
});

export const deleteBranchInputSchema = z.object({
  projectId: z.string().describe('The ID of the project containing the branch'),
  branchId: z.string().describe('The ID of the branch to delete'),
});

export const getConnectionStringInputSchema = z.object({
  projectId: z
    .string()
    .describe(
      'The ID of the project. If not provided, the only available project will be used.',
    ),
  branchId: z
    .string()
    .optional()
    .describe(
      'The ID or name of the branch. If not provided, the default branch will be used.',
    ),
  computeId: z
    .string()
    .optional()
    .describe(
      'The ID of the compute/endpoint. If not provided, the read-write compute associated with the branch will be used.',
    ),
  databaseName: z.string().optional().describe(DATABASE_NAME_DESCRIPTION),
  roleName: z
    .string()
    .optional()
    .describe(
      'The name of the role to connect with. If not provided, the database owner name will be used.',
    ),
});

export const provisionNeonAuthInputSchema = z.object({
  projectId: z
    .string()
    .describe('The ID of the project to provision Neon Auth for'),
  branchId: z
    .string()
    .optional()
    .describe(
      'An optional ID of the branch to provision Neon Auth for. If not provided, the default branch is used.',
    ),
  databaseName: z
    .string()
    .optional()
    .describe(
      'The database name to provision Neon Auth for. If not provided, the default database is used.',
    ),
});

const emailPasswordAuthMethodSchema = z
  .object({
    enabled: z
      .boolean()
      .optional()
      .describe(
        'Whether email-and-password authentication is enabled (Neon Auth `enabled`).',
      ),
    allow_sign_up: z
      .boolean()
      .optional()
      .describe(
        'Whether new users can sign up with email and password. Maps to the inverse of Neon Auth `disable_sign_up`.',
      ),
    verify_email_on_sign_up: z
      .boolean()
      .optional()
      .describe(
        'Whether to send a verification email when users sign up (Neon Auth `send_verification_email_on_sign_up`).',
      ),
    verify_email_on_sign_in: z
      .boolean()
      .optional()
      .describe(
        'Whether to send a verification email when users sign in (Neon Auth `send_verification_email_on_sign_in`).',
      ),
    email_verification_method: z
      .enum(['link', 'otp'])
      .optional()
      .describe(
        'How verification emails are delivered: `link` sends a verification link, `otp` sends a one-time password (Neon Auth `email_verification_method`).',
      ),
    require_email_verification: z
      .boolean()
      .optional()
      .describe(
        'Whether email verification is required before users can sign in (Neon Auth `require_email_verification`).',
      ),
    auto_sign_in_after_verification: z
      .boolean()
      .optional()
      .describe(
        'Whether users are automatically signed in after verifying their email (Neon Auth `auto_sign_in_after_verification`).',
      ),
  })
  .strict();

export const configureNeonAuthInputSchema = z
  .object({
    operation: z
      .enum([
        'add_trusted_origin',
        'remove_trusted_origin',
        'set_allow_localhost',
        'update_auth_methods',
      ])
      .describe('Which Neon Auth configuration change to apply'),
    projectId: z.string().describe('Neon project ID'),
    branchId: z
      .string()
      .optional()
      .describe(
        'Branch ID. If omitted, the project default branch is used (same as provision_neon_auth).',
      ),
    trusted_origin: z
      .string()
      .min(1)
      .refine(
        (v) => v.trim() === v && /^[a-zA-Z][a-zA-Z0-9+.\-]*:\/\//.test(v),
        {
          message:
            'trusted_origin must include a scheme followed by "://" (e.g. https://app.example.com, https://*.example.com, or myapp://). No surrounding whitespace.',
        },
      )
      .optional()
      .describe(
        [
          'Origin to add to (or remove from) the Better Auth trusted origins list. Required for add_trusted_origin and remove_trusted_origin.',
          'Better Auth uses trusted origins for two purposes:',
          '1. CSRF protection - validates the incoming request Origin/Referer header on state-changing endpoints (POST/PUT/PATCH/DELETE).',
          '2. URL allowlist - authorizes URLs your client passes via callbackURL, redirectTo, errorCallbackURL, and newUserCallbackURL across sign-in/sign-up, OAuth provider flows, email verification, password reset, and magic-link flows. Not just OAuth redirect_uri.',
          'Accepted formats (must include "<scheme>://"):',
          '- Full origin: https://app.example.com',
          '- Full URL with path: https://app.example.com/auth/callback',
          '- Wildcard pattern: https://*.example.com (single-segment), https://**.example.com (cross-segment), exp://192.168.*.*:*/**',
          '- Custom scheme: myapp://',
          'See https://www.better-auth.com/docs/reference/options for canonical pattern syntax.',
        ].join(' '),
      ),
    allow_localhost: z
      .boolean()
      .optional()
      .describe(
        'Whether Neon Auth should allow localhost origins. Required for set_allow_localhost.',
      ),
    methods: z
      .object({
        email_password: emailPasswordAuthMethodSchema
          .optional()
          .describe(
            'Email and password authentication settings. Provide only the fields you want to change; omitted fields are left unchanged.',
          ),
      })
      .strict()
      .optional()
      .describe(
        'Authentication methods to update. Required for update_auth_methods. At least one method block with at least one field must be provided.',
      ),
  })
  .superRefine((val, ctx) => {
    if (
      val.operation === 'add_trusted_origin' ||
      val.operation === 'remove_trusted_origin'
    ) {
      if (!val.trusted_origin) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'trusted_origin is required for this operation',
          path: ['trusted_origin'],
        });
      }
    }
    if (val.operation === 'set_allow_localhost') {
      if (val.allow_localhost === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'allow_localhost is required for this operation',
          path: ['allow_localhost'],
        });
      }
    }
    if (val.operation === 'update_auth_methods') {
      const methodBlocks = val.methods
        ? Object.entries(val.methods).filter(([, v]) => v !== undefined)
        : [];
      if (methodBlocks.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'methods must include at least one method block (e.g. methods.email_password)',
          path: ['methods'],
        });
        return;
      }
      for (const [methodName, methodValue] of methodBlocks) {
        const fields = Object.values(methodValue as Record<string, unknown>);
        const hasAtLeastOneField = fields.some((v) => v !== undefined);
        if (!hasAtLeastOneField) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `methods.${methodName} must include at least one field to update`,
            path: ['methods', methodName],
          });
        }
      }
    }
  });

export const getNeonAuthConfigInputSchema = z.object({
  projectId: z.string().describe('Neon project ID'),
  branchId: z
    .string()
    .optional()
    .describe(
      'Branch ID. If omitted, the project default branch is used (same as provision_neon_auth).',
    ),
});

export const provisionNeonDataApiInputSchema = z
  .object({
    projectId: z
      .string()
      .describe('The ID of the project to provision the Data API for'),
    branchId: z
      .string()
      .optional()
      .describe(
        'An optional ID of the branch to provision the Data API for. If not provided, the default branch is used.',
      ),
    databaseName: z
      .string()
      .optional()
      .describe(
        'The database name to provision the Data API for. If not provided, the default database is used.',
      ),
    authProvider: z
      .enum(['neon_auth', 'external', 'none'])
      .optional()
      .describe(
        'The authentication provider - "neon_auth" for Neon Auth integration, "external" for third-party providers like Clerk, Auth0, or Stytch, or "none" for unauthenticated access (not recommended). If not specified, the tool will check existing auth configuration and return options for selection.',
      ),
    jwksUrl: z
      .string()
      .optional()
      .describe(
        'The JWKS URL for external authentication providers. Required when authProvider is "external".',
      ),
    providerName: z
      .string()
      .optional()
      .describe(
        'The name of the external authentication provider (e.g., "Clerk", "Auth0", "Stytch"). Used when authProvider is "external".',
      ),
    jwtAudience: z
      .string()
      .optional()
      .describe(
        'The expected JWT audience claim. Tokens without an audience claim will still be accepted.',
      ),
    provisionNeonAuthFirst: z
      .boolean()
      .optional()
      .describe(
        'When true with authProvider="neon_auth", provisions Neon Auth before Data API if not already set up.',
      ),
  })
  .refine((data) => !(data.authProvider === 'external' && !data.jwksUrl), {
    message: 'jwksUrl is required when authProvider is "external"',
    path: ['jwksUrl'],
  });

export const prepareQueryTuningInputSchema = z.object({
  sql: z.string().describe('The SQL statement to analyze and tune'),
  databaseName: z
    .string()
    .describe('The name of the database to execute the query against'),
  projectId: z
    .string()
    .describe('The ID of the project to execute the query against'),
  roleName: z
    .string()
    .optional()
    .describe(
      'The name of the role to connect with. If not provided, the default role (usually "neondb_owner") will be used.',
    ),
});

export const completeQueryTuningInputSchema = z.object({
  suggestedSqlStatements: z
    .array(z.string())
    .describe(
      'The SQL DDL statements to execute to improve performance. These statements are the result of the prior steps, for example creating additional indexes.',
    ),
  applyChanges: z
    .boolean()
    .default(false)
    .describe('Whether to apply the suggested changes to the main branch'),
  tuningId: z
    .string()
    .describe(
      'The ID of the tuning to complete. This is NOT the branch ID. Remember this ID from the prior step using tool prepare_query_tuning.',
    ),
  databaseName: z
    .string()
    .describe('The name of the database to execute the query against'),
  projectId: z
    .string()
    .describe('The ID of the project to execute the query against'),
  roleName: z
    .string()
    .optional()
    .describe(
      'The name of the role to connect with. If you have used a specific role in prepare_query_tuning you MUST pass the same role again to this tool. If not provided, the default role (usually "neondb_owner") will be used.',
    ),
  shouldDeleteTemporaryBranch: z
    .boolean()
    .default(true)
    .describe('Whether to delete the temporary branch after tuning'),
  temporaryBranchId: z
    .string()
    .describe(
      'The ID of the temporary branch that needs to be deleted after tuning.',
    ),
  branchId: z
    .string()
    .optional()
    .describe(
      'The ID or name of the branch that receives the changes. If not provided, the default (main) branch will be used.',
    ),
});

export const listSlowQueriesInputSchema = z.object({
  projectId: z
    .string()
    .describe('The ID of the project to list slow queries from'),
  branchId: z
    .string()
    .optional()
    .describe(
      'An optional ID of the branch. If not provided the default branch is used.',
    ),
  databaseName: z.string().optional().describe(DATABASE_NAME_DESCRIPTION),
  computeId: z
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
  minExecutionTime: z
    .number()
    .optional()
    .default(1000)
    .describe(
      'Minimum execution time in milliseconds to consider a query as slow',
    ),
});

export const listBranchComputesInputSchema = z.object({
  projectId: z
    .string()
    .optional()
    .describe(
      'The ID of the project. If not provided, the only available project will be used.',
    ),
  branchId: z
    .string()
    .optional()
    .describe(
      'The ID of the branch. If provided, endpoints for this specific branch will be listed.',
    ),
});

export const listOrganizationsInputSchema = z.object({
  search: z
    .string()
    .optional()
    .describe(
      'Search organizations by name or ID. You can specify partial name or ID values to filter results.',
    ),
});

export const listSharedProjectsInputSchema = z.object({
  cursor: z
    .string()
    .optional()
    .describe(
      'Specify the cursor value from the previous response to retrieve the next batch of shared projects.',
    ),
  limit: z
    .number()
    .default(10)
    .describe(
      'Specify a value from 1 to 400 to limit number of shared projects in the response.',
    ),
  search: z
    .string()
    .optional()
    .describe(
      'Search by project name or id. You can specify partial name or id values to filter results.',
    ),
}) satisfies ZodObjectParams<ListSharedProjectsParams>;

export const resetFromParentInputSchema = z.object({
  projectId: z.string().describe('The ID of the project containing the branch'),
  branchIdOrName: z
    .string()
    .describe('The name or ID of the branch to reset from its parent'),
  preserveUnderName: z
    .string()
    .optional()
    .describe(
      'Optional name to preserve the current state under a new branch before resetting',
    ),
});

export const compareDatabaseSchemaInputSchema = z.object({
  projectId: z.string().describe('The ID of the project'),
  branchId: z.string().describe('The ID of the branch'),
  databaseName: z.string().describe(DATABASE_NAME_DESCRIPTION),
});

export const searchInputSchema = z.object({
  query: z
    .string()
    .min(3)
    .describe(
      'The search query to find matching organizations, projects, or branches',
    ),
});

export const fetchInputSchema = z.object({
  id: z
    .string()
    .min(1)
    .describe(
      'The ID returned by the search tool to fetch detailed information about the entity',
    ),
});

export const listDocsResourcesInputSchema = z.object({});

export const getDocResourceInputSchema = z.object({
  slug: z
    .string()
    .describe(
      "The docs page slug (path) to fetch, e.g. 'docs/guides/prisma.md'. Slugs use .md file endings matching the URLs in the documentation index. Use the list_docs_resources tool first to discover available slugs.",
    ),
});
