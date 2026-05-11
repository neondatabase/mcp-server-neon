import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Api, NeonAuthSupportedAuthProvider } from '@neondatabase/api-client';
import { isAxiosError } from 'axios';
import { provisionNeonAuthInputSchema } from '../toolsSchema';
import { z } from 'zod/v3';
import { getDefaultDatabase } from '../utils';
import { getDefaultBranch } from './utils';
import { ToolHandlerExtraParams } from '../types';

type Props = z.infer<typeof provisionNeonAuthInputSchema>;

async function respondWithExistingNeonAuth(
  projectId: string,
  branchId: string,
  neonClient: Api<unknown>,
): Promise<CallToolResult> {
  try {
    const existingResponse = await neonClient.getNeonAuth(projectId, branchId);
    if (existingResponse.status !== 200 || !existingResponse.data) {
      return {
        content: [
          {
            type: 'text',
            text: `Neon Auth is already provisioned for this branch, but details could not be re-loaded (${existingResponse.status} ${existingResponse.statusText}).`,
          },
        ],
      };
    }
    const { base_url, jwks_url } = existingResponse.data;
    return {
      content: [
        {
          type: 'text',
          text: `Neon Auth already provisioned.

Use this URL to access the Neon Auth through your better auth compatible client:
\`\`\`
${base_url}
\`\`\`

Use Following JWKS URL to retrieve the public key to verify the JSON Web Tokens (JWT) issued by authentication provider:
\`\`\`
${jwks_url}
\`\`\``,
        },
      ],
    };
  } catch {
    return {
      content: [
        {
          type: 'text',
          text: 'Neon Auth already provisioned.',
        },
      ],
    };
  }
}

export async function handleProvisionNeonAuth(
  { projectId, branchId, databaseName }: Props,
  neonClient: Api<unknown>,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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

  let response: Awaited<ReturnType<Api<unknown>['createNeonAuth']>>;
  try {
    response = await neonClient.createNeonAuth(projectId, resolvedBranchId, {
      auth_provider: NeonAuthSupportedAuthProvider.BetterAuth,
      database_name: defaultDatabase.name,
    });
  } catch (error: unknown) {
    // Axios rejects 4xx by default; Neon returns 409 when auth is already enabled.
    if (isAxiosError(error) && error.response?.status === 409) {
      return respondWithExistingNeonAuth(
        projectId,
        resolvedBranchId,
        neonClient,
      );
    }
    const detail =
      isAxiosError(error) &&
      error.response?.data &&
      typeof error.response.data === 'object' &&
      'message' in error.response.data
        ? String(
            (error.response.data as { message?: string }).message ??
              error.message,
          )
        : error instanceof Error
          ? error.message
          : 'Unknown error';
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `Failed to provision Neon Auth. ${detail}`,
        },
      ],
    };
  }

  // 409 without throw (if axios is configured to resolve errors)
  if (response.status === 409) {
    return respondWithExistingNeonAuth(projectId, resolvedBranchId, neonClient);
  }

  if (response.status !== 201) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `Failed to provision Neon Auth. Error: ${response.status} ${response.statusText}`,
        },
      ],
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: `Authentication has been successfully provisioned for your Neon project and branch.

Use this URL to access the Neon Auth through your better auth compatible client:
\`\`\`
${response.data.base_url}
\`\`\`

Use Following JWKS URL to retrieve the public key to verify the JSON Web Tokens (JWT) issued by authentication provider:
\`\`\`
${response.data.jwks_url}
\`\`\``,
      },
    ],
  };
}
