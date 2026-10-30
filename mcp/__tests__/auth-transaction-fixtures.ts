import { authTransactions } from '../oauth/auth-transaction-store';
import { browserBindingKey, consentCookieName } from '../oauth/browser-binding';
import type { DownstreamAuthRequest } from '../oauth/downstream-auth-request';
import { DEFAULT_GRANT, type GrantContext } from '../utils/grant-context';
import type { ConsentCeiling } from '../oauth/consent-approval';
import type { ConsentMode } from '../oauth/consent-mode';

const TEST_DOWNSTREAM_REQUEST: DownstreamAuthRequest = {
  responseType: 'code',
  clientId: 'client-123',
  redirectUri: 'http://127.0.0.1:55667/callback',
  scope: ['read', 'write'],
  state: 'client-state',
};

export async function seedPendingTransaction({
  request = TEST_DOWNSTREAM_REQUEST,
  mode = 'editable',
  ceiling = {
    writeAllowed: true,
    projectId: null,
    scopes: null,
  },
  defaultReadOnly = false,
  resourceGrant = DEFAULT_GRANT,
  resourceReadOnlyHard = false,
  hostPrefixedCookie = false,
}: {
  request?: DownstreamAuthRequest;
  mode?: ConsentMode;
  ceiling?: ConsentCeiling;
  defaultReadOnly?: boolean;
  resourceGrant?: GrantContext;
  resourceReadOnlyHard?: boolean;
  hostPrefixedCookie?: boolean;
} = {}) {
  return authTransactions.createPending({
    request,
    mode,
    ceiling,
    defaultReadOnly,
    resourceGrant,
    resourceReadOnlyHard,
    hostPrefixedCookie,
  });
}

export async function seedApprovedTransaction({
  approvedGrant = DEFAULT_GRANT,
  approvedScopes = ['read', 'write'],
  ...pending
}: {
  request?: DownstreamAuthRequest;
  mode?: ConsentMode;
  ceiling?: ConsentCeiling;
  defaultReadOnly?: boolean;
  resourceGrant?: GrantContext;
  resourceReadOnlyHard?: boolean;
  hostPrefixedCookie?: boolean;
  approvedGrant?: GrantContext;
  approvedScopes?: string[];
} = {}) {
  const created = await seedPendingTransaction(pending);
  const hostPrefixed = pending.hostPrefixedCookie ?? false;
  const approved = await authTransactions.approvePending({
    id: created.transaction.id,
    browserSecret: browserBindingKey(created.browserSecret, hostPrefixed),
    approvedGrant,
    approvedScopes,
  });
  if (!approved) {
    throw new Error('failed to approve test transaction');
  }
  return {
    id: created.transaction.id,
    browserSecret: created.browserSecret,
    cookie: `${consentCookieName(created.transaction.id, hostPrefixed)}=${created.browserSecret}`,
    approved,
  };
}
