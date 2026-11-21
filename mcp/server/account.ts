import type { AuthDetailsResponse } from '../neon-client';
import { addBreadcrumb } from '@sentry/node';
import { Option, Result, Schema } from 'effect';

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
