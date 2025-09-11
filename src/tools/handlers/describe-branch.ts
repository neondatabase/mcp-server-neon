import { Api } from '@neondatabase/api-client';
import { ToolHandlerExtraParams } from '../types.js';
import { handleGetConnectionString } from './connection-string.js';
import { neon } from '@neondatabase/serverless';
import { DESCRIBE_DATABASE_STATEMENTS } from '../utils.js';

export async function handleDescribeBranch(
  {
    projectId,
    databaseName,
    branchId,
  }: {
    projectId: string;
    databaseName?: string;
    branchId?: string;
  },
  neonClient: Api<unknown>,
  extra: ToolHandlerExtraParams,
) {
  const connectionString = await handleGetConnectionString(
    {
      projectId,
      branchId,
      databaseName,
    },
    neonClient,
    extra,
  );
  const runQuery = neon(connectionString.uri);
  const response = await runQuery.transaction(
    DESCRIBE_DATABASE_STATEMENTS.map((sql) => runQuery.query(sql)),
  );

  return response;
}
