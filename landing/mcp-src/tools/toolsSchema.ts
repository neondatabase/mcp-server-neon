import {
  ListProjectsParams,
  ListSharedProjectsParams,
  NeonAuthEmailVerificationMethod,
  NeonAuthOauthProviderId,
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
  parentId: z
    .string()
    .optional()
    .describe(
      "An optional branch ID (e.g. 'br-...') to branch from. If omitted, the branch is created from the project's default branch. Use this to fork an existing non-default branch — for example, to make an isolated copy of a dev/staging branch for experimentation.",
    ),
  expiresAt: z
    .string()
    .optional()
    .describe(
      'An optional ISO 8601 timestamp after which Neon automatically deletes the branch.',
    ),
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
      .nativeEnum(NeonAuthEmailVerificationMethod)
      .optional()
      .describe(
        'How verification emails are delivered: `link` sends a verification link, `otp` sends a one-time password. Sourced from the Neon Auth API enum `NeonAuthEmailVerificationMethod` so it stays in lockstep with the upstream SDK as new methods are added.',
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

const oauthProviderConfigSchema = z
  .object({
    client_id: z
      .string()
      .min(1)
      .optional()
      .describe(
        'OAuth client ID issued by the upstream provider. Omit for shared mode (Neon-managed credentials).',
      ),
    client_secret: z
      .string()
      .min(1)
      .optional()
      .describe(
        'OAuth client secret issued by the upstream provider. Omit for shared mode (Neon-managed credentials). Never returned by get_neon_auth_config — that endpoint redacts secrets.',
      ),
    microsoft_tenant_id: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Microsoft Entra ID tenant ID. Only meaningful when oauth_provider="microsoft"; the upstream API will reject it for other providers.',
      ),
  })
  .strict();

// `update_email_provider` and `send_test_email` reuse the same SMTP fields.
const standardEmailServerFields = {
  host: z
    .string()
    .min(1)
    .describe('SMTP server hostname (e.g. smtp.sendgrid.net).'),
  port: z
    .number()
    .int()
    .min(1)
    .max(65535)
    .describe('SMTP server port (commonly 25, 465, 587, or 2525).'),
  username: z.string().min(1).describe('SMTP authentication username.'),
  password: z
    .string()
    .min(1)
    .describe(
      'SMTP authentication password. Never returned by get_neon_auth_config — that endpoint redacts secrets.',
    ),
  sender_email: z
    .string()
    .email()
    .describe(
      'Default From: address for emails sent through this SMTP server. Must be an email the SMTP relay is authorized to send for.',
    ),
  sender_name: z
    .string()
    .min(1)
    .describe('Default From: display name (e.g. "Acme Auth").'),
};

const emailProviderSchema = z
  .discriminatedUnion('type', [
    z
      .object({
        type: z.literal('standard'),
        ...standardEmailServerFields,
      })
      .strict()
      .describe(
        'Bring-your-own SMTP server. Required: host, port, username, password, sender_email, sender_name.',
      ),
    z
      .object({
        type: z.literal('shared'),
        sender_email: z
          .string()
          .email()
          .optional()
          .describe(
            'Optional override for the From: address on the Neon-managed shared SMTP. If omitted, Neon picks a sensible default.',
          ),
        sender_name: z
          .string()
          .min(1)
          .optional()
          .describe(
            'Optional override for the From: display name on the Neon-managed shared SMTP.',
          ),
      })
      .strict()
      .describe(
        'Use Neon-managed shared SMTP — no credentials needed. Optionally override sender_email / sender_name.',
      ),
  ])
  .describe(
    'Email server configuration discriminated by `type`. "standard" = bring-your-own SMTP (full credentials required); "shared" = Neon-managed shared SMTP (credentials managed by Neon).',
  );

const sendTestEmailSchema = z
  .object({
    recipient_email: z
      .string()
      .email()
      .min(1)
      .max(256)
      .describe('Email address to deliver the test message to.'),
    ...standardEmailServerFields,
  })
  .strict()
  .describe(
    'Test SMTP credentials end-to-end before saving them. Sends a single message from sender_email to recipient_email through the supplied host/port/username/password. Does NOT read from or write to the saved email_provider config — pass the credentials you want to verify.',
  );

/**
 * Validates a `trusted_origin` value before it ever reaches the Neon API.
 *
 * Better Auth's `trustedOrigins` list is a security boundary (CSRF on the
 * Origin/Referer header + allowlist for callback/redirect URLs in sign-in,
 * OAuth, email verification, password reset, and magic-link flows). Bad
 * entries here can broaden CSRF or open redirect surface, so we reject
 * patterns that are almost never what a caller wants:
 *
 *   - Schemes that don't make sense for browser-driven auth callbacks
 *     (`file:`, `data:`, `javascript:`, `vbscript:`, `about:`).
 *   - Plain `http://` for anything other than `localhost`/`127.0.0.1`/`[::1]`.
 *     Production callbacks should always be `https://`.
 *   - Host-only or TLD-only wildcards: `https://*`, `https://**`,
 *     `https://*.com`, `https://*.io`. These match-all patterns nullify
 *     CSRF protection.
 *   - Empty host (`https://`, `https://:8080`).
 *   - Embedded ASCII control characters (NUL through US, plus DEL).
 *
 * Wildcards in subdomain position (`https://*.example.com`,
 * `https://**.example.com`) and custom-scheme deeplinks (`myapp://`,
 * `exp://...` patterns with embedded wildcards) are still accepted, matching
 * what the upstream Neon API and Better Auth's `trustedOrigins` support.
 */
const TRUSTED_ORIGIN_BLOCKED_SCHEMES = new Set([
  'file',
  'data',
  'javascript',
  'vbscript',
  'about',
]);

const TRUSTED_ORIGIN_LOCAL_HOST_RE = /^(localhost|127\.0\.0\.1|\[::1\])$/i;

// Matches `*`, `**`, `*.com`, `*.io`, etc. (host-only or TLD-only wildcards).
// Must NOT match `*.example.com` or `**.example.com`.
const TRUSTED_ORIGIN_HOST_WILDCARD_RE = /^\*+(\.[a-z]{2,})?$/i;

const TRUSTED_ORIGIN_SCHEME_PREFIX_RE = /^([a-zA-Z][a-zA-Z0-9+.\-]*):\/\/(.*)$/;

function extractHttpHost(rest: string): string | null {
  // Strip path/query/fragment first, then peel the port off, taking care of
  // IPv6 bracketed-host syntax like `[::1]:3000` where splitting on `:` would
  // otherwise truncate the address.
  const hostWithPort = rest.split(/[/?#]/)[0];
  if (hostWithPort.length === 0) return null;
  if (hostWithPort.startsWith('[')) {
    const closeIdx = hostWithPort.indexOf(']');
    if (closeIdx === -1) return null;
    return hostWithPort.substring(0, closeIdx + 1);
  }
  return hostWithPort.split(':')[0];
}

function isValidTrustedOrigin(v: string): boolean {
  if (!v) return false;
  if (v.trim() !== v) return false;
  if (/[\u0000-\u001F\u007F]/.test(v)) return false;
  const m = v.match(TRUSTED_ORIGIN_SCHEME_PREFIX_RE);
  if (!m) return false;
  const scheme = m[1].toLowerCase();
  const rest = m[2];
  if (TRUSTED_ORIGIN_BLOCKED_SCHEMES.has(scheme)) return false;
  if (scheme === 'http' || scheme === 'https') {
    if (rest.length === 0) return false;
    const host = extractHttpHost(rest);
    if (host === null || host.length === 0) return false;
    if (TRUSTED_ORIGIN_HOST_WILDCARD_RE.test(host)) return false;
    if (scheme === 'http' && !TRUSTED_ORIGIN_LOCAL_HOST_RE.test(host)) {
      return false;
    }
  }
  return true;
}

export const configureNeonAuthInputSchema = z
  .object({
    operation: z
      .enum([
        'add_trusted_origin',
        'remove_trusted_origin',
        'set_allow_localhost',
        'update_auth_methods',
        'add_oauth_provider',
        'update_oauth_provider',
        'remove_oauth_provider',
        'update_email_provider',
        'send_test_email',
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
      .refine(isValidTrustedOrigin, {
        message:
          'trusted_origin must be a https:// URL or origin (wildcard subdomains allowed, e.g. https://*.example.com), an http://localhost (or 127.0.0.1/[::1]) origin, or a custom-scheme deeplink (e.g. myapp://, exp://...). Rejected: file:/data:/javascript:/vbscript:/about: schemes, non-localhost http://, host-only or TLD-only wildcards (https://*, https://**, https://*.com), empty host, surrounding whitespace, and ASCII control characters.',
      })
      .optional()
      .describe(
        [
          'Origin to add to (or remove from) the Better Auth trusted origins list. Required for add_trusted_origin and remove_trusted_origin.',
          'Better Auth uses trusted origins for two purposes:',
          '1. CSRF protection - validates the incoming request Origin/Referer header on state-changing endpoints (POST/PUT/PATCH/DELETE).',
          '2. URL allowlist - authorizes URLs your client passes via callbackURL, redirectTo, errorCallbackURL, and newUserCallbackURL across sign-in/sign-up, OAuth provider flows, email verification, password reset, and magic-link flows. Not just OAuth redirect_uri.',
          'Accepted formats (must include "<scheme>://"):',
          '- https:// origin or full URL: https://app.example.com, https://app.example.com/auth/callback',
          '- Subdomain wildcards: https://*.example.com (single-segment), https://**.example.com (cross-segment)',
          '- Local development over plain http: http://localhost, http://localhost:3000, http://127.0.0.1[:port], http://[::1][:port]',
          '- Custom-scheme deeplinks: myapp://, exp://192.168.*.*:*/**',
          'Rejected: file:/data:/javascript:/vbscript:/about: schemes, non-localhost http://, host-only or TLD-only wildcards (https://*, https://**, https://*.com), and empty host. See https://www.better-auth.com/docs/reference/options for canonical pattern syntax.',
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
    oauth_provider: z
      .nativeEnum(NeonAuthOauthProviderId)
      .optional()
      .describe(
        'Identifier of the OAuth provider to add, update, or remove. Required for add_oauth_provider, update_oauth_provider, and remove_oauth_provider. Sourced from the SDK enum NeonAuthOauthProviderId so it stays in lockstep with the upstream provider list (currently includes google, github, microsoft, vercel).',
      ),
    oauth_provider_config: oauthProviderConfigSchema
      .optional()
      .describe(
        'OAuth provider credentials. For add_oauth_provider, omit entirely (or pass an empty object) to use Neon-managed shared credentials; pass client_id+client_secret to use BYO credentials. For update_oauth_provider, pass at least one field — omitted fields are left unchanged.',
      ),
    email_provider: emailProviderSchema
      .optional()
      .describe(
        'Email server configuration. Required for update_email_provider. The upstream PATCH endpoint replaces the saved configuration with the supplied discriminated union; partial within-type updates are not supported by the API.',
      ),
    test_email: sendTestEmailSchema
      .optional()
      .describe(
        'SMTP credentials + recipient for a one-off test email. Required for send_test_email.',
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
    if (
      val.operation === 'add_oauth_provider' ||
      val.operation === 'update_oauth_provider' ||
      val.operation === 'remove_oauth_provider'
    ) {
      if (val.oauth_provider === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'oauth_provider is required for this operation',
          path: ['oauth_provider'],
        });
      }
    }
    if (val.operation === 'update_oauth_provider') {
      const cfg = val.oauth_provider_config;
      const hasAtLeastOneField =
        cfg !== undefined && Object.values(cfg).some((v) => v !== undefined);
      if (!hasAtLeastOneField) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'update_oauth_provider requires at least one field in oauth_provider_config (client_id, client_secret, or microsoft_tenant_id)',
          path: ['oauth_provider_config'],
        });
      }
    }
    if (val.operation === 'add_oauth_provider') {
      // Standard mode requires both id and secret to be set together; shared
      // mode requires neither. Reject the half-set configurations early so
      // upstream doesn't return an opaque 4xx.
      const cfg = val.oauth_provider_config;
      const hasId = cfg?.client_id !== undefined;
      const hasSecret = cfg?.client_secret !== undefined;
      if (hasId !== hasSecret) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'oauth_provider_config requires client_id and client_secret to be provided together for BYO ("standard") mode, or both omitted for Neon-managed ("shared") mode',
          path: ['oauth_provider_config'],
        });
      }
    }
    if (val.operation === 'update_email_provider') {
      if (val.email_provider === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'email_provider is required for this operation',
          path: ['email_provider'],
        });
      }
    }
    if (val.operation === 'send_test_email') {
      if (val.test_email === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'test_email is required for this operation',
          path: ['test_email'],
        });
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
