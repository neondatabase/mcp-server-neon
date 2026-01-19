import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Api, NeonAuthSupportedAuthProvider } from '@neondatabase/api-client';
import { provisionNeonDataApiInputSchema } from '../toolsSchema';
import { z } from 'zod';
import { getDefaultDatabase } from '../utils';
import { getDefaultBranch } from './utils';
import { ToolHandlerExtraParams } from '../types';

type Props = z.infer<typeof provisionNeonDataApiInputSchema>;

type NeonAuthStatus = {
  enabled: boolean;
  jwksUrl?: string;
  baseUrl?: string;
};

type DataApiStatus = {
  exists: boolean;
  url?: string;
  status?: string;
};

/**
 * Checks if Neon Auth is provisioned for the given project/branch
 */
async function checkNeonAuthStatus(
  projectId: string,
  branchId: string,
  neonClient: Api<unknown>
): Promise<NeonAuthStatus> {
  try {
    const response = await neonClient.getNeonAuth(projectId, branchId);
    if (response.status === 200) {
      return {
        enabled: true,
        jwksUrl: response.data.jwks_url,
        baseUrl: response.data.base_url,
      };
    }
    return { enabled: false };
  } catch {
    // 404 or other error = not provisioned
    return { enabled: false };
  }
}

/**
 * Checks if Data API is already provisioned for the given project/branch/database
 */
async function checkDataApiStatus(
  projectId: string,
  branchId: string,
  databaseName: string,
  neonClient: Api<unknown>
): Promise<DataApiStatus> {
  try {
    const response = await neonClient.getProjectBranchDataApi(
      projectId,
      branchId,
      databaseName
    );
    if (response.status === 200) {
      return {
        exists: true,
        url: response.data.url,
        status: response.data.status,
      };
    }
    return { exists: false };
  } catch {
    // 404 or other error = not provisioned
    return { exists: false };
  }
}

/**
 * Builds the auth options response when authProvider is not specified
 */
function buildAuthOptionsResponse(
  neonAuthStatus: NeonAuthStatus,
  dataApiStatus: DataApiStatus,
  projectId: string,
  branchId: string,
  databaseName: string
): string {
  // If Data API already exists, show existing info
  if (dataApiStatus.exists) {
    return `**Data API Already Provisioned**

The Data API is already set up for this database.

- **URL**: \`${dataApiStatus.url}\`
- **Status**: ${dataApiStatus.status}

To reconfigure authentication, you would need to delete and re-provision the Data API.`;
  }

  // Build the auth options message
  const neonAuthRecommendation = neonAuthStatus.enabled
    ? '(Recommended - already set up)'
    : '(Recommended)';

  const neonAuthDescription = neonAuthStatus.enabled
    ? `Uses your existing Neon Auth setup (JWKS: ${neonAuthStatus.jwksUrl})`
    : 'Enables Neon Auth with built-in user management (Better Auth)';

  const neonAuthUsage = neonAuthStatus.enabled
    ? `Call this tool with \`authProvider: "neon_auth"\``
    : `Call this tool with \`authProvider: "neon_auth", provisionNeonAuthFirst: true\``;

  return `**Authentication Required for Data API**

Before provisioning the Data API, please select an authentication method.

**Current Status:**
- **Neon Auth**: ${
    neonAuthStatus.enabled
      ? `Enabled (JWKS: ${neonAuthStatus.jwksUrl})`
      : 'Not provisioned'
  }
- **Data API**: Not provisioned

**Project ID**: ${projectId}
**Branch ID**: ${branchId}
**Database**: ${databaseName}

---

**Please select an authentication option:**

**1. neon_auth** ${neonAuthRecommendation}
   - ${neonAuthDescription}
   - JWTs validated automatically by Data API
   - **To use**: ${neonAuthUsage}

**2. external**
   - Use external auth provider (Clerk, Auth0, Stytch, etc.)
   - Requires your provider's JWKS URL
   - **To use**: Call this tool with \`authProvider: "external", jwksUrl: "<your-jwks-url>"\`

**3. none** ⚠️ (Not recommended)
   - Provisions Data API without a pre-configured JWKS
   - **Note**: You will need to configure a JWKS URL before the Data API can be used
   - **To use**: Call this tool with \`authProvider: "none"\``;
}

export async function handleProvisionNeonDataApi(
  {
    projectId,
    branchId,
    databaseName,
    authProvider,
    jwksUrl,
    providerName,
    jwtAudience,
    provisionNeonAuthFirst,
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

  // If authProvider is not specified, check existing config and return options
  if (!authProvider) {
    const [neonAuthStatus, dataApiStatus] = await Promise.all([
      checkNeonAuthStatus(projectId, resolvedBranchId, neonClient),
      checkDataApiStatus(
        projectId,
        resolvedBranchId,
        defaultDatabase.name,
        neonClient
      ),
    ]);

    return {
      content: [
        {
          type: 'text',
          text: buildAuthOptionsResponse(
            neonAuthStatus,
            dataApiStatus,
            projectId,
            resolvedBranchId,
            defaultDatabase.name
          ),
        },
      ],
    };
  }

  // Handle provisionNeonAuthFirst for neon_auth
  if (provisionNeonAuthFirst && authProvider === 'neon_auth') {
    // Check if Neon Auth is already provisioned
    const neonAuthStatus = await checkNeonAuthStatus(
      projectId,
      resolvedBranchId,
      neonClient
    );

    if (!neonAuthStatus.enabled) {
      // Provision Neon Auth first
      const neonAuthResponse = await neonClient.createNeonAuth(
        projectId,
        resolvedBranchId,
        {
          auth_provider: NeonAuthSupportedAuthProvider.BetterAuth,
          database_name: defaultDatabase.name,
        }
      );

      if (neonAuthResponse.status !== 201 && neonAuthResponse.status !== 409) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Failed to provision Neon Auth before Data API. Error: ${neonAuthResponse.statusText}`,
            },
          ],
        };
      }
    }
    // Continue to provision Data API with neon_auth...
  }

  // Handle authProvider: 'none' with strong warning
  if (authProvider === 'none') {
    const response = await neonClient.createProjectBranchDataApi(
      projectId,
      resolvedBranchId,
      defaultDatabase.name,
      {}
    );

    // Handle 409 - Data API already exists
    if (response.status === 409) {
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

    return {
      content: [
        {
          type: 'text',
          text: `Data API has been provisioned **without a pre-configured JWKS**.

Use this URL to access your Neon Data API:
\`\`\`
${response.data.url}
\`\`\`

⚠️ **Important**: To use the Data API, you still need to configure a JWKS (JSON Web Key Set) URL for JWT verification. Without a JWKS, the Data API cannot validate authentication tokens and requests will fail.

**Next steps:**
- Configure your JWKS URL through the Neon Console or API
- Or reconfigure using \`authProvider: "neon_auth"\` or \`authProvider: "external"\` for automatic JWKS setup

**Note**: Row Level Security (RLS) policies require authenticated requests to have user context.
`,
        },
      ],
    };
  }

  // Build the request payload for neon_auth or external
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
  let authMessage: string;
  if (authProvider === 'neon_auth') {
    authMessage = provisionNeonAuthFirst
      ? 'Neon Auth has been provisioned and configured as the authentication provider. JWTs from your Neon Auth setup will be validated automatically.'
      : 'Authentication is configured to use Neon Auth. JWTs from your Neon Auth setup will be validated automatically.';
  } else {
    authMessage = `Authentication is configured to use external provider${
      providerName ? ` (${providerName})` : ''
    }. JWTs will be validated against the provided JWKS URL.`;
  }

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
