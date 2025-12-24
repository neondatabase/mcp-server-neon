import { Api, ListProjectsParams } from '@neondatabase/api-client';
import { ToolHandlerExtraParams } from '../types';
import { getOrgByOrgIdOrDefault } from '../utils';
import { handleListOrganizations } from './list-orgs';

export async function handleListProjects(
  params: ListProjectsParams,
  neonClient: Api<unknown>,
  extra: ToolHandlerExtraParams,
) {
  const organization = await getOrgByOrgIdOrDefault(params, neonClient, extra);

  const response = await neonClient.listProjects({
    ...params,
    org_id: organization?.id,
  });
  if (response.status !== 200) {
    throw new Error(`Failed to list projects: ${response.statusText}`);
  }

  let projects = response.data.projects;

  // If search is provided and no org_id specified, and no projects found in personal account,
  // search across all user organizations
  if (params.search && !params.org_id && projects.length === 0) {
    const organizations = await handleListOrganizations(
      neonClient,
      extra.account,
    );

    // Search projects across all organizations
    const allProjects = [];
    for (const org of organizations) {
      // Skip the default organization
      if (organization?.id === org.id) {
        continue;
      }

      const orgResponse = await neonClient.listProjects({
        ...params,
        org_id: org.id,
      });
      if (orgResponse.status === 200) {
        allProjects.push(...orgResponse.data.projects);
      }
    }

    // If we found projects in other organizations, return them
    if (allProjects.length > 0) {
      projects = allProjects;
    }
  }

  return projects;
}
