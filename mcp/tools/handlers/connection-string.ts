import { Api } from '../../neon-client';
import { ToolHandlerExtraParams } from '../types';
import { startSpan } from '@sentry/node';
import { getDefaultDatabase } from '../utils';
import { getDefaultBranch, getOnlyProject } from './utils';

/**
 * Resolves a connection URI for internal callers such as `run_sql`,
 * `get_database_tables`, `describe_branch` and `inspect_database`, which need a
 * connection to reach Postgres at all.
 *
 * The URI embeds the branch owner role's password, so it must never be handed
 * to a read-only caller. That is enforced at the tool layer — the
 * `get_connection_string` tool is not `readOnlySafe` and refuses when
 * `extra.readOnly` is set — not here, because these internal callers stay safe
 * in read-only mode through query-level protections (read-only transactions)
 * and never surface the URI to the client.
 */
export async function handleGetConnectionString(
  {
    projectId,
    branchId,
    computeId,
    databaseName,
    roleName,
  }: {
    projectId?: string;
    branchId?: string;
    computeId?: string;
    databaseName?: string;
    roleName?: string;
  },
  neonClient: Api<unknown>,
  extra: ToolHandlerExtraParams,
) {
  return await startSpan(
    {
      name: 'get_connection_string',
    },
    async () => {
      // If projectId is not provided, get the first project but only if there is only one project
      if (!projectId) {
        const project = await getOnlyProject(neonClient, extra);
        projectId = project.id;
      }

      if (!branchId) {
        const defaultBranch = await getDefaultBranch(projectId, neonClient);
        branchId = defaultBranch.id;
      }

      // If databaseName is not provided, use default `neondb` or first database
      let dbObject;
      if (!databaseName) {
        dbObject = await getDefaultDatabase(
          {
            projectId,
            branchId,
            databaseName,
          },
          neonClient,
        );
        databaseName = dbObject.name;

        if (!roleName) {
          roleName = dbObject.owner_name;
        }
      } else if (!roleName) {
        const { data } = await neonClient.getProjectBranchDatabase(
          projectId,
          branchId,
          databaseName,
        );
        roleName = data.database.owner_name;
      }

      // Get connection URI with the provided parameters
      const connectionString = await neonClient.getConnectionUri({
        projectId,
        role_name: roleName,
        database_name: databaseName,
        branch_id: branchId,
        endpoint_id: computeId,
      });

      return {
        uri: connectionString.data.uri,
        projectId,
        branchId,
        databaseName,
        roleName,
        computeId,
      };
    },
  );
}
