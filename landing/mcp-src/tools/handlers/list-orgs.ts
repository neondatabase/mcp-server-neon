import { Api, Organization } from '@neondatabase/api-client';
import { ToolHandlerExtraParams } from '../types';
import { filterOrganizations } from '../utils';

export async function handleListOrganizations(
  neonClient: Api<unknown>,
  account: ToolHandlerExtraParams['account'],
  search?: string,
): Promise<Organization[]> {
  if (account.isOrg) {
    const orgId = account.id;
    const { data } = await neonClient.getOrganization(orgId);
    return filterOrganizations([data], search);
  }

  const { data: response } = await neonClient.getCurrentUserOrganizations();
  const organizations = response.organizations || [];
  return filterOrganizations(organizations, search);
}
