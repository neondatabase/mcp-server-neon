import { Context, Effect, Layer, Result } from 'effect';
import { ServerConfig } from '../config';
import { exchangeCode, exchangeRefreshToken, upstreamAuth } from './client';
import type { UpstreamRequestSummary } from './client';
import { UpstreamOAuthFailed } from './upstream-oauth-failed';

type UpstreamTokens = Awaited<ReturnType<typeof exchangeCode>>;

const upstream = <A>(
  operation: string,
  run: (signal: AbortSignal) => Promise<A>,
) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => UpstreamOAuthFailed.make({ operation, cause }),
  }).pipe(
    Effect.map(Result.succeed),
    Effect.catchTag('UpstreamOAuthFailed', (failure) =>
      failure.rejected
        ? Effect.annotateCurrentSpan({
            'error.type': 'UpstreamOAuthRejected',
            'oauth.upstream_error': failure.details.oauthError ?? 'unknown',
          }).pipe(Effect.as(Result.fail(failure)))
        : Effect.fail(failure),
    ),
    Effect.withSpan(`UpstreamOAuth.${operation}`),
    Effect.flatMap(Effect.fromResult),
  );

/** The upstream authorization server (Hydra), through openid-client. */
export class UpstreamOAuth extends Context.Service<
  UpstreamOAuth,
  {
    readonly authorizationUrl: (input: {
      readonly state: string;
    }) => Effect.Effect<URL, UpstreamOAuthFailed>;
    readonly exchangeCode: (input: {
      readonly currentUrl: URL;
      readonly state: string;
    }) => Effect.Effect<UpstreamTokens, UpstreamOAuthFailed>;
    /**
     * Interrupting the effect aborts the request. `onRequest` receives a
     * sanitized summary of the body that was sent.
     */
    readonly exchangeRefreshToken: (input: {
      readonly refreshToken: string;
      readonly onRequest: (summary: UpstreamRequestSummary) => void;
    }) => Effect.Effect<UpstreamTokens, UpstreamOAuthFailed>;
  }
>()('@neondatabase/mcp-server-neon/lib/oauth/upstream-oauth/UpstreamOAuth', {
  make: Effect.gen(function* () {
    const config = yield* ServerConfig;

    return {
      authorizationUrl: ({ state }: { readonly state: string }) =>
        upstream('authorizationUrl', async () => upstreamAuth(config, state)),
      exchangeCode: ({
        currentUrl,
        state,
      }: {
        readonly currentUrl: URL;
        readonly state: string;
      }) =>
        upstream('exchangeCode', async () =>
          exchangeCode(config, currentUrl, state),
        ),
      exchangeRefreshToken: ({
        refreshToken,
        onRequest,
      }: {
        readonly refreshToken: string;
        readonly onRequest: (summary: UpstreamRequestSummary) => void;
      }) =>
        upstream('exchangeRefreshToken', async (signal) =>
          exchangeRefreshToken(config, refreshToken, { signal, onRequest }),
        ),
    };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
