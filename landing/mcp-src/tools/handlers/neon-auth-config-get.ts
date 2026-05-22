import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Api, NeonAuthIntegration } from '@neondatabase/api-client';
import { z } from 'zod/v3';
import { neonAuthConfigGetInputSchema } from '../toolsSchema';
import { ToolHandlerExtraParams } from '../types';
import { resolveNeonAuthBranchId } from './neon-auth-utils';
import {
  fetchNeonAuthConfigurableSettings,
  stringifyNeonAuthConfigurableSettings,
} from './neon-auth-settings-snapshot';

type Props = z.infer<typeof neonAuthConfigGetInputSchema>;

function integrationPayload(integration: NeonAuthIntegration) {
  const payload: Record<string, unknown> = {
    auth_provider: integration.auth_provider,
    auth_provider_project_id: integration.auth_provider_project_id,
    branch_id: integration.branch_id,
    db_name: integration.db_name,
    created_at: integration.created_at,
    owned_by: integration.owned_by,
    jwks_url: integration.jwks_url,
    base_url: integration.base_url,
  };
  if (integration.transfer_status !== undefined) {
    payload.transfer_status = integration.transfer_status;
  }
  return payload;
}

export async function handleNeonAuthConfigGet(
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
              ? 'Neon Auth is not provisioned for this branch (HTTP 404). Before calling neon_auth_provision, ask the user for explicit approval.'
              : `Failed to load Neon Auth integration (${integrationRes.status} ${integrationRes.statusText}).`,
        },
      ],
    };
  }

  const [{ settings, errors }, branchRes] = await Promise.all([
    fetchNeonAuthConfigurableSettings(neonClient, projectId, resolvedBranchId),
    neonClient.getProjectBranch(projectId, resolvedBranchId),
  ]);

  const branch_name =
    branchRes.status === 200 ? branchRes.data.branch.name : null;
  const integration = integrationRes.data;
  const body = {
    project_id: projectId,
    branch_id: resolvedBranchId,
    branch_name,
    base_url: integration.base_url ?? null,
    jwks_url: integration.jwks_url,
    db_name: integration.db_name,
    integration: integrationPayload(integration),
    ...settings,
  };

  return {
    content: [
      {
        type: 'text',
        text: stringifyNeonAuthConfigurableSettings(
          'Neon Auth configuration:',
          body,
          errors,
        ),
      },
    ],
  };
}
