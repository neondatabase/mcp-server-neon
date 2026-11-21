import { Clock, Effect, Option, Predicate } from 'effect';
import type { Client } from 'oauth2-server';
import type { ApprovedAuthTransaction } from '../../../mcp/oauth/auth-transaction';
import { FlowAnswer } from '../../../mcp/oauth/flow-answer';
import { OAuthStore } from '../../../mcp/oauth/oauth-store';
import { emitAuthCallbackSlo } from '../../oauth/auth-callback-slo';
import { oauthBrowserRequest } from '../oauth-request';
import { failed, missingRefreshToken } from './callback-answers';
import { resolveAccount } from './callback-account';
import { authorizationCode, clientRedirect } from './callback-code-grant';
import type { UpstreamTokens } from './callback-code-grant';

const warnMissingExpiry = (input: {
  readonly tokens: UpstreamTokens;
  readonly clientId: string;
}) =>
  input.tokens.expiresIn() === undefined
    ? Effect.logError(
        'Upstream omitted expires_in at callback; defaulting to 3600s',
      ).pipe(Effect.annotateLogs({ clientId: input.clientId }))
    : Effect.void;

/** Resolves the Neon account and stores our code for it. */
const saveAuthorizationCode = Effect.fnUntraced(function* (input: {
  readonly client: Client;
  readonly approved: ApprovedAuthTransaction;
  readonly tokens: UpstreamTokens;
  readonly refreshToken: string;
}) {
  const { client, approved, tokens, refreshToken } = input;
  const { clientId } = approved.request;

  const account = yield* resolveAccount({
    accessToken: tokens.access_token,
    clientId,
  });

  const code = authorizationCode({
    now: yield* Clock.currentTimeMillis,
    client,
    approved,
    account,
    tokens,
    refreshToken,
  });

  const store = yield* OAuthStore;

  yield* store
    .saveAuthorizationCode({ code })
    .pipe(Effect.mapError(failed({ clientId, consumed: true })));

  return { code, account };
});

/** The redirect that hands our code back to the client. */
const successAnswer = Effect.fnUntraced(function* (input: {
  readonly state: string;
  readonly client: Client;
  readonly approved: ApprovedAuthTransaction;
  readonly code: string;
  readonly userId: string;
}) {
  const { state, client, approved, code, userId } = input;
  const { request } = approved;
  const browser = yield* oauthBrowserRequest;
  const clientName: unknown = client.client_name;

  return FlowAnswer.Redirect({
    location: clientRedirect({
      redirectUri: request.redirectUri,
      state: request.state,
      code,
    }),
    status: 307,
    clears: Option.some({ id: state, secure: browser.secure }),
    context: Option.some({
      userId,
      clientId: request.clientId,
      clientName: Predicate.isString(clientName) ? clientName : undefined,
    }),
  });
});

/** Issues our authorization code for an approved transaction. */
export const issueAuthorizationCode = Effect.fnUntraced(function* (input: {
  readonly startedAt: number;
  readonly state: string;
  readonly client: Client;
  readonly approved: ApprovedAuthTransaction;
  readonly tokens: UpstreamTokens;
}) {
  const { startedAt, state, client, approved, tokens } = input;
  const { request } = approved;
  const { clientId } = request;

  yield* warnMissingExpiry({ tokens, clientId });

  const refreshToken = tokens.refresh_token;

  if (refreshToken === undefined || refreshToken === '') {
    return yield* missingRefreshToken({
      startedAt,
      clientId,
      scope: tokens.scope,
    });
  }

  const { code, account } = yield* saveAuthorizationCode({
    client,
    approved,
    tokens,
    refreshToken,
  });

  yield* emitAuthCallbackSlo({
    outcome: 'success',
    startedAt,
    context: { clientId },
  });

  return yield* successAnswer({
    state,
    client,
    approved,
    code: code.authorizationCode,
    userId: account.id,
  });
});
