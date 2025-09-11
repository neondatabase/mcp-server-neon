import { Api } from '@neondatabase/api-client';
import { ToolHandlerExtraParams } from '../types.js';
import { startSpan } from '@sentry/node';
import { handleListProjects } from './list-projects.js';
import { NotFoundError } from '../../server/errors.js';
import { getDefaultDatabase } from '../utils.js';

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
        const projects = await handleListProjects({}, neonClient, extra);
        if (projects.length === 1) {
          projectId = projects[0].id;
        } else {
          throw new NotFoundError(
            'Please provide a project ID or ensure you have only one project in your account.',
          );
        }
      }

      if (!branchId) {
        const branches = await neonClient.listProjectBranches({
          projectId,
        });
        const defaultBranch = branches.data.branches.find(
          (branch) => branch.default,
        );
        if (defaultBranch) {
          branchId = defaultBranch.id;
        } else {
          throw new NotFoundError(
            'No default branch found in this project. Please provide a branch ID.',
          );
        }
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
