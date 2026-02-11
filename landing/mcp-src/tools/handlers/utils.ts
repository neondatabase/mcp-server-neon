import { Api } from "@neondatabase/api-client";
import { handleListProjects } from "./list-projects";
import { ToolHandlerExtraParams } from "../types";
import { NotFoundError } from "../../server/errors";
import { looksLikeBranchId, looksLikeProjectId } from "../utils";

type MCPOrgId = `org:${string}`;
type MCPProjectId = `project:${string}`;
type MCPBranchId = `branch:${string}/${string}`; // projectId/branchId
export type SearchResultId = MCPOrgId | MCPProjectId | MCPBranchId;

export const isOrgId = (id: string): id is MCPOrgId => {
  return id.startsWith("org:") || id.startsWith("org-");
};

export const isProjectId = (id: string): id is MCPProjectId => {
  return id.startsWith("project:") || looksLikeProjectId(id);
};

export const isBranchId = (id: string): id is MCPProjectId => {
  return id.startsWith("branch:") || looksLikeBranchId(id);
};

export async function getOnlyProject(
  neonClient: Api<unknown>,
  extra: ToolHandlerExtraParams,
) {
  const projects = await handleListProjects({}, neonClient, extra);
  if (projects.length === 1) {
    return projects[0];
  }
  throw new NotFoundError(
    "Please provide a project ID or ensure you have only one project in your account.",
  );
}

export const getDefaultBranch = async (
  projectId: string,
  neonClient: Api<unknown>,
) => {
  const branches = await neonClient.listProjectBranches({
    projectId,
  });
  const defaultBranch = branches.data.branches.find((branch) => branch.default);
  if (defaultBranch) {
    return defaultBranch;
  }
  throw new NotFoundError(
    "No default branch found in this project. Please provide a branch ID.",
  );
};
