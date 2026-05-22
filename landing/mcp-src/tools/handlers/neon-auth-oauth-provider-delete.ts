import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Api, NeonAuthOauthProviderId } from '@neondatabase/api-client';
import { z } from 'zod/v3';
import { neonAuthOauthProviderDeleteInputSchema } from '../toolsSchema';
import { ToolHandlerExtraParams } from '../types';
import {
  ensureNeonAuthProvisioned,
  resolveNeonAuthBranchId,
} from './neon-auth-utils';
import {
  fetchOAuthProvidersSlice,
  stringifyOAuthProvidersSlice,
} from './neon-auth-settings-snapshot';

type Props = z.infer<typeof neonAuthOauthProviderDeleteInputSchema>;

export async function handleNeonAuthOauthProviderDelete(
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

  const res = await neonClient.deleteBranchNeonAuthOauthProvider(
    props.projectId,
    branchId,
    props.provider_id as NeonAuthOauthProviderId,
  );
  if (res.status !== 200 && res.status !== 204) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `Failed to delete OAuth provider ${props.provider_id} (${res.status} ${res.statusText}).`,
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
          `OAuth providers after delete on branch ${branchId}:`,
          providers,
          error,
        ),
      },
    ],
  };
}
