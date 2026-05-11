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
  }
}
