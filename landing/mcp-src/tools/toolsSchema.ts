import {
  ListProjectsParams,
  ListSharedProjectsParams,
  NeonAuthEmailVerificationMethod,
} from '@neondatabase/api-client';
import * as net from 'node:net';
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

/** Per-plugin update shapes. Friendly names that map to the Neon Auth API are
 * resolved in the handler's `build*Patch()` functions; mirroring the
 * email_password convention (e.g. `allow_sign_up` ↔ `!disable_sign_up`). All
 * fields are optional → partial-update semantics. `.strict()` rejects unknown
 * keys so callers don't silently misspell field names. */
const magicLinkPluginPatchSchema = z
  .object({
    enabled: z
      .boolean()
      .optional()
      .describe('Whether the magic-link plugin is enabled.'),
    allow_sign_up: z
      .boolean()
      .optional()
      .describe(
        'Whether new users may sign up via magic link. Maps to the inverse of Neon Auth `disable_sign_up`.',
      ),
    expires_in_minutes: z
      .number()
      .int()
      .min(5)
      .max(1440)
      .optional()
      .describe(
        'Minutes before the magic link expires. Maps to Neon Auth `expires_in`. Range: 5..1440.',
      ),
  })
  .strict();

const phoneNumberPluginPatchSchema = z
  .object({
    enabled: z
      .boolean()
      .optional()
      .describe('Whether the phone-number/OTP plugin is enabled.'),
    otp_expires_in_seconds: z
      .number()
      .int()
      .min(60)
      .max(600)
      .optional()
      .describe(
        'Seconds before the SMS OTP expires. Maps to Neon Auth `otp_expires_in`. Range: 60..600.',
      ),
  })
  .strict();

const organizationPluginPatchSchema = z
  .object({
    enabled: z
      .boolean()
      .optional()
      .describe('Whether the multi-tenant organization plugin is enabled.'),
    organization_limit: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('Maximum number of organizations a user can create.'),
    membership_limit: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('Maximum number of members per organization.'),
    creator_role: z
      .enum(['admin', 'owner'])
      .optional()
      .describe('Role assigned to the user who creates an organization.'),
    send_invitation_email: z
      .boolean()
      .optional()
      .describe('Whether to send invitation emails for new members.'),
  })
  .strict();

/**
 * Webhook outbound URL guard.
 *
 * Neon Auth fires HTTP requests to `webhook_url` on auth events (user.created,
 * send.otp, send.magic_link, etc.). If we let a caller point the URL at a
 * private/internal address, the auth server effectively becomes a SSRF gadget
 * against the Neon control-plane network. This list of zod-level checks is the
 * static layer; the handler additionally resolves the host via DNS and rejects
 * any answer that lands in a private/link-local range (defence in depth — DNS
 * rebinding can move a public hostname into private space at request time).
 */
const WEBHOOK_BLOCKED_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '[::1]',
  '169.254.169.254', // AWS / GCP / Azure cloud-metadata
  'metadata.google.internal',
  'metadata.goog',
]);

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (
    parts.length !== 4 ||
    parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)
  ) {
    return false;
  }
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  // fc00::/7 (unique local), fe80::/10 (link-local)
  if (/^fc[0-9a-f]{2}:/.test(lower) || /^fd[0-9a-f]{2}:/.test(lower))
    return true;
  if (/^fe[89ab][0-9a-f]:/.test(lower)) return true;
  return false;
}

export function isPrivateHostname(host: string): boolean {
  const stripped =
    host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  const lower = stripped.toLowerCase();
  if (WEBHOOK_BLOCKED_HOSTS.has(lower)) return true;
  const ipKind = net.isIP(stripped);
  if (ipKind === 4) return isPrivateIPv4(stripped);
  if (ipKind === 6) return isPrivateIPv6(stripped);
  return false;
}

function validateWebhookUrl(
  v: string,
): { ok: true } | { ok: false; reason: string } {
  let parsed: URL;
  try {
    parsed = new URL(v);
  } catch {
    return { ok: false, reason: 'webhook_url must be a valid URL' };
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, reason: 'webhook_url must use https://' };
  }
  if (parsed.username || parsed.password) {
    return {
      ok: false,
      reason: 'webhook_url must not contain embedded credentials',
    };
  }
  if (!parsed.hostname) {
    return { ok: false, reason: 'webhook_url must have a hostname' };
  }
  if (isPrivateHostname(parsed.hostname)) {
    return {
      ok: false,
      reason: `webhook_url host "${parsed.hostname}" is on the localhost/private/link-local/cloud-metadata blocklist`,
    };
  }
  return { ok: true };
}

const NEON_AUTH_WEBHOOK_EVENTS = [
  'user.before_create',
  'user.created',
  'send.otp',
  'send.magic_link',
  'organization.invitation.created',
  'organization.invitation.accepted',
  'phone_number.verified',
] as const;

const webhookConfigPatchSchema = z
  .object({
    enabled: z.boolean().optional().describe('Whether the webhook is active.'),
    webhook_url: z
      .string()
      .min(1)
      .optional()
      .describe(
        'HTTPS URL to deliver webhook events to. Must be public; localhost / private / link-local / cloud-metadata IPs are rejected.',
      ),
    enabled_events: z
      .array(z.enum(NEON_AUTH_WEBHOOK_EVENTS))
      .optional()
      .describe(
        'List of Neon Auth events that should trigger the webhook. Allowed values: user.before_create, user.created, send.otp, send.magic_link, organization.invitation.created, organization.invitation.accepted, phone_number.verified.',
      ),
    timeout_seconds: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .describe('Webhook delivery timeout (1..10 seconds).'),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.webhook_url !== undefined) {
      const r = validateWebhookUrl(val.webhook_url);
      if (!r.ok) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: r.reason,
          path: ['webhook_url'],
        });
      }
    }
  });

export const configureNeonAuthInputSchema = z
  .object({
    operation: z
      .enum([
        'add_trusted_origin',
        'remove_trusted_origin',
        'set_allow_localhost',
        'update_auth_methods',
        'update_plugin',
        'update_webhook_config',
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
    plugin: z
      .enum(['magic_link', 'phone_number', 'organization'])
      .optional()
      .describe(
        'Which Neon Auth plugin to update. Required for update_plugin. Note: email/password is NOT a plugin — use update_auth_methods for it.',
      ),
    plugin_patch: z
      .union([
        magicLinkPluginPatchSchema,
        phoneNumberPluginPatchSchema,
        organizationPluginPatchSchema,
      ])
      .optional()
      .describe(
        'Partial-update payload for the selected plugin. Shape must match `plugin`: magic_link → {enabled?, allow_sign_up?, expires_in_minutes?}, phone_number → {enabled?, otp_expires_in_seconds?}, organization → {enabled?, organization_limit?, membership_limit?, creator_role?, send_invitation_email?}.',
      ),
    webhook: webhookConfigPatchSchema
      .optional()
      .describe(
        'Webhook configuration patch. Required for update_webhook_config. webhook_url must be https:// to a public host; localhost/private/link-local/cloud-metadata IPs are rejected at the schema layer and re-checked via DNS in the handler.',
      ),
    confirm_dangerous_change: z
      .boolean()
      .optional()
      .describe(
        'Set to true to acknowledge a high-impact change. Required to (a) change `webhook.webhook_url` and (b) disable the last enabled sign-in method (email_password / magic_link / phone_number).',
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
    if (val.operation === 'update_plugin') {
      if (!val.plugin) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'plugin is required for update_plugin (magic_link | phone_number | organization)',
          path: ['plugin'],
        });
      }
      if (!val.plugin_patch) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'plugin_patch is required for update_plugin',
          path: ['plugin_patch'],
        });
        return;
      }
      const patch = val.plugin_patch as Record<string, unknown>;
      const fields = Object.values(patch);
      if (fields.length === 0 || fields.every((v) => v === undefined)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'plugin_patch must include at least one field to update',
          path: ['plugin_patch'],
        });
        return;
      }
      // Cross-shape validation: each plugin has a distinct field set; reject
      // patches that match the wrong plugin so we never silently send keys
      // the API will reject (or worse, silently ignore).
      const ML_FIELDS = new Set([
        'enabled',
        'allow_sign_up',
        'expires_in_minutes',
      ]);
      const PN_FIELDS = new Set(['enabled', 'otp_expires_in_seconds']);
      const ORG_FIELDS = new Set([
        'enabled',
        'organization_limit',
        'membership_limit',
        'creator_role',
        'send_invitation_email',
      ]);
      const provided = Object.keys(patch).filter((k) => patch[k] !== undefined);
      const expected =
        val.plugin === 'magic_link'
          ? ML_FIELDS
          : val.plugin === 'phone_number'
            ? PN_FIELDS
            : ORG_FIELDS;
      const stranger = provided.find((k) => !expected.has(k));
      if (stranger !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `plugin_patch field "${stranger}" is not valid for plugin "${val.plugin}". Expected fields: ${Array.from(expected).join(', ')}.`,
          path: ['plugin_patch', stranger],
        });
      }
    }
    if (val.operation === 'update_webhook_config') {
      if (!val.webhook) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'webhook is required for update_webhook_config',
          path: ['webhook'],
        });
        return;
      }
      const fields = Object.values(val.webhook as Record<string, unknown>);
      if (fields.every((v) => v === undefined)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'webhook must include at least one field to update',
          path: ['webhook'],
        });
        return;
      }
      if (
        val.webhook.webhook_url !== undefined &&
        val.confirm_dangerous_change !== true
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'changing webhook_url is destructive (re-routes outbound auth events). Set confirm_dangerous_change: true to proceed.',
          path: ['confirm_dangerous_change'],
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
