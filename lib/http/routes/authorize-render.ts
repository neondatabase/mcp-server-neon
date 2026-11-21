import { Effect } from 'effect';
import type { Client } from 'oauth2-server';
import { AuthTransactions } from '../../../mcp/oauth/auth-transactions';
import {
  confirmationApproval,
  confirmationCeiling,
  editableCeiling,
} from '../../../mcp/oauth/consent-approval';
import {
  consentModeFromResource,
  resourceReadOnlyHardCeiling,
} from '../../../mcp/oauth/consent-mode';
import type { DownstreamAuthRequest } from '../../../mcp/oauth/downstream-auth-request';
import type { GrantContext } from '../../../mcp/utils/grant-context';
import { oauthBrowserRequest } from '../oauth-request';
import {
  consentClientFields,
  consentClientIdentity,
  consentResponse,
} from './authorize-consent';

/** The consent mode and the most the user can grant for this request. */
const consentScope = (input: {
  readonly request: DownstreamAuthRequest;
  readonly resourceGrant: GrantContext;
  readonly readOnly: boolean;
}) => {
  const { request, resourceGrant, readOnly } = input;
  const mode = consentModeFromResource(request.resource);
  const resourceReadOnlyHard = resourceReadOnlyHardCeiling(request.resource);

  const confirmation = {
    resourceGrant,
    requestScopes: request.scope,
    resourceReadOnlyHard,
  };

  const ceiling =
    mode === 'confirmation'
      ? confirmationCeiling(confirmation)
      : editableCeiling(request.scope);

  const writeChecked =
    mode === 'confirmation'
      ? confirmationApproval(confirmation).writeGranted
      : ceiling.writeAllowed && !readOnly;

  return { mode, ceiling, resourceReadOnlyHard, writeChecked };
};

/** Creates the pending transaction and renders consent for it. */
export const renderConsent = Effect.fnUntraced(function* (input: {
  readonly request: DownstreamAuthRequest;
  readonly client: Client;
  readonly resourceGrant: GrantContext;
  readonly readOnly: boolean;
}) {
  const { request, client, resourceGrant, readOnly } = input;
  const browser = yield* oauthBrowserRequest;
  const scope = consentScope({ request, resourceGrant, readOnly });
  const transactions = yield* AuthTransactions;

  const created = yield* transactions.createPending({
    request,
    mode: scope.mode,
    ceiling: scope.ceiling,
    defaultReadOnly: readOnly,
    resourceGrant,
    resourceReadOnlyHard: scope.resourceReadOnlyHard,
    hostPrefixedCookie: browser.secure,
  });

  return consentResponse(
    {
      client: consentClientFields(client),
      identity: consentClientIdentity(request.clientId),
      redirectUri: request.redirectUri,
      state: created.transaction.id,
      mode: scope.mode,
      writeChecked: scope.writeChecked,
      showWriteControl: scope.mode === 'editable' && scope.ceiling.writeAllowed,
      grant: resourceGrant,
    },
    {
      transactionId: created.transaction.id,
      browserSecret: created.browserSecret,
      secure: browser.secure,
      expiresAt: created.transaction.expiresAt,
    },
  );
});
