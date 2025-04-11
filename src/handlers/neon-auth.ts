import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { neonClient } from '../index.js';
import { NeonAuthSupportedAuthProvider } from '@neondatabase/api-client';
import { provisionNeonAuthInputSchema } from '../toolsSchema.js';
import { z } from 'zod';
import { getDefaultDatabase } from '../utils.js';

type Props = z.infer<typeof provisionNeonAuthInputSchema>;
export async function handleProvisionNeonAuth({
  projectId,
  database,
}: Props): Promise<CallToolResult> {
  const {
    data: { branches },
  } = await neonClient.listProjectBranches({
    projectId,
  });
  const defaultBranch =
    branches.find((branch) => branch.default) ?? branches[0];
  if (!defaultBranch) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: 'The project has no default branch. Neon Auth can only be provisioned with a default branch.',
        },
      ],
    };
  }
  const databaseName = await getDefaultDatabase({
    projectId,
    branchId: defaultBranch.id,
    databaseName: database,
  });

  const { data } = await neonClient.getProjectBranchDatabase(
    projectId,
    defaultBranch.id,
    databaseName,
  );

  const defaultDatabase = data.database;

  if (!defaultDatabase) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `The project has no database named '${database}'.`,
        },
      ],
    };
  }

  const response = await neonClient.createNeonAuthIntegration({
    auth_provider: NeonAuthSupportedAuthProvider.Stack,
    project_id: projectId,
    branch_id: defaultBranch.id,
    database_name: defaultDatabase.name,
    role_name: defaultDatabase.owner_name,
  });

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
        text: `Authentication has been successfully provisioned for your Neon project. Following are the environment variables you need to set in your project:
        \`\`\`
          NEXT_PUBLIC_STACK_PROJECT_ID='${response.data.auth_provider_project_id}'
          NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY='${response.data.pub_client_key}'
          STACK_SECRET_SERVER_KEY='${response.data.secret_server_key}'
        \`\`\`

        Copy the above environment variables and place them in  your \`.env.local\` file for Next.js project. Note that variables with \`NEXT_PUBLIC_\` prefix will be available in the client side.
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
