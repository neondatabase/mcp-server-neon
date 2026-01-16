import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Api } from '@neondatabase/api-client';
import { provisionNeonDataApiInputSchema } from '../toolsSchema';
import { z } from 'zod';
import { getDefaultDatabase } from '../utils';
import { getDefaultBranch } from './utils';
import { ToolHandlerExtraParams } from '../types';
import { logger } from '../../utils/logger';

type Props = z.infer<typeof provisionNeonDataApiInputSchema>;

export async function handleProvisionNeonDataApi(
  {
    projectId,
    branchId,
    databaseName,
    authProvider,
    jwksUrl,
    providerName,
    jwtAudience,
  }: Props,
  neonClient: Api<unknown>,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _extra: ToolHandlerExtraParams
): Promise<CallToolResult> {
  // If branchId is not provided, use the default branch
  let resolvedBranchId = branchId;
  if (!resolvedBranchId) {
    const defaultBranch = await getDefaultBranch(projectId, neonClient);
    resolvedBranchId = defaultBranch.id;
  }

  // Resolve the database name
  const defaultDatabase = await getDefaultDatabase(
    {
      projectId,
      branchId: resolvedBranchId,
      databaseName,
    },
    neonClient
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

  // Build the request payload - only include fields that are provided
  const requestPayload: {
    auth_provider?: 'neon_auth' | 'external';
    jwks_url?: string;
    provider_name?: string;
    jwt_audience?: string;
  } = {};

  if (authProvider) {
    requestPayload.auth_provider = authProvider;
  }
  if (jwksUrl) {
    requestPayload.jwks_url = jwksUrl;
  }
  if (providerName) {
    requestPayload.provider_name = providerName;
  }
  if (jwtAudience) {
    requestPayload.jwt_audience = jwtAudience;
  }

  const response = await neonClient.createProjectBranchDataApi(
    projectId,
    resolvedBranchId,
    defaultDatabase.name,
    requestPayload
  );

  // Handle 409 - Data API already exists
  if (response.status === 409) {
    // Try to get the existing Data API info
    try {
      const existingResponse = await neonClient.getProjectBranchDataApi(
        projectId,
        resolvedBranchId,
        defaultDatabase.name
      );
      return {
        content: [
          {
            type: 'text',
            text: `Data API already provisioned for this database.

Use this URL to access your Neon Data API:
\`\`\`
${existingResponse.data.url}
\`\`\`

Status: ${existingResponse.data.status}`,
          },
        ],
      };
    } catch {
      return {
        content: [
          {
            type: 'text',
            text: 'Data API already provisioned for this database.',
          },
        ],
      };
    }
  }

  if (response.status !== 201) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `Failed to provision Data API. Error: ${response.statusText}`,
        },
      ],
    };
  }

  // Build success message based on configuration
  const authMessage = authProvider
    ? authProvider === 'neon_auth'
      ? 'Authentication is configured to use Neon Auth. JWTs from your Neon Auth setup will be validated automatically.'
      : `Authentication is configured to use external provider${
          providerName ? ` (${providerName})` : ''
        }. JWTs will be validated against the provided JWKS URL.`
    : 'No authentication is configured. The Data API will allow unauthenticated access.';

  return {
    content: [
      {
        type: 'text',
        text: `Data API has been successfully provisioned for your Neon database.

Use this URL to access your Neon Data API:
\`\`\`
${response.data.url}
\`\`\`

${authMessage}

**Example Request:**
\`\`\`bash
curl "${response.data.url}/your_table" \\
  -H "Authorization: Bearer <your-jwt-token>"
\`\`\`
`,
      },
    ],
  };
}
