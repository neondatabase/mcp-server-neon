import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  Api,
  NeonAuthOauthProviderId,
  NeonAuthUpdateOAuthProviderRequest,
} from '@neondatabase/api-client';
import { z } from 'zod/v3';
import { neonAuthOauthProviderUpdateInputSchema } from '../toolsSchema';
import { ToolHandlerExtraParams } from '../types';
import { resolveNeonAuthBranchId } from './neon-auth-utils';

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
  return {
    content: [
      {
        type: 'text',
        text: `OAuth provider ${props.provider_id} credentials updated on branch ${branchId}.`,
      },
    ],
  };
}
