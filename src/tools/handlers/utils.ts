import { Api } from '@neondatabase/api-client';
import { handleListProjects } from './list-projects.js';
import { ToolHandlerExtraParams } from '../types.js';
import { NotFoundError } from '../../server/errors.js';

export async function getOnlyProject(
  neonClient: Api<unknown>,
  extra: ToolHandlerExtraParams,
) {
  const projects = await handleListProjects({}, neonClient, extra);
  if (projects.length === 1) {
    return projects[0];
  }
  throw new NotFoundError(
    'Please provide a project ID or ensure you have only one project in your account.',
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
    'No default branch found in this project. Please provide a branch ID.',
  );
};
