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

// Server-side SSRF guards. Applied to user-supplied hostnames/URLs that the
// Neon Auth control plane will dial out to (webhook deliveries, SMTP probes,
// test emails). Block loopback / private / link-local / cloud-metadata.
const PRIVATE_HOST_LITERAL_RE =
  /^(localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|100\.64\.|172\.(1[6-9]|2\d|3[0-1])\.|::1?$|\[::1?\]|fc[0-9a-f]{2}:|fd[0-9a-f]{2}:|fe80:|\[fc[0-9a-f]{2}:|\[fd[0-9a-f]{2}:|\[fe80:)/i;

function isBlockedDialOutHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  if (!h) return true;
  if (PRIVATE_HOST_LITERAL_RE.test(h)) return true;
  // metadata services
  if (h === '169.254.169.254' || h === 'metadata.google.internal') return true;
  // .local mDNS, .internal cloud metadata, .localhost reserved TLD
  if (/\.(local|internal|localhost)$/.test(h)) return true;
  return false;
}

function isHttpsDialOutUrl(v: string): boolean {
  try {
    const u = new URL(v);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    // Disallow plain http for non-localhost since this URL is dialed by the
    // server. Localhost dial-outs from the upstream make no sense either, so
    // we reject them outright.
    if (u.protocol === 'http:') return false;
    if (isBlockedDialOutHost(u.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

const WEBHOOK_BLOCKED_URL_MSG =
  'Webhook URL must be an https:// URL pointing at a publicly reachable host. http:// is rejected; loopback, private (RFC1918), link-local, carrier-grade NAT, and cloud-metadata addresses are blocked to prevent SSRF.';

export const neonAuthProvisionInputSchema = z.object({
  projectId: z
    .string()
    .describe('The ID of the project to provision Neon Auth for.'),
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

const emailPasswordSliceSchema = z
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

const magicLinkSliceSchema = z
  .object({
    enabled: z
      .boolean()
      .optional()
      .describe('Whether magic-link sign-in is enabled.'),
  })
  .strict();

const phoneSliceSchema = z
  .object({
    enabled: z
      .boolean()
      .optional()
      .describe('Whether phone-number sign-in is enabled.'),
  })
  .strict();

const signInMethodsSchema = z
  .object({
    email_password: emailPasswordSliceSchema
      .optional()
      .describe(
        'Email-and-password sign-in. Provide only the fields you want to change; omitted fields are left unchanged.',
      ),
    magic_link: magicLinkSliceSchema
      .optional()
      .describe('Magic-link plugin toggle.'),
    phone: phoneSliceSchema.optional().describe('Phone-number plugin toggle.'),
  })
  .strict();

const organizationsSliceSchema = z
  .object({
    enabled: z
      .boolean()
      .optional()
      .describe('Whether the organizations plugin is enabled.'),
  })
  .strict();

// `email_delivery` reuses the same discriminated union as v1's email_provider.
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
      'SMTP authentication password. Never echoed back by any read tool.',
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

const emailDeliverySchema = z
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
            'Optional override for the From: address on the Neon-managed shared SMTP.',
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
    'Email delivery configuration discriminated by `type`. "standard" = BYO SMTP (full credentials required); "shared" = Neon-managed shared SMTP. The upstream PATCH replaces the saved configuration; partial within-type updates are not supported.',
  );

export const neonAuthMethodsUpdateInputSchema = z
  .object({
    projectId: z.string().describe('Neon project ID.'),
    branchId: z
      .string()
      .optional()
      .describe(
        'Branch ID. If omitted, the project default branch is used (same as `neon_auth_provision`).',
      ),
    sign_in_methods: signInMethodsSchema
      .optional()
      .describe(
        'Sign-in method slices. Provide only the slices you want to change.',
      ),
    email_delivery: emailDeliverySchema
      .optional()
      .describe(
        'Email delivery (transactional) configuration. Discriminated union by `type`.',
      ),
    organizations: organizationsSliceSchema
      .optional()
      .describe('Organizations plugin slice.'),
    app_name: z
      .string()
      .min(1)
      .optional()
      .describe('Display name of the application (Better Auth `app_name`).'),
  })
  .strict()
  .superRefine((val, ctx) => {
    const sliceCount =
      (val.sign_in_methods ? 1 : 0) +
      (val.email_delivery ? 1 : 0) +
      (val.organizations ? 1 : 0) +
      (val.app_name !== undefined ? 1 : 0);
    if (sliceCount === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'At least one slice must be provided: sign_in_methods, email_delivery, organizations, or app_name.',
      });
      return;
    }
    if (val.sign_in_methods) {
      const subSliceCount =
        (val.sign_in_methods.email_password ? 1 : 0) +
        (val.sign_in_methods.magic_link ? 1 : 0) +
        (val.sign_in_methods.phone ? 1 : 0);
      if (subSliceCount === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'sign_in_methods must include at least one slice (email_password, magic_link, or phone).',
          path: ['sign_in_methods'],
        });
      }
      const ep = val.sign_in_methods.email_password;
      if (ep && Object.values(ep).every((v) => v === undefined)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'sign_in_methods.email_password must include at least one field to update.',
          path: ['sign_in_methods', 'email_password'],
        });
      }
      const ml = val.sign_in_methods.magic_link;
      if (ml && Object.values(ml).every((v) => v === undefined)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'sign_in_methods.magic_link must include at least one field to update.',
          path: ['sign_in_methods', 'magic_link'],
        });
      }
      const ph = val.sign_in_methods.phone;
      if (ph && Object.values(ph).every((v) => v === undefined)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'sign_in_methods.phone must include at least one field to update.',
          path: ['sign_in_methods', 'phone'],
        });
      }
    }
    if (
      val.organizations &&
      Object.values(val.organizations).every((v) => v === undefined)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'organizations must include at least one field to update.',
        path: ['organizations'],
      });
    }
  });

// ---------------------------------------------------------------------------
// OAuth provider — add / update / delete.
//
// Provider list is intentionally narrower than the SDK's `NeonAuthOauthProviderId`
// enum. The SDK enum (`google`, `github`, `microsoft`, `vercel`) reflects the
// public API contract from the StackAuth era. Today the MCP only provisions
// BetterAuth-backed projects (see `neon_auth_provision`), and BetterAuth's
// neon-auth Zod allowlist accepts only `google` / `github` / `vercel` — calling
// add with `microsoft` would 400 at runtime. The Lakebase console UI applies
// the same gating (Microsoft is hidden when `auth_provider === 'better_auth'`).
// ---------------------------------------------------------------------------

const NEON_AUTH_BETTERAUTH_OAUTH_PROVIDERS = [
  'google',
  'github',
  'vercel',
] as const satisfies readonly `${NeonAuthOauthProviderId}`[];

const oauthProviderConfigSchema = z
  .object({
    client_id: z
      .string()
      .min(1)
      .optional()
      .describe(
        'OAuth client ID issued by the upstream provider. Pair with `client_secret` for BYO ("standard") mode; omit both for Neon-managed ("shared") mode.',
      ),
    client_secret: z
      .string()
      .min(1)
      .optional()
      .describe(
        'OAuth client secret issued by the upstream provider. Pair with `client_id` for BYO ("standard") mode; omit both for Neon-managed ("shared") mode.',
      ),
  })
  .strict();

export const neonAuthOauthProviderAddInputSchema = z
  .object({
    projectId: z.string().describe('Neon project ID.'),
    branchId: z
      .string()
      .optional()
      .describe('Branch ID. If omitted, the project default branch is used.'),
    provider_id: z
      .enum(NEON_AUTH_BETTERAUTH_OAUTH_PROVIDERS)
      .describe(
        'Identifier of the OAuth provider to add. Limited to providers BetterAuth supports (`google`, `github`, `vercel`).',
      ),
    oauth_provider_config: oauthProviderConfigSchema
      .optional()
      .describe(
        'OAuth credentials. Omit (or pass an empty object) for Neon-managed shared mode; pass `client_id` + `client_secret` together for BYO mode.',
      ),
  })
  .strict()
  .superRefine((val, ctx) => {
    const cfg = val.oauth_provider_config;
    const hasId = cfg?.client_id !== undefined;
    const hasSecret = cfg?.client_secret !== undefined;
    if (hasId !== hasSecret) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'oauth_provider_config requires client_id and client_secret to be provided together for BYO ("standard") mode, or both omitted for Neon-managed ("shared") mode.',
        path: ['oauth_provider_config'],
      });
    }
  });

export const neonAuthOauthProviderUpdateInputSchema = z
  .object({
    projectId: z.string().describe('Neon project ID.'),
    branchId: z
      .string()
      .optional()
      .describe('Branch ID. If omitted, the project default branch is used.'),
    provider_id: z
      .enum(NEON_AUTH_BETTERAUTH_OAUTH_PROVIDERS)
      .describe('Identifier of the OAuth provider to update.'),
    oauth_provider_config: oauthProviderConfigSchema.describe(
      'Credential updates. Pass at least one of client_id, client_secret; omitted fields are left unchanged.',
    ),
  })
  .strict()
  .superRefine((val, ctx) => {
    const cfg = val.oauth_provider_config;
    if (!cfg || Object.values(cfg).every((v) => v === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'oauth_provider_config requires at least one field (client_id or client_secret).',
        path: ['oauth_provider_config'],
      });
    }
  });

export const neonAuthOauthProviderDeleteInputSchema = z
  .object({
    projectId: z.string().describe('Neon project ID.'),
    branchId: z
      .string()
      .optional()
      .describe('Branch ID. If omitted, the project default branch is used.'),
    provider_id: z
      .enum(NEON_AUTH_BETTERAUTH_OAUTH_PROVIDERS)
      .describe('Identifier of the OAuth provider to delete.'),
  })
  .strict();

// ---------------------------------------------------------------------------
// Webhook update.
// ---------------------------------------------------------------------------

const NEON_AUTH_WEBHOOK_EVENTS = [
  'user.before_create',
  'user.created',
  'send.otp',
  'send.magic_link',
] as const;

export const neonAuthWebhookUpdateInputSchema = z
  .object({
    projectId: z.string().describe('Neon project ID.'),
    branchId: z
      .string()
      .optional()
      .describe('Branch ID. If omitted, the project default branch is used.'),
    enabled: z.boolean().describe('Whether the webhook is enabled.'),
    url: z
      .string()
      .url()
      .refine(isHttpsDialOutUrl, { message: WEBHOOK_BLOCKED_URL_MSG })
      .optional()
      .describe(
        'Destination URL receiving webhook deliveries. Must be an https:// URL on a publicly reachable host. http://, loopback, private (RFC1918), link-local, and cloud-metadata addresses are rejected to prevent SSRF.',
      ),
    events: z
      .array(z.enum(NEON_AUTH_WEBHOOK_EVENTS))
      .optional()
      .describe(
        'Events that should trigger a webhook delivery. Allowed values: user.before_create, user.created, send.otp, send.magic_link.',
      ),
    timeout_seconds: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .describe('Per-delivery timeout in seconds (1-10).'),
  })
  .strict()
  .superRefine((val, ctx) => {
    // Upstream PUT replaces the saved webhook config. If the caller is
    // turning the webhook ON without supplying url/events, we'd silently
    // clear those — block at validation time so the agent has to send the
    // full intended state.
    if (val.enabled === true) {
      if (val.url === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            '`url` is required when `enabled` is true. The upstream PUT replaces the saved config, so omitting `url` would clear the existing value.',
          path: ['url'],
        });
      }
      if (val.events === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            '`events` is required when `enabled` is true. The upstream PUT replaces the saved config, so omitting `events` would clear the existing list.',
          path: ['events'],
        });
      }
    }
  });

// ---------------------------------------------------------------------------
// Domain update — atomic batch (add / remove / allow_localhost).
// ---------------------------------------------------------------------------

/**
 * Validates a `trusted_origin` URL before it ever reaches the Neon API.
 *
 * Neon Auth's trusted-domains list is a security boundary (CSRF on the
 * Origin/Referer header + allowlist for callback/redirect URLs in sign-in,
 * OAuth, email verification, password reset, and magic-link flows). Bad
 * entries here can broaden CSRF or open redirect surface.
 */
const TRUSTED_ORIGIN_BLOCKED_SCHEMES = new Set([
  'file',
  'data',
  'javascript',
  'vbscript',
  'about',
]);

const TRUSTED_ORIGIN_LOCAL_HOST_RE = /^(localhost|127\.0\.0\.1|\[::1\])$/i;
const TRUSTED_ORIGIN_HOST_WILDCARD_RE = /^\*+(\.[a-z]{2,})?$/i;
const TRUSTED_ORIGIN_SCHEME_PREFIX_RE = /^([a-zA-Z][a-zA-Z0-9+.\-]*):\/\/(.*)$/;

function extractHttpHost(rest: string): string | null {
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

const TRUSTED_ORIGIN_REJECT_MESSAGE =
  'Each entry must be an https:// URL or origin (wildcard subdomains allowed, e.g. https://*.example.com), an http://localhost (or 127.0.0.1/[::1]) origin, or a custom-scheme deeplink (e.g. myapp://). Rejected: file:/data:/javascript:/vbscript:/about: schemes, non-localhost http://, host-only or TLD-only wildcards (https://*, https://**, https://*.com), empty host, surrounding whitespace, and ASCII control characters.';

const trustedOriginUrlSchema = z
  .string()
  .min(1)
  .refine(isValidTrustedOrigin, { message: TRUSTED_ORIGIN_REJECT_MESSAGE });

export const neonAuthDomainUpdateInputSchema = z
  .object({
    projectId: z.string().describe('Neon project ID.'),
    branchId: z
      .string()
      .optional()
      .describe('Branch ID. If omitted, the project default branch is used.'),
    add: z
      .array(trustedOriginUrlSchema)
      .optional()
      .describe(
        'URLs to add to the trusted-origin allowlist. Each is validated against the same security rules used by the v1 add-trusted-origin operation.',
      ),
    remove: z
      .array(trustedOriginUrlSchema)
      .optional()
      .describe(
        'URLs to remove from the trusted-origin allowlist. Resolved to ids server-side via a list-then-delete fan-out.',
      ),
    allow_localhost: z
      .boolean()
      .optional()
      .describe(
        'Whether to allow localhost origins for development. Optional; if omitted, the current value is left unchanged.',
      ),
  })
  .strict()
  .superRefine((val, ctx) => {
    const present =
      (val.add && val.add.length > 0) ||
      (val.remove && val.remove.length > 0) ||
      val.allow_localhost !== undefined;
    if (!present) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'At least one of add, remove, or allow_localhost must be provided.',
      });
    }
  });

// ---------------------------------------------------------------------------
// Send test email.
// ---------------------------------------------------------------------------

export const neonAuthSendTestEmailInputSchema = z
  .object({
    projectId: z.string().describe('Neon project ID.'),
    branchId: z
      .string()
      .optional()
      .describe('Branch ID. If omitted, the project default branch is used.'),
    recipient_email: z
      .string()
      .email()
      .min(1)
      .max(256)
      .describe('Email address to deliver the test message to.'),
    ...standardEmailServerFields,
  })
  .strict();

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
