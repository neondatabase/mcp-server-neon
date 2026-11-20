import { Effect } from 'effect';
import { resolveAccountFromAuth } from '../../../mcp/server/account';
import { createNeonClient } from '../../../mcp/server/api';
import { CallbackFailed } from './callback-failed';

/** The Neon account behind the upstream access token; interruption aborts it. */
export const resolveAccount = (input: {
  readonly accessToken: string;
  readonly clientId: string;
}) =>
  Effect.tryPromise({
    try: async (signal) => {
      const neonClient = createNeonClient(input.accessToken);
      const { data: auth } = await neonClient.getAuthDetails({ signal });

      return resolveAccountFromAuth(auth, neonClient, { signal });
    },
    catch: (cause) =>
      CallbackFailed.make({
        cause,
        clientId: input.clientId,
        consumed: true,
        sloEmitted: false,
      }),
  }).pipe(Effect.withSpan('OAuthCallback.resolveAccount'));
