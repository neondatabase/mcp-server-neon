import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { neonClient } from '../index.js';
import { IdentitySupportedAuthProvider } from '@neondatabase/api-client';

export async function handleProvisionNeonAuth({
  projectId,
}: {
  projectId: string;
}): Promise<CallToolResult> {
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
  const {
    data: { databases },
  } = await neonClient.listProjectBranchDatabases(projectId, defaultBranch.id);
  const defaultDatabase =
    databases.find((database) => database.name === 'neondb') ?? databases[0];
  if (!defaultDatabase) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: 'The project has no database. Neon Auth can only be provisioned with a database.',
        },
      ],
    };
  }

  const response = await neonClient.createProjectIdentityIntegration({
    auth_provider: IdentitySupportedAuthProvider.Stack,
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
        <code>
          NEXT_PUBLIC_STACK_PROJECT_ID='${response.data.auth_provider_project_id}'
          NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY='${response.data.pub_client_key}'
          STACK_SECRET_SERVER_KEY='${response.data.secret_server_key}'
        </code>

        Copy the above environment variables and place them in  your <code>.env.local</code> file for Next.js project. Note that variables with <code>NEXT_PUBLIC_</code> prefix will be available in the client side.
        `,
      },
      {
        type: 'text',
        text: `
        Use Following JWKS URL to retrieve the public key to verify the JSON Web Tokens (JWT) issued by authentication provider:
        <code title="jwks_url" language="bash">${response.data.jwks_url}</code>
        `,
      },
    ],
  };
}
