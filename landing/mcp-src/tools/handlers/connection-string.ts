import { Api, EndpointType } from '@neondatabase/api-client';
import { ToolHandlerExtraParams } from '../types';
import { startSpan } from '@sentry/node';
import { getDefaultDatabase } from '../utils';
import { getDefaultBranch, getOnlyProject } from './utils';
import { InvalidArgumentError } from '../../server/errors';

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
  options?: {
    enforceReadOnlyReplica?: boolean;
  },
) {
  const readOnlyReplicaError =
    'this MCP server is in read-only mode and no read replica endpoint can be found - create a read replica first using the Neon UI to enable get_connection_string in read-only mode or remove the read-only mode configuration (HTTP header, OAuth scope settings)';

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

      // Only enforce read-replica endpoint selection for the
      // get_connection_string tool. Other read-only-safe tools can run against
      // a read-write endpoint because query-level protections prevent writes.
      if (extra.readOnly && options?.enforceReadOnlyReplica) {
        const branchEndpoints = await neonClient.listProjectBranchEndpoints(
          projectId,
          branchId,
        );
        const readOnlyEndpoint = branchEndpoints.data.endpoints.find(
          (endpoint) =>
            endpoint.type === EndpointType.ReadOnly &&
            endpoint.disabled !== true,
        );

        if (!readOnlyEndpoint) {
          throw new InvalidArgumentError(readOnlyReplicaError);
        }

        computeId = readOnlyEndpoint.id;
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
