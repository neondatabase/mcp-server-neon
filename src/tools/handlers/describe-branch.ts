import { Api, Branch } from '@neondatabase/api-client';
import { ToolHandlerExtraParams } from '../types.js';
import { handleGetConnectionString } from './connection-string.js';
import { neon } from '@neondatabase/serverless';
import { DESCRIBE_DATABASE_STATEMENTS } from '../utils.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const branchInfo = (branch: Branch) => {
  return `Branch Details: 
Name: ${branch.name}
ID: ${branch.id}
Parent Branch: ${branch.parent_id}
Default: ${branch.default}
Protected: ${branch.protected ? 'Yes' : 'No'}

${branch.created_by ? `Created By: ${branch.created_by.name}` : ''}
Created: ${new Date(branch.created_at).toLocaleDateString()}
Updated: ${new Date(branch.updated_at).toLocaleDateString()}

Compute Usage: ${branch.compute_time_seconds} seconds
Written Data: ${branch.written_data_bytes} bytes
Data Transfer: ${branch.data_transfer_bytes} bytes
`;
};

export async function handleDescribeBranch(
  {
    projectId,
    databaseName,
    branchId,
  }: {
    projectId: string;
    databaseName?: string;
    branchId: string;
  },
  neonClient: Api<unknown>,
  extra: ToolHandlerExtraParams,
): Promise<CallToolResult> {
  const { data: branchData } = await neonClient.getProjectBranch(
    projectId,
    branchId,
  );

  const branch = branchData.branch;

  let response: Record<string, any>[][];
  try {
    const connectionString = await handleGetConnectionString(
      {
        projectId,
        branchId: branch.id,
        databaseName,
      },
      neonClient,
      extra,
    );
    const runQuery = neon(connectionString.uri);
    response = await runQuery.transaction(
      DESCRIBE_DATABASE_STATEMENTS.map((sql) => runQuery.query(sql)),
    );

    return {
      content: [
        {
          type: 'text',
          text: branchInfo(branch),
          metadata: branch,
        },
        {
          type: 'text',
          text: ['Database Structure:', JSON.stringify(response, null, 2)].join(
            '\n',
          ),
          databasetree: response,
        },
      ],
    };
  } catch {
    // Ignore database connection errors
  }

  return {
    content: [
      {
        type: 'text',
        text: branchInfo(branch),
      },
    ],
  };
}
