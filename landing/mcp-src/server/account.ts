import type { Api, AuthDetailsResponse } from '@neondatabase/api-client';
import { identify } from '../analytics/analytics';

export type Account = {
  id: string;
  name: string;
  email?: string;
  isOrg: boolean;
};

/**
 * Resolves account information from Neon API auth details.
 * Handles both organization and personal accounts.
 *
 * @param auth - Auth details from neonClient.getAuthDetails()
 * @param neonClient - Configured Neon API client
 * @param identifyContext - If provided, calls identify() with this context
 * @returns Account information
 */
export async function resolveAccountFromAuth(
  auth: AuthDetailsResponse,
  neonClient: Api<unknown>,
  identifyContext?: Parameters<typeof identify>[1]
): Promise<Account> {
  let account: Account;

  if (auth.auth_method === 'api_key_org') {
    const { data: org } = await neonClient.getOrganization(auth.account_id);
    account = {
      id: auth.account_id,
      name: org.name,
      isOrg: true,
    };
  } else {
    const { data: user } = await neonClient.getCurrentUserInfo();
    account = {
      id: user.id,
      name: `${user.name ?? ''} ${user.last_name ?? ''}`.trim() || 'Unknown',
      email: user.email,
      isOrg: false,
    };
  }

  if (identifyContext) {
    identify(account, identifyContext);
  }

  return account;
}
