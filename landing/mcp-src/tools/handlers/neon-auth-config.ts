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

// Focused success message for OAuth-provider operations. Shows only the
// configured-providers slice (with secrets redacted) instead of the full
// settings snapshot — keeps responses concise per product preference.
async function oauthProvidersSummaryMessage(
  neonClient: Api<unknown>,
  projectId: string,
  branchId: string,
  header: string,
): Promise<CallToolResult> {
  const { providers, error } = await fetchOAuthProvidersSlice(
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
          stringifyOAuthProvidersSlice(
            'Configured OAuth providers (client_secret redacted; see get_neon_auth_config for the same view alongside other settings):',
            providers,
            error,
          ),
        ].join('\n'),
      },
    ],
  };
}

// Focused success message for the email-provider operation. Same rationale
// as `oauthProvidersSummaryMessage`.
async function emailProviderSummaryMessage(
  neonClient: Api<unknown>,
  projectId: string,
  branchId: string,
  header: string,
): Promise<CallToolResult> {
  const { provider, error } = await fetchEmailProviderSlice(
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
          stringifyEmailProviderSlice(
            'Current email provider configuration (SMTP password redacted; see get_neon_auth_config for the same view alongside other settings):',
            provider,
            error,
          ),
        ].join('\n'),
      },
    ],
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
      const mode =
        cfg?.client_id !== undefined && cfg?.client_secret !== undefined
          ? 'standard (BYO credentials)'
          : 'shared (Neon-managed credentials)';
      return oauthProvidersSummaryMessage(
        neonClient,
        props.projectId,
        branchId,
        `Requested add of OAuth provider ${props.oauth_provider} in ${mode} mode.`,
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
      if (res.status !== 200) {
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
      );
    }
    case 'update_email_provider': {
      // The upstream PATCH endpoint expects the full discriminated union
      // (the API does not support partial within-type updates), which is
      // exactly what our schema produces.
      const body = props.email_provider! as NeonAuthEmailServerConfig;
      const res = await neonClient.updateNeonAuthEmailProvider(
        props.projectId,
        branchId,
        body,
      );
      if (res.status !== 200) {
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
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Failed to dispatch test email request (${res.status} ${res.statusText}).`,
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
