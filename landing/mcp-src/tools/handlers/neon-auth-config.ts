import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  Api,
  NeonAuthEmailAndPasswordConfigUpdate,
  NeonAuthEmailVerificationMethod,
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
    patch.email_verification_method =
      email.email_verification_method === 'otp'
        ? NeonAuthEmailVerificationMethod.Otp
        : NeonAuthEmailVerificationMethod.Link;
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
      return snapshotMessage(
        neonClient,
        props.projectId,
        branchId,
        `Added trusted origin: ${props.trusted_origin}`,
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
        `Removed trusted origin: ${props.trusted_origin}`,
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
      // least one field. As we add more methods (magic_link, etc.), extend
      // this branch with their corresponding API calls.
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
      }
      return snapshotMessage(
        neonClient,
        props.projectId,
        branchId,
        'Updated auth methods for this branch.',
      );
    }
  }
}
