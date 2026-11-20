import { Effect } from 'effect';
import { OAuthStoreUnavailable } from './oauth-store-unavailable';

// One span per store round trip, so a slow revocation shows which one.
export const stored = <A>(operation: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => OAuthStoreUnavailable.make({ operation, cause }),
  }).pipe(Effect.withSpan(`OAuthModel.${operation}`));
