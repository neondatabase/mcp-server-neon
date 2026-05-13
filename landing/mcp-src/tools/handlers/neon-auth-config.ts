import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  Api,
  NeonAuthEmailAndPasswordConfigUpdate,
  NeonAuthMagicLinkConfigUpdate,
  NeonAuthOrganizationConfigUpdate,
  NeonAuthPhoneNumberConfigUpdate,
  NeonAuthSupportedAuthProvider,
  NeonAuthWebhookConfig,
} from '@neondatabase/api-client';
import * as dns from 'node:dns/promises';
import { configureNeonAuthInputSchema } from '../toolsSchema';
import { isPrivateHostname } from '../toolsSchema';
import { z } from 'zod/v3';
import { getDefaultBranch } from './utils';
import {
  fetchNeonAuthConfigurableSettings,
  stringifyNeonAuthConfigurableSettings,
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

type MagicLinkPatchInput = {
  enabled?: boolean;
  allow_sign_up?: boolean;
  expires_in_minutes?: number;
};

export function buildMagicLinkPatch(
  v: MagicLinkPatchInput,
): NeonAuthMagicLinkConfigUpdate {
  const patch: NeonAuthMagicLinkConfigUpdate = {};
  if (v.enabled !== undefined) patch.enabled = v.enabled;
  if (v.allow_sign_up !== undefined) patch.disable_sign_up = !v.allow_sign_up;
  if (v.expires_in_minutes !== undefined)
    patch.expires_in = v.expires_in_minutes;
  return patch;
}

type PhoneNumberPatchInput = {
  enabled?: boolean;
  otp_expires_in_seconds?: number;
};

export function buildPhoneNumberPatch(
  v: PhoneNumberPatchInput,
): NeonAuthPhoneNumberConfigUpdate {
  const patch: NeonAuthPhoneNumberConfigUpdate = {};
  if (v.enabled !== undefined) patch.enabled = v.enabled;
  if (v.otp_expires_in_seconds !== undefined) {
    patch.otp_expires_in = v.otp_expires_in_seconds;
  }
  return patch;
}

type OrganizationPatchInput = {
  enabled?: boolean;
  organization_limit?: number;
  membership_limit?: number;
  creator_role?: 'admin' | 'owner';
  send_invitation_email?: boolean;
};

export function buildOrganizationPatch(
  v: OrganizationPatchInput,
): NeonAuthOrganizationConfigUpdate {
  const patch: NeonAuthOrganizationConfigUpdate = {};
  if (v.enabled !== undefined) patch.enabled = v.enabled;
  if (v.organization_limit !== undefined)
    patch.organization_limit = v.organization_limit;
  if (v.membership_limit !== undefined)
    patch.membership_limit = v.membership_limit;
  if (v.creator_role !== undefined) patch.creator_role = v.creator_role;
  if (v.send_invitation_email !== undefined) {
    patch.send_invitation_email = v.send_invitation_email;
  }
  return patch;
}

/**
 * Refuse to disable the last enabled sign-in method. We count "enabled
 * ⇒ false" requests across email_password / magic_link / phone_number;
 * if the resulting state would leave zero enabled methods, callers must
 * pass `confirm_dangerous_change: true` to acknowledge they're locking
 * users out.
 */
async function assertNotDisablingLastMethod(
  neonClient: Api<unknown>,
  projectId: string,
  branchId: string,
  intended: {
    email_password?: boolean;
    magic_link?: boolean;
    phone_number?: boolean;
  },
  confirmed: boolean,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  // Only check when at least one method is being explicitly disabled. Enabling
  // can never trigger a lockout.
  const disabling = Object.values(intended).some((v) => v === false);
  if (!disabling) return { ok: true };
  if (confirmed) return { ok: true };

  const [emailRes, pluginsRes] = await Promise.all([
    neonClient.getNeonAuthEmailAndPasswordConfig(projectId, branchId),
    neonClient.getNeonAuthPluginConfigs(projectId, branchId),
  ]);

  const current = {
    email_password: emailRes.status === 200 ? emailRes.data.enabled : true,
    magic_link:
      pluginsRes.status === 200
        ? (pluginsRes.data.magic_link?.enabled ?? false)
        : false,
    phone_number:
      pluginsRes.status === 200
        ? (pluginsRes.data.phone_number?.enabled ?? false)
        : false,
  };
  const after = {
    email_password:
      intended.email_password !== undefined
        ? intended.email_password
        : current.email_password,
    magic_link:
      intended.magic_link !== undefined
        ? intended.magic_link
        : current.magic_link,
    phone_number:
      intended.phone_number !== undefined
        ? intended.phone_number
        : current.phone_number,
  };
  const enabledCount = Object.values(after).filter(Boolean).length;
  if (enabledCount === 0) {
    return {
      ok: false,
      reason:
        'Refusing to disable the last enabled sign-in method (would lock all users out). ' +
        'Set confirm_dangerous_change: true to override.',
    };
  }
  return { ok: true };
}

/**
 * Runtime SSRF guard for outbound webhook URL. The schema-layer guard rejects
 * literal private IPs and the localhost/cloud-metadata blocklist, but a public
 * hostname can still resolve to a private IP at request time (DNS rebinding).
 * We resolve A + AAAA before letting Neon Auth save the URL.
 */
async function assertWebhookUrlNotPrivate(
  url: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return { ok: false, reason: 'webhook_url is not a valid URL' };
  }
  // Literal-IP case is already covered by the schema, but re-running it here
  // means the runtime guard is correct in isolation (defence in depth).
  if (isPrivateHostname(host)) {
    return {
      ok: false,
      reason: `webhook_url host "${host}" is private/link-local/localhost`,
    };
  }
  let addrs: { address: string; family: number }[];
  try {
    addrs = await dns.lookup(host, { all: true });
  } catch (err) {
    return {
      ok: false,
      reason: `Could not resolve webhook_url host "${host}" via DNS: ${(err as Error).message}`,
    };
  }
  for (const { address } of addrs) {
    if (isPrivateHostname(address)) {
      return {
        ok: false,
        reason: `webhook_url host "${host}" resolves to private address ${address}`,
      };
    }
  }
  return { ok: true };
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
      let applied = false;
      if (emailPassword) {
        const guard = await assertNotDisablingLastMethod(
          neonClient,
          props.projectId,
          branchId,
          { email_password: emailPassword.enabled },
          props.confirm_dangerous_change === true,
        );
        if (!guard.ok) {
          return {
            isError: true,
            content: [{ type: 'text', text: guard.reason }],
          };
        }
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
    case 'update_plugin': {
      const plugin = props.plugin!;
      const patchInput = props.plugin_patch as Record<string, unknown>;

      // For `enabled: false` on a plugin that's an active sign-in method,
      // run the lockout guard. (Organization is not a sign-in method, skip.)
      if (
        (plugin === 'magic_link' || plugin === 'phone_number') &&
        patchInput.enabled === false
      ) {
        const intended =
          plugin === 'magic_link'
            ? { magic_link: false }
            : { phone_number: false };
        const guard = await assertNotDisablingLastMethod(
          neonClient,
          props.projectId,
          branchId,
          intended,
          props.confirm_dangerous_change === true,
        );
        if (!guard.ok) {
          return {
            isError: true,
            content: [{ type: 'text', text: guard.reason }],
          };
        }
      }

      if (plugin === 'magic_link') {
        const patch = buildMagicLinkPatch(patchInput);
        const res = await neonClient.updateNeonAuthMagicLinkPlugin(
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
                text: `Failed to update magic_link plugin (${res.status} ${res.statusText}).`,
              },
            ],
          };
        }
      } else if (plugin === 'phone_number') {
        const patch = buildPhoneNumberPatch(patchInput);
        const res = await neonClient.updateNeonAuthPhoneNumberPlugin(
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
                text: `Failed to update phone_number plugin (${res.status} ${res.statusText}).`,
              },
            ],
          };
        }
      } else {
        const patch = buildOrganizationPatch(patchInput);
        const res = await neonClient.updateNeonAuthOrganizationPlugin(
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
                text: `Failed to update organization plugin (${res.status} ${res.statusText}).`,
              },
            ],
          };
        }
      }
      return snapshotMessage(
        neonClient,
        props.projectId,
        branchId,
        `Updated ${plugin} plugin for this branch.`,
      );
    }
    case 'update_webhook_config': {
      const webhook = props.webhook!;
      // Singleton merge: load current, splice patch fields in, write the
      // whole record back. Without the merge, the API's PUT semantics would
      // clobber unspecified fields.
      const current = await neonClient.getNeonAuthWebhookConfig(
        props.projectId,
        branchId,
      );
      const base: NeonAuthWebhookConfig =
        current.status === 200 && current.data
          ? current.data
          : { enabled: false };
      if (current.status !== 200 && current.status !== 404) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Failed to load current webhook config (${current.status} ${current.statusText}).`,
            },
          ],
        };
      }

      if (webhook.webhook_url !== undefined) {
        const guard = await assertWebhookUrlNotPrivate(webhook.webhook_url);
        if (!guard.ok) {
          return {
            isError: true,
            content: [{ type: 'text', text: guard.reason }],
          };
        }
      }

      const merged: NeonAuthWebhookConfig = {
        enabled: webhook.enabled !== undefined ? webhook.enabled : base.enabled,
        webhook_url:
          webhook.webhook_url !== undefined
            ? webhook.webhook_url
            : base.webhook_url,
        enabled_events:
          webhook.enabled_events !== undefined
            ? (webhook.enabled_events as NeonAuthWebhookConfig['enabled_events'])
            : base.enabled_events,
        timeout_seconds:
          webhook.timeout_seconds !== undefined
            ? webhook.timeout_seconds
            : base.timeout_seconds,
      };

      const res = await neonClient.updateNeonAuthWebhookConfig(
        props.projectId,
        branchId,
        merged,
      );
      if (res.status !== 200) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Failed to update webhook config (${res.status} ${res.statusText}).`,
            },
          ],
        };
      }
      return snapshotMessage(
        neonClient,
        props.projectId,
        branchId,
        'Updated webhook configuration for this branch (webhook_url is intentionally redacted in the snapshot — see webhook_url_set).',
      );
    }
  }
}
