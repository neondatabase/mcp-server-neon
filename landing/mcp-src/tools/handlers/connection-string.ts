import { Api } from "@neondatabase/api-client";
import { ToolHandlerExtraParams } from "../types";
import { startSpan } from "@sentry/node";
import { getDefaultDatabase } from "../utils";
import { getDefaultBranch, getOnlyProject } from "./utils";

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
      name: "get_connection_string",
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
