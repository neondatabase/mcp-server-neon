import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Api } from '@neondatabase/api-client';
import { getNeonAuthConfigInputSchema } from '../toolsSchema';
import { z } from 'zod/v3';
import { resolveNeonAuthBranchId } from './neon-auth-config';
import {
  fetchNeonAuthConfigurableSettings,
  stringifyNeonAuthConfigurableSettings,
} from './neon-auth-settings-snapshot';
import { ToolHandlerExtraParams } from '../types';

type Props = z.infer<typeof getNeonAuthConfigInputSchema>;

export async function handleGetNeonAuthConfig(
  { projectId, branchId }: Props,
  neonClient: Api<unknown>,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _extra: ToolHandlerExtraParams,
): Promise<CallToolResult> {
  const resolvedBranchId = await resolveNeonAuthBranchId(
    projectId,
    branchId,
    neonClient,
  );

  const integrationRes = await neonClient.getNeonAuth(
    projectId,
    resolvedBranchId,
  );
  if (integrationRes.status !== 200) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text:
            integrationRes.status === 404
              ? 'Neon Auth is not provisioned for this branch (HTTP 404). Use provision_neon_auth first.'
              : `Failed to load Neon Auth integration (${integrationRes.status} ${integrationRes.statusText}).`,
        },
      ],
    };
  }

  const { settings, errors } = await fetchNeonAuthConfigurableSettings(
    neonClient,
    projectId,
    resolvedBranchId,
  );

  return {
    content: [
      {
        type: 'text',
        text: stringifyNeonAuthConfigurableSettings(
          'Neon Auth settings (same fields as configure_neon_auth):',
          settings,
          errors,
        ),
      },
    ],
  };
}
