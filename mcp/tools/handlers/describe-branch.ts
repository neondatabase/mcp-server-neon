import { Api, Branch } from '../../neon-client';
import { ToolHandlerExtraParams } from '../types';
import { handleGetConnectionString } from './connection-string';
import { neon } from '@neondatabase/serverless';
import { DESCRIBE_DATABASE_QUERY } from '../utils';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { CONSOLE_URLS, generateConsoleUrl } from './urls';

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

Console Link: ${generateConsoleUrl(CONSOLE_URLS.PROJECT_BRANCH, {
    projectId: branch.project_id,
    branchId: branch.id,
  })}
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
    const [tree] = await runQuery.transaction(
      [runQuery.query(DESCRIBE_DATABASE_QUERY)],
      { readOnly: true },
    );
    // The leading empty array stood for the former CREATE FUNCTION statement's
    // result; it is kept so the output format is unchanged.
    response = [[], tree];

    return {
      content: [
        {
          type: 'text',
          text: branchInfo(branch),
        },
        {
          type: 'text',
          text: ['Database Structure:', JSON.stringify(response, null, 2)].join(
            '\n',
          ),
        },
      ],
    };
  } catch (error) {
    // Say why the structure is missing rather than returning metadata alone.
    const role =
      extra.pinnedRoleName !== undefined
        ? ` as Postgres role "${extra.pinnedRoleName}"`
        : '';
    return {
      content: [
        { type: 'text', text: branchInfo(branch) },
        {
          type: 'text',
          text: `Database structure unavailable${role}: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
}
