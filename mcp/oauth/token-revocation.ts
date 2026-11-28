import { Effect, Option } from 'effect';
import { revokeGrantForClient } from './grant-revocation';

export type TokenTypeHint = Option.Option<string>;

export const revokeToken = Effect.fn('OAuthStore.revokeToken')(
  (input: {
    readonly token: string;
    readonly tokenTypeHint: TokenTypeHint;
    readonly clientId: string;
  }) =>
    revokeGrantForClient(
      input.token,
      input.clientId,
      Option.getOrNull(input.tokenTypeHint),
    ).pipe(Effect.uninterruptible),
);
