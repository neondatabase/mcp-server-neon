import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  Api,
  NeonAuthAddOAuthProviderRequest,
  NeonAuthEmailAndPasswordConfigUpdate,
  NeonAuthEmailServerConfig,
  NeonAuthSupportedAuthProvider,
  NeonAuthUpdateOAuthProviderRequest,
} from '@neondatabase/api-client';
import { configureNeonAuthInputSchema } from '../toolsSchema';
import { z } from 'zod/v3';
import { getDefaultBranch } from './utils';
import {
  fetchEmailProviderSlice,
  fetchNeonAuthConfigurableSettings,
  fetchOAuthProvidersSlice,
  stringifyEmailProviderSlice,
  stringifyNeonAuthConfigurableSettings,
  stringifyOAuthProvidersSlice,
} from './neon-auth-settings-snapshot';
import { ToolHandlerExtraParams } from '../types';

type Props = z.infer<typeof configureNeonAuthInputSchema>;

const SNAPSHOT_TITLE =
  'Current Neon Auth settings (same fields as get_neon_auth_config):';

/**
 * Single canonical "Neon Auth is not provisioned" message shared between
 * get_neon_auth_config (which detects the 404 directly while fetching the
 * integration) and configure_neon_auth (which pre-checks via getNeonAuth so a
 * 404 is unambiguously "not provisioned" rather than "OAuth provider/email
 * provider not found"). The wording is deliberately prescriptive about the
 * approval gate: provisioning has side effects, so the LLM must surface the
 * prerequisite to the user and obtain explicit consent before calling
 * provision_neon_auth.
 */
export const NEON_AUTH_NOT_PROVISIONED_MESSAGE =
  'Neon Auth is not provisioned for this branch (HTTP 404). Before calling provision_neon_auth, ask the user for explicit approval — provisioning has side effects (creates the neon_auth schema, deploys an auth service in your compute region, may incur cost).';

export async function resolveNeonAuthBranchId(
  projectId: string,
  branchId: string | undefined,
  neonClient: Api<unknown>,
): Promise<string> {
  if (branchId) {
    return branchId;
  }
  const defaultBranch = await getDefaultBranch(projectId, neonClient);
  return defaultBranch.id;
}

/**
 * Pre-flight check: returns null when Neon Auth IS provisioned for this
 * branch (callers should then proceed); returns a CallToolResult to short-
 * circuit with when it is not, or when the integration probe itself failed.
 *
 * Why a dedicated probe rather than mapping the per-operation 404? Several
 * operations have their own 404-meaningful semantics (e.g. update_oauth_provider
 * on an unknown provider id, delete on a missing entry). Disambiguating by
 * status code alone is unsafe, so we ask the integration endpoint directly:
 * a 404 there definitively means the branch has no Neon Auth integration.
 */
async function ensureNeonAuthProvisioned(
  neonClient: Api<unknown>,
  projectId: string,
  branchId: string,
): Promise<CallToolResult | null> {
  const res = await neonClient.getNeonAuth(projectId, branchId);
  if (res.status === 200) {
    return null;
  }
  if (res.status === 404) {
    return {
      isError: true,
      content: [{ type: 'text', text: NEON_AUTH_NOT_PROVISIONED_MESSAGE }],
    };
  }
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: `Failed to verify Neon Auth provisioning (${res.status} ${res.statusText}).`,
      },
    ],
  };
}

async function snapshotMessage(
  neonClient: Api<unknown>,
  projectId: string,
  branchId: string,
  header: string,
): Promise<CallToolResult> {
  const { settings, errors } = await fetchNeonAuthConfigurableSettings(
    neonClient,
    projectId,
    branchId,
  );
  return {
    content: [
      {
        type: 'text',
        text: [
          header,
          '',
          stringifyNeonAuthConfigurableSettings(
            SNAPSHOT_TITLE,
            settings,
            errors,
          ),
        ].join('\n'),
      },
    ],
  };
}

/**
 * Post-mutation reconciliation expectation.
 *
 * The handlers issue a write, then re-fetch a focused slice to render a
 * concise summary. If a concurrent change races between the write and the
 * read, the slice can disagree with what we just acknowledged (e.g. PATCH
 * 200 followed by a 404 on the GET). We treat that as a soft inconsistency
 * — the upstream write was acknowledged, so we don't flip `isError`, but
 * we DO surface a warning line so the caller doesn't read the empty slice
 * as "the change silently undid itself".
 */
type PostMutationExpectation =
  // Slice should contain a row keyed by this provider id (add / update).
  | { kind: 'oauth-must-include'; providerId: string }
  // Slice should NOT contain a row keyed by this provider id (remove).
  | { kind: 'oauth-must-exclude'; providerId: string }
  // Slice should be non-null (update_email_provider).
  | { kind: 'email-must-be-present' }
  // No reconciliation check (read-only / unrelated reload).
  | { kind: 'none' };

const RECONCILIATION_WARNING_PREFIX =
  'WARNING: post-mutation snapshot reload disagrees with the upstream write';

function reconcileOauthSlice(
  providers: ReadonlyArray<{ id: string }>,
  expectation: PostMutationExpectation,
): string | null {
  if (expectation.kind === 'oauth-must-include') {
    const present = providers.some((p) => p.id === expectation.providerId);
    if (!present) {
      return `${RECONCILIATION_WARNING_PREFIX}: provider "${expectation.providerId}" is absent from the post-write provider list. The mutation was acknowledged by upstream; a concurrent change may have raced. Re-run get_neon_auth_config to reconcile.`;
    }
  }
  if (expectation.kind === 'oauth-must-exclude') {
    const present = providers.some((p) => p.id === expectation.providerId);
    if (present) {
      return `${RECONCILIATION_WARNING_PREFIX}: provider "${expectation.providerId}" is still present in the post-write provider list. The delete was acknowledged by upstream; a concurrent change may have raced. Re-run get_neon_auth_config to reconcile.`;
    }
  }
  return null;
}

// Focused success message for OAuth-provider operations. Shows only the
// configured-providers slice (with secrets redacted) instead of the full
// settings snapshot — keeps responses concise per product preference.
async function oauthProvidersSummaryMessage(
  neonClient: Api<unknown>,
  projectId: string,
  branchId: string,
  header: string,
  expectation: PostMutationExpectation = { kind: 'none' },
): Promise<CallToolResult> {
  const { providers, error } = await fetchOAuthProvidersSlice(
    neonClient,
    projectId,
    branchId,
  );
  const reconciliationWarning = reconcileOauthSlice(providers, expectation);
  const lines: string[] = [header];
  if (reconciliationWarning) {
    lines.push('', reconciliationWarning);
  }
  lines.push(
    '',
    stringifyOAuthProvidersSlice(
      'Configured OAuth providers (client_secret redacted; see get_neon_auth_config for the same view alongside other settings):',
      providers,
      error,
    ),
  );
  return {
    content: [{ type: 'text', text: lines.join('\n') }],
  };
}

// Focused success message for the email-provider operation. Same rationale
// as `oauthProvidersSummaryMessage`.
async function emailProviderSummaryMessage(
  neonClient: Api<unknown>,
  projectId: string,
  branchId: string,
  header: string,
  expectation: PostMutationExpectation = { kind: 'none' },
): Promise<CallToolResult> {
  const { provider, error } = await fetchEmailProviderSlice(
    neonClient,
    projectId,
    branchId,
  );
  let reconciliationWarning: string | null = null;
  if (expectation.kind === 'email-must-be-present' && provider === null) {
    reconciliationWarning = `${RECONCILIATION_WARNING_PREFIX}: email provider is absent from the post-write snapshot (upstream returned 404). The PATCH was acknowledged by upstream; a concurrent delete or propagation lag may have raced. Re-run get_neon_auth_config to reconcile.`;
  }
  const lines: string[] = [header];
  if (reconciliationWarning) {
    lines.push('', reconciliationWarning);
  }
  lines.push(
    '',
    stringifyEmailProviderSlice(
      'Current email provider configuration (SMTP password redacted; see get_neon_auth_config for the same view alongside other settings):',
      provider,
      error,
    ),
  );
  return {
    content: [{ type: 'text', text: lines.join('\n') }],
  };
}

function buildEmailPasswordPatch(
  email: NonNullable<NonNullable<Props['methods']>['email_password']>,
): NeonAuthEmailAndPasswordConfigUpdate {
  const patch: NeonAuthEmailAndPasswordConfigUpdate = {};
  if (email.enabled !== undefined) {
    patch.enabled = email.enabled;
  }
  if (email.allow_sign_up !== undefined) {
    patch.disable_sign_up = !email.allow_sign_up;
  }
  if (email.verify_email_on_sign_up !== undefined) {
    patch.send_verification_email_on_sign_up = email.verify_email_on_sign_up;
  }
  if (email.verify_email_on_sign_in !== undefined) {
    patch.send_verification_email_on_sign_in = email.verify_email_on_sign_in;
  }
  if (email.email_verification_method !== undefined) {
    patch.email_verification_method = email.email_verification_method;
  }
  if (email.require_email_verification !== undefined) {
    patch.require_email_verification = email.require_email_verification;
  }
  if (email.auto_sign_in_after_verification !== undefined) {
    patch.auto_sign_in_after_verification =
      email.auto_sign_in_after_verification;
  }
  return patch;
}

export async function handleConfigureNeonAuth(
  props: Props,
  neonClient: Api<unknown>,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _extra: ToolHandlerExtraParams,
): Promise<CallToolResult> {
  const branchId = await resolveNeonAuthBranchId(
    props.projectId,
    props.branchId,
    neonClient,
  );

  // Prerequisite probe before any mutation: see ensureNeonAuthProvisioned.
  // Costs one extra GET per configure call but lets us return an actionable
  // "ask the user before provisioning" message instead of a per-op generic
  // 404 string, and avoids conflating "Neon Auth not provisioned" with
  // op-level 404s (e.g. unknown OAuth provider id).
  const prereq = await ensureNeonAuthProvisioned(
    neonClient,
    props.projectId,
    branchId,
  );
  if (prereq) {
    return prereq;
  }

  switch (props.operation) {
    case 'add_trusted_origin': {
      const res = await neonClient.addBranchNeonAuthTrustedDomain(
        props.projectId,
        branchId,
        {
          domain: props.trusted_origin!,
          auth_provider: NeonAuthSupportedAuthProvider.BetterAuth,
        },
      );
      if (res.status !== 201) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Failed to add trusted origin (${res.status} ${res.statusText}). Ensure Neon Auth is provisioned for this branch and the URL is valid.`,
            },
          ],
        };
      }
      // The header echoes the caller's input rather than what the server
      // ultimately stored: the Neon API may canonicalize the value (lowercase
      // host, trim trailing slash, etc.). The snapshot rendered below is the
      // source of truth.
      return snapshotMessage(
        neonClient,
        props.projectId,
        branchId,
        `Requested add of trusted origin: ${props.trusted_origin}`,
      );
    }
    case 'remove_trusted_origin': {
      const res = await neonClient.deleteBranchNeonAuthTrustedDomain(
        props.projectId,
        branchId,
        {
          auth_provider: NeonAuthSupportedAuthProvider.BetterAuth,
          domains: [{ domain: props.trusted_origin! }],
        },
      );
      if (res.status !== 200) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Failed to remove trusted origin (${res.status} ${res.statusText}). Ensure the URL exists in the trusted origins list.`,
            },
          ],
        };
      }
      // The Neon API's batch-delete returns 200 even when the requested
      // entry was not present, so we cannot claim definitive removal here.
      // The snapshot below is the source of truth for the resulting list.
      return snapshotMessage(
        neonClient,
        props.projectId,
        branchId,
        `Requested remove of trusted origin: ${props.trusted_origin}`,
      );
    }
    case 'set_allow_localhost': {
      const res = await neonClient.updateNeonAuthAllowLocalhost(
        props.projectId,
        branchId,
        { allow_localhost: props.allow_localhost! },
      );
      if (res.status !== 200) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Failed to update allow localhost (${res.status} ${res.statusText}).`,
            },
          ],
        };
      }
      return snapshotMessage(
        neonClient,
        props.projectId,
        branchId,
        `allow_localhost is now ${res.data.allow_localhost ? 'enabled' : 'disabled'} for this branch.`,
      );
    }
    case 'update_auth_methods': {
      const emailPassword = props.methods?.email_password;
      // The schema's superRefine guarantees at least one method block with at
      // least one field, but it doesn't know which blocks this handler can
      // actually apply. As we add more methods to the schema (magic_link,
      // etc.) we must extend this branch with their corresponding API call.
      // The `applied` flag is defence-in-depth: if a future method is added
      // to the schema without a matching handler arm here, we fail loudly
      // instead of silently returning a "success" snapshot that didn't
      // actually mutate anything upstream.
      let applied = false;
      if (emailPassword) {
        const patch = buildEmailPasswordPatch(emailPassword);
        const res = await neonClient.updateNeonAuthEmailAndPasswordConfig(
          props.projectId,
          branchId,
          patch,
        );
        if (res.status !== 200) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `Failed to update email_password auth method (${res.status} ${res.statusText}).`,
              },
            ],
          };
        }
        applied = true;
      }
      if (!applied) {
        const requested =
          Object.keys(props.methods ?? {}).join(',') || '<none>';
        throw new Error(
          `update_auth_methods: no handler applied for methods=${requested}. ` +
            'This indicates a schema/handler skew — a method block was accepted ' +
            'by the input schema but has no corresponding handler branch.',
        );
      }
      return snapshotMessage(
        neonClient,
        props.projectId,
        branchId,
        'Updated auth methods for this branch.',
      );
    }
    case 'add_oauth_provider': {
      const cfg = props.oauth_provider_config;
      const body: NeonAuthAddOAuthProviderRequest = {
        id: props.oauth_provider!,
      };
      if (cfg?.client_id !== undefined) body.client_id = cfg.client_id;
      if (cfg?.client_secret !== undefined)
        body.client_secret = cfg.client_secret;
      if (cfg?.microsoft_tenant_id !== undefined) {
        body.microsoft_tenant_id = cfg.microsoft_tenant_id;
      }
      const res = await neonClient.addBranchNeonAuthOauthProvider(
        props.projectId,
        branchId,
        body,
      );
      // Upstream returns 201 on first add, 200 on idempotent re-add. Accept
      // both so callers don't see a confusing "failed" message on a benign
      // re-issue.
      if (res.status !== 201 && res.status !== 200) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Failed to add OAuth provider ${props.oauth_provider} (${res.status} ${res.statusText}). Ensure Neon Auth is provisioned for this branch and credentials are valid.`,
            },
          ],
        };
      }
      // Header is intentionally mode-agnostic: the upstream response (mirrored
      // in the snapshot below as `type: 'standard' | 'shared'`) is the source
      // of truth for which mode the provider was registered in. We can't infer
      // mode from the request payload alone — e.g. a Microsoft caller passing
      // only `microsoft_tenant_id` would otherwise be mislabeled as "shared".
      return oauthProvidersSummaryMessage(
        neonClient,
        props.projectId,
        branchId,
        `Requested add of OAuth provider ${props.oauth_provider}.`,
        { kind: 'oauth-must-include', providerId: props.oauth_provider! },
      );
    }
    case 'update_oauth_provider': {
      const cfg = props.oauth_provider_config!;
      const body: NeonAuthUpdateOAuthProviderRequest = {};
      if (cfg.client_id !== undefined) body.client_id = cfg.client_id;
      if (cfg.client_secret !== undefined)
        body.client_secret = cfg.client_secret;
      if (cfg.microsoft_tenant_id !== undefined) {
        body.microsoft_tenant_id = cfg.microsoft_tenant_id;
      }
      const res = await neonClient.updateBranchNeonAuthOauthProvider(
        props.projectId,
        branchId,
        props.oauth_provider!,
        body,
      );
      // Accept both 200 (PATCH returning the updated resource) and 204 (PATCH
      // accepted, no body) — upstream is documented to return 200 today, but
      // matching the permissiveness used by `remove_oauth_provider` shields
      // us from a future spec narrowing/widening.
      if (res.status !== 200 && res.status !== 204) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Failed to update OAuth provider ${props.oauth_provider} (${res.status} ${res.statusText}). Ensure the provider is currently configured on this branch.`,
            },
          ],
        };
      }
      return oauthProvidersSummaryMessage(
        neonClient,
        props.projectId,
        branchId,
        `Requested update of OAuth provider ${props.oauth_provider}.`,
        { kind: 'oauth-must-include', providerId: props.oauth_provider! },
      );
    }
    case 'remove_oauth_provider': {
      const res = await neonClient.deleteBranchNeonAuthOauthProvider(
        props.projectId,
        branchId,
        props.oauth_provider!,
      );
      // Upstream may return 200 or 204 for a successful delete; the request
      // is idempotent so a 200 on a missing entry is also acceptable.
      if (res.status !== 200 && res.status !== 204) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Failed to remove OAuth provider ${props.oauth_provider} (${res.status} ${res.statusText}).`,
            },
          ],
        };
      }
      return oauthProvidersSummaryMessage(
        neonClient,
        props.projectId,
        branchId,
        `Requested remove of OAuth provider ${props.oauth_provider}.`,
        { kind: 'oauth-must-exclude', providerId: props.oauth_provider! },
      );
    }
    case 'update_email_provider': {
      // The upstream PATCH endpoint expects the full discriminated union
      // (the API does not support partial within-type updates). Using a type
      // annotation rather than `as` so any divergence between our Zod-derived
      // shape and the SDK's NeonAuthEmailServerConfig union surfaces at the
      // type-checker, not at runtime.
      const body: NeonAuthEmailServerConfig = props.email_provider!;
      const res = await neonClient.updateNeonAuthEmailProvider(
        props.projectId,
        branchId,
        body,
      );
      // Accept both 200 (PATCH returning the updated resource) and 204 (PATCH
      // accepted, no body). See note on update_oauth_provider above.
      if (res.status !== 200 && res.status !== 204) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Failed to update email provider (${res.status} ${res.statusText}).`,
            },
          ],
        };
      }
      return emailProviderSummaryMessage(
        neonClient,
        props.projectId,
        branchId,
        `Requested update of email provider (type=${body.type}).`,
        { kind: 'email-must-be-present' },
      );
    }
    case 'send_test_email': {
      const t = props.test_email!;
      const res = await neonClient.sendNeonAuthTestEmail(
        props.projectId,
        branchId,
        {
          recipient_email: t.recipient_email,
          host: t.host,
          port: t.port,
          username: t.username,
          password: t.password,
          sender_email: t.sender_email,
          sender_name: t.sender_name,
        },
      );
      if (res.status !== 200) {
        // In practice axios's default validateStatus rejects 4xx/5xx as
        // thrown errors handled by the outer wrapper, but if a future SDK
        // config relaxes that, the resolved-non-200 path also needs to
        // surface any `error_message` in the upstream body so callers see
        // *why* the dispatch failed, not just the HTTP code.
        const upstreamMessage =
          typeof res.data === 'object' &&
          res.data !== null &&
          'error_message' in res.data &&
          typeof (res.data as { error_message?: unknown }).error_message ===
            'string'
            ? (res.data as { error_message: string }).error_message
            : undefined;
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: upstreamMessage
                ? `Failed to dispatch test email request (${res.status} ${res.statusText}).\nUpstream error: ${upstreamMessage}`
                : `Failed to dispatch test email request (${res.status} ${res.statusText}).`,
            },
          ],
        };
      }
      // Pass the upstream result through verbatim. We deliberately don't
      // refresh the snapshot here — sending a test email is a side-effect
      // that doesn't mutate Neon Auth state.
      const { success, error_message } = res.data;
      const header = success
        ? `Test email dispatched to ${t.recipient_email} via ${t.host}:${t.port}.`
        : `Test email could NOT be sent to ${t.recipient_email} via ${t.host}:${t.port}.`;
      const detail = error_message ? `\nUpstream error: ${error_message}` : '';
      return {
        isError: !success,
        content: [
          {
            type: 'text',
            text: `${header}${detail}`,
          },
        ],
      };
    }
  }
}
