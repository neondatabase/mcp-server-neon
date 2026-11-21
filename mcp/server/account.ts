import type { NeonApiClient, AuthDetailsResponse } from '../neon-client';
import { NeonApiError } from '@neon/sdk';
import { addBreadcrumb } from '@sentry/node';
import { Option, Result, Schema } from 'effect';
import { logger } from '../utils/logger';

export type NeonAccount = {
  id: string;
  name: string;
  email?: string;
  isOrg: boolean;
};

export const orgAccount = (accountId: string, name: string): NeonAccount => ({
  id: accountId,
  name,
  isOrg: true,
});

export const userAccount = (user: {
  readonly id: string;
  readonly name?: string | null;
  readonly last_name?: string | null;
  readonly email: string;
}): NeonAccount => {
  const name = `${user.name ?? ''} ${user.last_name ?? ''}`.trim();

  return {
    id: user.id,
    name: name === '' ? 'Unknown' : name,
    email: user.email,
    isOrg: false,
  };
};

export const projectScopedAccount = (accountId: string): NeonAccount => ({
  id: accountId,
  name: 'Project-scoped API Key',
  isOrg: false,
});

const ErrorBody = Schema.Struct({ message: Schema.String });

/**
 * Project-scoped API keys cannot read account-level endpoints; Neon answers
 * 403 or 404 with a message naming the project scope.
 */
export const isProjectScopedKeyRejection = ({
  status,
  body,
}: {
  readonly status: number;
  readonly body: unknown;
}): boolean =>
  (status === 403 || status === 404) &&
  Option.match(Schema.decodeUnknownOption(ErrorBody)(body), {
    onNone: () => false,
    onSome: ({ message }) =>
      message.includes('outside the project') ||
      message.includes('project-scoped'),
  });

export const projectScopedFallbackBreadcrumb = (
  auth: AuthDetailsResponse,
): void => {
  addBreadcrumb({
    category: 'auth',
    message: 'Using project-scoped API key fallback',
    level: 'info',
    data: {
      auth_type: 'project_scoped_key',
      auth_method: auth.auth_method,
      account_id: auth.account_id,
    },
  });
};

type ListedOrganization = {
  readonly id: string;
  readonly name: string;
  readonly managed_by: string;
};

/**
 * The organization a call that needs `org_id` runs in when the caller passed
 * none: the only console-managed one, else the only one. Fails with the message
 * the caller sees.
 */
export const selectOrganization = (
  organizations: readonly ListedOrganization[],
): Result.Result<{ readonly id: string }, string> => {
  const consoleOrganizations = organizations.filter(
    (org) => org.managed_by === 'console',
  );
  const [onlyConsole] = consoleOrganizations;

  if (consoleOrganizations.length === 1 && onlyConsole !== undefined) {
    return Result.succeed({ id: onlyConsole.id });
  }

  const [only] = organizations;

  if (
    consoleOrganizations.length === 0 &&
    organizations.length === 1 &&
    only !== undefined
  ) {
    return Result.succeed({ id: only.id });
  }

  if (organizations.length === 0) {
    return Result.fail('No organizations found for this user');
  }

  const orgList = organizations
    .map(
      (org) => `- ${org.name} (ID: ${org.id}) [managed by: ${org.managed_by}]`,
    )
    .join('\n');

  return Result.fail(
    `Multiple organizations found. Please specify the org_id parameter with one of the following organization IDs:\n${orgList}`,
  );
};

/**
 * Resolves account info from Neon API auth details.
 * Handles org accounts, personal accounts, and project-scoped API key fallback.
 * The OAuth callback still resolves accounts through this; the MCP transport
 * uses `NeonAccounts`.
 */
export async function resolveAccountFromAuth(
  auth: AuthDetailsResponse,
  neonClient: NeonApiClient,
): Promise<NeonAccount> {
  try {
    if (auth.auth_method === 'api_key_org') {
      const { data: org } = await neonClient.getOrganization(auth.account_id);

      return orgAccount(auth.account_id, org.name);
    }

    const { data: user } = await neonClient.getCurrentUserInfo();

    return userAccount(user);
  } catch (error) {
    if (error instanceof NeonApiError && isProjectScopedKeyRejection(error)) {
      logger.debug('Using project-scoped API key fallback', {
        account_id: auth.account_id,
      });
      projectScopedFallbackBreadcrumb(auth);

      return projectScopedAccount(auth.account_id);
    }

    throw error;
  }
}
