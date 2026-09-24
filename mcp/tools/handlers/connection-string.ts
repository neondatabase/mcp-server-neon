import { Api } from '../../neon-client';
import { ToolHandlerExtraParams } from '../types';
import { startSpan } from '@sentry/node';
import { getDefaultDatabase } from '../utils';
import { getDefaultBranch, getOnlyProject } from './utils';
import { InvalidArgumentError } from '../../server/errors';

/**
 * Resolves a connection URI for internal callers such as `run_sql`,
 * `get_database_tables`, `describe_branch` and `inspect_database`, which need a
 * connection to reach Postgres at all.
 *
 * The URI embeds the branch owner role's password, so it must never be handed
 * to a read-only caller. That is enforced by withholding the tool itself —
 * `get_connection_string` is not `readOnlySafe`, so it is never registered on a
 * read-only server — not here, because these internal callers stay safe in
 * read-only mode through query-level protections (read-only transactions) and
 * never surface the URI to the client.
 *
 * A role pinned by the connection grant (`extra.pinnedRoleName`) is enforced
 * here, so every caller gets it: the pinned role replaces an omitted
 * `roleName`, a different `roleName` is rejected, and the database owner is
 * never looked up. A pinned role that Neon cannot resolve, or that Postgres
 * refuses to log in, fails the call; nothing retries as another role.
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
      const pinnedRoleName = extra.pinnedRoleName;
      if (pinnedRoleName !== undefined) {
        if (roleName !== undefined && roleName !== pinnedRoleName) {
          throw new InvalidArgumentError(
            `This connection is pinned to Postgres role "${pinnedRoleName}"; role_name "${roleName}" is not allowed.`,
          );
        }
        roleName = pinnedRoleName;
      }

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
