import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Api, NeonAuthOauthProviderId } from '@neondatabase/api-client';
import { z } from 'zod/v3';
import { neonAuthOauthProviderDeleteInputSchema } from '../toolsSchema';
import { ToolHandlerExtraParams } from '../types';
import { resolveNeonAuthBranchId } from './neon-auth-utils';

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
  return {
    content: [
      {
        type: 'text',
        text: `OAuth provider ${props.provider_id} deleted from branch ${branchId}.`,
      },
    ],
  };
}
