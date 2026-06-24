import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  Api,
  NeonAuthOauthProviderId,
  NeonAuthUpdateOAuthProviderRequest,
} from '@neondatabase/api-client';
import { z } from 'zod/v3';
import { neonAuthOauthProviderUpdateInputSchema } from '../toolsSchema';
import { ToolHandlerExtraParams } from '../types';
import {
  ensureNeonAuthProvisioned,
  resolveNeonAuthBranchId,
} from './neon-auth-utils';
import {
  fetchOAuthProvidersSlice,
  stringifyOAuthProvidersSlice,
} from './neon-auth-settings-snapshot';

type Props = z.infer<typeof neonAuthOauthProviderUpdateInputSchema>;

export async function handleNeonAuthOauthProviderUpdate(
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
  const preflight = await ensureNeonAuthProvisioned(
    neonClient,
    props.projectId,
    branchId,
  );
  if (preflight) return preflight;

  const cfg = props.oauth_provider_config;
  const body: NeonAuthUpdateOAuthProviderRequest = {};
  if (cfg.client_id !== undefined) body.client_id = cfg.client_id;
  if (cfg.client_secret !== undefined) body.client_secret = cfg.client_secret;

  const res = await neonClient.updateBranchNeonAuthOauthProvider(
    props.projectId,
    branchId,
    props.provider_id as NeonAuthOauthProviderId,
    body,
  );
  if (res.status !== 200 && res.status !== 204) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `Failed to update OAuth provider ${props.provider_id} (${res.status} ${res.statusText}). Ensure the provider is currently configured on this branch.`,
        },
      ],
    };
  }
  const { providers, error } = await fetchOAuthProvidersSlice(
    neonClient,
    props.projectId,
    branchId,
  );
  return {
    content: [
      {
        type: 'text',
        text: stringifyOAuthProvidersSlice(
          `OAuth providers after update on branch ${branchId}:`,
          providers,
          error,
        ),
      },
    ],
  };
}
