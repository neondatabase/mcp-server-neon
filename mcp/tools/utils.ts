import { Api } from '../neon-client';
import { NotFoundError } from '../server/errors';
import type { AuthContext } from '../types/auth';

/**
 * The projects API requires org_id. Take it from the argument, an org API key,
 * or the account's unique organization.
 */
export async function getOrgByOrgIdOrDefault(
  params: { org_id?: string },
  neonClient: Api<unknown>,
  account: AuthContext['extra']['account'],
): Promise<{ id: string }> {
  if (params.org_id) {
    return { id: params.org_id };
  }
  if (account.isOrg) {
    return { id: account.id };
  }

  const { data: response } = await neonClient.getCurrentUserOrganizations();
  const organizations = response.organizations || [];

  // 1. Filter organizations by managed_by==console, if there is only one organization, return that
  const consoleOrganizations = organizations.filter(
    (org) => org.managed_by === 'console',
  );

  if (consoleOrganizations.length === 1) {
    return consoleOrganizations[0];
  }

  // 2. If there are no organizations managed by console, and if there is only one organization (unfiltered), then return that organization
  if (consoleOrganizations.length === 0 && organizations.length === 1) {
    return organizations[0];
  }

  // 3. If there are no organizations at all, then throw error saying there are no organizations
  if (organizations.length === 0) {
    throw new NotFoundError('No organizations found for this user');
  }

  // 4. If there are multiple organizations, then throw error mentioning list of all these orgs (unfiltered)
  const orgList = organizations
    .map(
      (org) => `- ${org.name} (ID: ${org.id}) [managed by: ${org.managed_by}]`,
    )
    .join('\n');
  throw new NotFoundError(
    `Multiple organizations found. Please specify the org_id parameter with one of the following organization IDs:\n${orgList}`,
  );
}
