import { Effect, Option } from 'effect';
import { HttpServerResponse } from 'effect/http';
import type { PendingAuthTransaction } from '../../../mcp/oauth/auth-transaction';
import { AuthTransactions } from '../../../mcp/oauth/auth-transactions';
import { confirmationApproval } from '../../../mcp/oauth/consent-approval';
import type { parseConsentPost } from '../../../mcp/oauth/consent-approval';
import { issuedOauthScopes } from '../../../mcp/oauth/issued-scopes';
import { OAuthStore } from '../../../mcp/oauth/oauth-store';
import { UpstreamOAuth } from '../../oauth/upstream-oauth';
import { oauthErrorResponse } from '../oauth-error-response';
import {
  consentClientFields,
  consentClientIdentity,
  consentResponse,
  restartResponse,
} from './authorize-consent';

type FieldError = Extract<
  ReturnType<typeof parseConsentPost>,
  { action: 'invalid' }
>['error'];

/** Renders consent again with the field the user got wrong. */
export const invalidSubmission = Effect.fnUntraced(function* (input: {
  readonly pending: PendingAuthTransaction;
  readonly error: FieldError;
}) {
  const { pending, error } = input;

  if (error.kind !== 'field') {
    return oauthErrorResponse(400, error.kind, error.description);
  }

  const store = yield* OAuthStore;

  const client = yield* store.findClient({
    clientId: pending.request.clientId,
  });

  if (Option.isNone(client)) {
    return oauthErrorResponse(400, 'invalid_client', 'Invalid client ID');
  }

  const { selection } = error;

  return consentResponse({
    client: consentClientFields(client.value),
    identity: consentClientIdentity(pending.request.clientId),
    redirectUri: pending.request.redirectUri,
    state: pending.id,
    mode: pending.mode,
    writeChecked: selection.grantWrite,
    showWriteControl: pending.ceiling.writeAllowed,
    grant: pending.resourceGrant,
    fieldError: { field: error.field, message: error.message },
    formState: {
      projectMode: selection.projectMode,
      projectId: selection.projectId,
      roleName: selection.roleName,
      categories: selection.categories,
      writeChecked: selection.grantWrite,
      secrets: selection.secrets,
    },
  });
});

type Approval = Extract<
  ReturnType<typeof parseConsentPost>,
  { action: 'approve' }
>;

/** Records the approved grant and sends the browser to upstream login. */
export const approve = Effect.fnUntraced(function* (input: {
  readonly pending: PendingAuthTransaction;
  readonly approval: Approval;
  readonly browserSecret: string;
}) {
  const { pending, approval, browserSecret } = input;

  const { grant: approvedGrant, scopes: approvedScopes } = approval.confirmation
    ? confirmationApproval({
        resourceGrant: pending.resourceGrant,
        requestScopes: pending.request.scope,
        resourceReadOnlyHard: pending.resourceReadOnlyHard,
      })
    : {
        grant: approval.selection.grant,
        scopes: issuedOauthScopes({
          requestedScopes: pending.request.scope,
          grantWrite: approval.selection.grantWrite,
        }),
      };

  const transactions = yield* AuthTransactions;

  const approved = yield* transactions.approvePending({
    id: pending.id,
    browserSecret,
    approvedGrant,
    approvedScopes,
  });

  if (Option.isNone(approved)) {
    return restartResponse();
  }

  const upstream = yield* UpstreamOAuth;

  const authUrl = yield* upstream.authorizationUrl({
    state: approved.value.id,
  });

  return HttpServerResponse.redirect(authUrl.href, { status: 303 });
});
