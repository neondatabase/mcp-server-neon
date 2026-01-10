import type { Api, AuthDetailsResponse } from '@neondatabase/api-client';
import { isAxiosError } from 'axios';
import { captureException } from '@sentry/node';
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
      (error.response?.status === 404 || error.response?.status === 403) &&
      typeof error.response?.data?.message === 'string' &&
      (error.response.data.message.includes('outside the project') ||
        error.response.data.message.includes('project-scoped'));

    if (isProjectScopedKeyError) {
      logger.debug('Using project-scoped API key fallback', {
        account_id: auth.account_id,
      });

      // Track project-scoped key usage in Sentry for observability
      // Using 'info' level to monitor without triggering alerts
      captureException(error, {
        level: 'info',
        tags: {
          auth_type: 'project_scoped_key',
          auth_method: auth.auth_method,
        },
        extra: {
          account_id: auth.account_id,
        },
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
