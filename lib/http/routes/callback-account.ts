import { Effect, Redacted } from 'effect';
import { NeonAccounts } from '../../../mcp/server/neon-accounts';
import { CallbackFailed } from './callback-failed';

/** The Neon account behind the upstream access token. */
export const resolveAccount = (input: {
  readonly accessToken: string;
  readonly clientId: string;
}) =>
  Effect.gen(function* () {
    const accounts = yield* NeonAccounts;
    const apiKey = Redacted.make(input.accessToken);
    const auth = yield* accounts.authDetails({ apiKey });

    return yield* accounts.account({ apiKey, auth });
  }).pipe(
    Effect.mapError((cause) =>
      CallbackFailed.make({
        cause,
        clientId: input.clientId,
        consumed: true,
        sloEmitted: false,
      }),
    ),
    Effect.withSpan('OAuthCallback.resolveAccount'),
  );
