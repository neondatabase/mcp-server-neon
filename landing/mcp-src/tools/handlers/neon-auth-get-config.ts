import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Api, NeonAuthOauthProvider } from '@neondatabase/api-client';
import { getNeonAuthConfigInputSchema } from '../toolsSchema';
import { z } from 'zod/v3';
import { resolveNeonAuthBranchId } from './neon-auth-config';
import { ToolHandlerExtraParams } from '../types';

type Props = z.infer<typeof getNeonAuthConfigInputSchema>;

function summarizeOauthProviders(providers: NeonAuthOauthProvider[]) {
  return providers.map((p) => ({
    id: p.id,
    type: p.type,
    client_id: p.client_id ?? null,
    client_secret_configured: Boolean(p.client_secret),
  }));
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
              ? 'Neon Auth is not provisioned for this branch (HTTP 404). Use provision_neon_auth first.'
              : `Failed to load Neon Auth integration (${integrationRes.status} ${integrationRes.statusText}).`,
        },
      ],
    };
  }

  const [domainsRes, localhostRes, emailRes, oauthRes] = await Promise.all([
    neonClient.listBranchNeonAuthTrustedDomains(projectId, resolvedBranchId),
    neonClient.getNeonAuthAllowLocalhost(projectId, resolvedBranchId),
    neonClient.getNeonAuthEmailAndPasswordConfig(projectId, resolvedBranchId),
    neonClient.listBranchNeonAuthOauthProviders(projectId, resolvedBranchId),
  ]);

  const integration = integrationRes.data;
  const payload = {
    integration: {
      auth_provider: integration.auth_provider,
      branch_id: integration.branch_id,
      db_name: integration.db_name,
      created_at: integration.created_at,
      owned_by: integration.owned_by,
      transfer_status: integration.transfer_status,
      jwks_url: integration.jwks_url,
      base_url: integration.base_url,
      auth_provider_project_id: integration.auth_provider_project_id,
    },
    allow_localhost:
      localhostRes.status === 200 ? localhostRes.data.allow_localhost : null,
    allow_localhost_error:
      localhostRes.status !== 200
        ? `${localhostRes.status} ${localhostRes.statusText}`
        : undefined,
    trusted_redirect_uris:
      domainsRes.status === 200
        ? domainsRes.data.domains.map((d) => d.domain)
        : [],
    trusted_redirect_uris_error:
      domainsRes.status !== 200
        ? `${domainsRes.status} ${domainsRes.statusText}`
        : undefined,
    email_and_password: emailRes.status === 200 ? emailRes.data : null,
    email_and_password_error:
      emailRes.status !== 200
        ? `${emailRes.status} ${emailRes.statusText}`
        : undefined,
    oauth_providers:
      oauthRes.status === 200
        ? summarizeOauthProviders(oauthRes.data.providers)
        : [],
    oauth_providers_error:
      oauthRes.status !== 200
        ? `${oauthRes.status} ${oauthRes.statusText}`
        : undefined,
  };

  return {
    content: [
      {
        type: 'text',
        text: `Neon Auth configuration:\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``,
      },
    ],
  };
}
