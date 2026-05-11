import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  Api,
  NeonAuthEmailAndPasswordConfigUpdate,
  NeonAuthSupportedAuthProvider,
} from '@neondatabase/api-client';
import { configureNeonAuthInputSchema } from '../toolsSchema';
import { z } from 'zod/v3';
import { getDefaultBranch } from './utils';
import {
  fetchNeonAuthConfigurableSettings,
  stringifyNeonAuthConfigurableSettings,
} from './neon-auth-settings-snapshot';
import { ToolHandlerExtraParams } from '../types';

type Props = z.infer<typeof configureNeonAuthInputSchema>;

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
    case 'add_redirect_uri': {
      const res = await neonClient.addBranchNeonAuthTrustedDomain(
        props.projectId,
        branchId,
        {
          domain: props.redirect_uri!,
          auth_provider: NeonAuthSupportedAuthProvider.BetterAuth,
        },
      );
      if (res.status !== 201) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Failed to add redirect URI (${res.status} ${res.statusText}). Ensure Neon Auth is provisioned for this branch and the URI is valid.`,
            },
          ],
        };
      }
      const { settings, errors } = await fetchNeonAuthConfigurableSettings(
        neonClient,
        props.projectId,
        branchId,
      );
      return {
        content: [
          {
            type: 'text',
            text: [
              `Added trusted redirect URI: ${props.redirect_uri}`,
              '',
              stringifyNeonAuthConfigurableSettings(
                'Current Neon Auth settings (same fields as get_neon_auth_config):',
                settings,
                errors,
              ),
            ].join('\n'),
          },
        ],
      };
    }
    case 'remove_redirect_uri': {
      const res = await neonClient.deleteBranchNeonAuthTrustedDomain(
        props.projectId,
        branchId,
        {
          auth_provider: NeonAuthSupportedAuthProvider.BetterAuth,
          domains: [{ domain: props.redirect_uri! }],
        },
      );
      if (res.status !== 200) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Failed to remove redirect URI (${res.status} ${res.statusText}). Ensure the URI exists in the allowlist.`,
            },
          ],
        };
      }
      const { settings, errors } = await fetchNeonAuthConfigurableSettings(
        neonClient,
        props.projectId,
        branchId,
      );
      return {
        content: [
          {
            type: 'text',
            text: [
              `Removed trusted redirect URI: ${props.redirect_uri}`,
              '',
              stringifyNeonAuthConfigurableSettings(
                'Current Neon Auth settings (same fields as get_neon_auth_config):',
                settings,
                errors,
              ),
            ].join('\n'),
          },
        ],
      };
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
      const { settings, errors } = await fetchNeonAuthConfigurableSettings(
        neonClient,
        props.projectId,
        branchId,
      );
      return {
        content: [
          {
            type: 'text',
            text: [
              `allow_localhost is now ${res.data.allow_localhost ? 'enabled' : 'disabled'} for this branch.`,
              '',
              stringifyNeonAuthConfigurableSettings(
                'Current Neon Auth settings (same fields as get_neon_auth_config):',
                settings,
                errors,
              ),
            ].join('\n'),
          },
        ],
      };
    }
    case 'update_email_auth_settings': {
      const patch: NeonAuthEmailAndPasswordConfigUpdate = {};
      if (props.sign_in_with_email !== undefined) {
        patch.enabled = props.sign_in_with_email;
      }
      if (props.verify_email_on_sign_up !== undefined) {
        patch.send_verification_email_on_sign_up =
          props.verify_email_on_sign_up;
      }
      if (props.allow_sign_up_with_email !== undefined) {
        patch.disable_sign_up = !props.allow_sign_up_with_email;
      }
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
              text: `Failed to update email auth settings (${res.status} ${res.statusText}).`,
            },
          ],
        };
      }
      const { settings, errors } = await fetchNeonAuthConfigurableSettings(
        neonClient,
        props.projectId,
        branchId,
      );
      return {
        content: [
          {
            type: 'text',
            text: [
              'Updated email and password auth settings for this branch.',
              '',
              stringifyNeonAuthConfigurableSettings(
                'Current Neon Auth settings (same fields as get_neon_auth_config):',
                settings,
                errors,
              ),
            ].join('\n'),
          },
        ],
      };
    }
  }
}
