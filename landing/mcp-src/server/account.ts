import type { Api, AuthDetailsResponse } from '@neondatabase/api-client';
import { isAxiosError } from 'axios';
import { identify } from '../analytics/analytics';
import { logger } from '../utils/logger';

export type Account = {
  id: string;
  name: string;
  email?: string;
  isOrg: boolean;
};

export async function resolveAccountFromAuth(
  auth: AuthDetailsResponse,
  neonClient: Api<unknown>,
  identifyContext?: Parameters<typeof identify>[1]
): Promise<Account> {
  let account: Account;

  try {
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
  } catch (error) {
    // Project-scoped API keys cannot access account-level endpoints
    const isProjectScopedKeyError =
      isAxiosError(error) &&
      error.response?.status === 404 &&
      error.response?.data?.message?.includes(
        'not allowed to perform actions outside the project'
      );

    if (isProjectScopedKeyError) {
      logger.debug('Using project-scoped API key fallback', {
        account_id: auth.account_id,
      });
      account = {
        id: auth.account_id,
        name: 'Project-scoped API Key',
        isOrg: false,
      };
    } else {
      throw error;
    }
  }

  if (identifyContext) {
    identify(account, identifyContext);
  }

  return account;
}
