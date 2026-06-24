import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  Api,
  NeonAuthAddOAuthProviderRequest,
  NeonAuthOauthProviderId,
} from '@neondatabase/api-client';
import { z } from 'zod/v3';
import { neonAuthOauthProviderAddInputSchema } from '../toolsSchema';
import { ToolHandlerExtraParams } from '../types';
import {
  ensureNeonAuthProvisioned,
  resolveNeonAuthBranchId,
} from './neon-auth-utils';
import {
  fetchOAuthProvidersSlice,
  stringifyOAuthProvidersSlice,
} from './neon-auth-settings-snapshot';

type Props = z.infer<typeof neonAuthOauthProviderAddInputSchema>;

export async function handleNeonAuthOauthProviderAdd(
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
  const body: NeonAuthAddOAuthProviderRequest = {
    id: props.provider_id as NeonAuthOauthProviderId,
  };
  if (cfg?.client_id !== undefined) body.client_id = cfg.client_id;
  if (cfg?.client_secret !== undefined) body.client_secret = cfg.client_secret;

  const res = await neonClient.addBranchNeonAuthOauthProvider(
    props.projectId,
    branchId,
    body,
  );
  // 201 on first add, 200 on idempotent re-add.
  if (res.status !== 201 && res.status !== 200) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `Failed to add OAuth provider ${props.provider_id} (${res.status} ${res.statusText}). Ensure Neon Auth is provisioned for this branch and credentials are valid.`,
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
          `OAuth providers after add on branch ${branchId}:`,
          providers,
          error,
        ),
      },
    ],
  };
}
