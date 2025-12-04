import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Api, NeonAuthSupportedAuthProvider } from '@neondatabase/api-client';
import { provisionNeonAuthInputSchema } from '../toolsSchema.js';
import { z } from 'zod';
import { getDefaultDatabase } from '../utils.js';
import { getDefaultBranch } from './utils.js';
import { ToolHandlerExtraParams } from '../types.js';

type Props = z.infer<typeof provisionNeonAuthInputSchema>;
export async function handleProvisionNeonAuth(
  { projectId, branchId, databaseName }: Props,
  neonClient: Api<unknown>,
  _extra: ToolHandlerExtraParams,
): Promise<CallToolResult> {
  // If branchId is not provided, use the default branch
  let resolvedBranchId = branchId;
  if (!resolvedBranchId) {
    const defaultBranch = await getDefaultBranch(projectId, neonClient);
    resolvedBranchId = defaultBranch.id;
  }

  const defaultDatabase = await getDefaultDatabase(
    {
      projectId,
      branchId: resolvedBranchId,
      databaseName,
    },
    neonClient,
  );

  if (!defaultDatabase) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: databaseName
            ? `The branch has no database named '${databaseName}'.`
            : 'The branch has no databases.',
        },
      ],
    };
  }

  const response = await neonClient.createNeonAuth(
    projectId,
    resolvedBranchId,
    {
      auth_provider: NeonAuthSupportedAuthProvider.BetterAuth,
      database_name: defaultDatabase.name,
    },
  );

  // In case of 409, it means that the integration already exists
  // We should not return an error, but a message that the integration already exists and fetch the existing integration
  if (response.status === 409) {
    return {
      content: [
        {
          type: 'text',
          text: 'Neon Auth already provisioned.',
        },
      ],
    };
  }

  if (response.status !== 201) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `Failed to provision Neon Auth. Error: ${response.statusText}`,
        },
      ],
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: `Authentication has been successfully provisioned for your Neon project and branch. 
           \`\`\`
        Use this URL to access the Neon Auth through your better auth compatible client: ${response.data.base_url}
            \`\`\`
        `,
      },
      {
        type: 'text',
        text: `
        Use Following JWKS URL to retrieve the public key to verify the JSON Web Tokens (JWT) issued by authentication provider:
        \`\`\`
        ${response.data.jwks_url}
        \`\`\`
        `,
      },
    ],
  };
}
