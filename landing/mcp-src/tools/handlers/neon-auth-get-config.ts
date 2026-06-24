import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Api, NeonAuthIntegration } from '@neondatabase/api-client';
import { getNeonAuthConfigInputSchema } from '../toolsSchema';
import { z } from 'zod/v3';
import {
  NEON_AUTH_NOT_PROVISIONED_MESSAGE,
  resolveNeonAuthBranchId,
} from './neon-auth-config';
import { fetchNeonAuthConfigurableSettings } from './neon-auth-settings-snapshot';
import { ToolHandlerExtraParams } from '../types';

type Props = z.infer<typeof getNeonAuthConfigInputSchema>;

function integrationPayload(int: NeonAuthIntegration) {
  const payload: Record<string, unknown> = {
    auth_provider: int.auth_provider,
    auth_provider_project_id: int.auth_provider_project_id,
    branch_id: int.branch_id,
    db_name: int.db_name,
    created_at: int.created_at,
    owned_by: int.owned_by,
    jwks_url: int.jwks_url,
    base_url: int.base_url,
  };
  if (int.transfer_status !== undefined) {
    payload.transfer_status = int.transfer_status;
  }
  return payload;
}

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
              ? NEON_AUTH_NOT_PROVISIONED_MESSAGE
              : `Failed to load Neon Auth integration (${integrationRes.status} ${integrationRes.statusText}).`,
        },
      ],
    };
  }

  const [{ settings, errors }, branchRes] = await Promise.all([
    fetchNeonAuthConfigurableSettings(neonClient, projectId, resolvedBranchId),
    neonClient.getProjectBranch(projectId, resolvedBranchId),
  ]);

  const integration = integrationRes.data;
  const branch_name =
    branchRes.status === 200 ? branchRes.data.branch.name : null;

  const body: Record<string, unknown> = {
    project_id: projectId,
    branch_id: resolvedBranchId,
    branch_name,
    base_url: integration.base_url ?? null,
    jwks_url: integration.jwks_url,
    db_name: integration.db_name,
    integration: integrationPayload(integration),
    ...settings,
  };
  if (Object.keys(errors).length > 0) {
    body._errors = errors;
  }

  return {
    content: [
      {
        type: 'text',
        text: `Neon Auth configuration:\n\`\`\`json\n${JSON.stringify(body, null, 2)}\n\`\`\``,
      },
    ],
  };
}
