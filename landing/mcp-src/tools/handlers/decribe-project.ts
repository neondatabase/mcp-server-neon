import { Api } from '@neondatabase/api-client';

async function handleDescribeProject(
  projectId: string,
  neonClient: Api<unknown>,
) {
  const { data: branchesData } = await neonClient.listProjectBranches({
    projectId: projectId,
  });
  const { data: projectData } = await neonClient.getProject(projectId);
  return {
    branches: branchesData.branches,
    project: projectData.project,
  };
}

export { handleDescribeProject };
