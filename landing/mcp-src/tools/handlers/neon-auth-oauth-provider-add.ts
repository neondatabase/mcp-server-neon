import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  Api,
  NeonAuthAddOAuthProviderRequest,
  NeonAuthOauthProviderId,
} from '@neondatabase/api-client';
import { z } from 'zod/v3';
import { neonAuthOauthProviderAddInputSchema } from '../toolsSchema';
import { ToolHandlerExtraParams } from '../types';
import { resolveNeonAuthBranchId } from './neon-auth-utils';

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
  return {
    content: [
      {
        type: 'text',
        text: `OAuth provider ${props.provider_id} added (or re-added) on branch ${branchId}.`,
      },
    ],
  };
}
