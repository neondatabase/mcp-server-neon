import { Context, Effect, Layer, Option } from 'effect';
import type { Client } from 'oauth2-server';
import type { RefreshFailure, RefreshResult } from './kv-store';
import { model } from './model';
import type { OAuthStoreUnavailable } from './oauth-store-unavailable';
import {
  getOwnedRefreshResult,
  resolveOwnedRotation,
  resolveRotation,
} from './refresh-result';
import type { RotationOutcome } from './refresh-result';
import { stored } from './stored';

type TokenOfClient = {
  readonly refreshToken: string;
  readonly client: Client;
};

/**
 * The refresh-result and refresh-failure caches: what a refresh token's
 * earlier rotation or rejection answers now. The lookups that only shortcut a
 * refresh answer None when the store can't say, so the refresh goes on.
 */
export class RefreshRotations extends Context.Service<
  RefreshRotations,
  {
    /** The outcome of `client`'s own cached rotation of `refreshToken`. */
    readonly resolveOwned: (
      input: TokenOfClient,
    ) => Effect.Effect<Option.Option<RotationOutcome>, OAuthStoreUnavailable>;
    /** The pair `client`'s own cached rotation serves now. */
    readonly ownedResult: (
      input: TokenOfClient,
    ) => Effect.Effect<Option.Option<RefreshResult>>;
    /**
     * Another client presenting a rotated token records it as missing, so a
     * cached failure can belong to the owner's own rotation. Rows without a
     * client are not attributed here, so a cached failure keeps absorbing
     * retries instead of walking their rotation chain each time.
     */
    readonly attributedOutcome: (
      input: TokenOfClient,
    ) => Effect.Effect<Option.Option<RotationOutcome>>;
    /** A cached failure that rejects `client`'s use of `refreshToken`. */
    readonly cachedFailure: (
      input: TokenOfClient,
    ) => Effect.Effect<Option.Option<RefreshFailure>>;
    readonly recordFailure: (input: {
      readonly refreshToken: string;
      readonly failure: RefreshFailure;
    }) => Effect.Effect<void, OAuthStoreUnavailable>;
    readonly recordResult: (input: {
      readonly refreshToken: string;
      readonly result: RefreshResult;
    }) => Effect.Effect<void, OAuthStoreUnavailable>;
  }
>()(
  '@neondatabase/mcp-server-neon/mcp/oauth/refresh-rotations/RefreshRotations',
  {
    make: Effect.succeed({
      resolveOwned: ({ refreshToken, client }: TokenOfClient) =>
        stored('resolveOwnedRotation', async () =>
          resolveOwnedRotation(refreshToken, client),
        ).pipe(
          Effect.map(Option.fromUndefinedOr),
          Effect.withSpan('RefreshRotations.resolveOwned'),
        ),

      ownedResult: ({ refreshToken, client }: TokenOfClient) =>
        stored('getOwnedRefreshResult', async () =>
          getOwnedRefreshResult(refreshToken, client),
        ).pipe(
          Effect.map(Option.fromUndefinedOr),
          Effect.catchTag('OAuthStoreUnavailable', () => Effect.succeedNone),
          Effect.withSpan('RefreshRotations.ownedResult'),
        ),

      attributedOutcome: Effect.fn('RefreshRotations.attributedOutcome')(
        function* ({ refreshToken, client }: TokenOfClient) {
          const rotation = yield* stored('getRefreshRotation', async () =>
            model.getRefreshRotation(refreshToken),
          ).pipe(
            Effect.map(Option.fromUndefinedOr),
            Effect.catchTag('OAuthStoreUnavailable', () => Effect.succeedNone),
          );

          if (
            Option.isNone(rotation) ||
            rotation.value.result.clientId !== client.id
          ) {
            return Option.none<RotationOutcome>();
          }

          return yield* stored('resolveRotation', async () =>
            resolveRotation(refreshToken, client, rotation.value),
          ).pipe(
            Effect.map(Option.fromUndefinedOr),
            Effect.catchTag('OAuthStoreUnavailable', ({ cause }) =>
              Effect.logWarning(
                'Failed to resolve a cached refresh rotation',
              ).pipe(
                Effect.annotateLogs({ error: cause }),
                Effect.as(Option.none<RotationOutcome>()),
              ),
            ),
          );
        },
      ),

      cachedFailure: ({ refreshToken, client }: TokenOfClient) =>
        stored('getRefreshFailure', async () =>
          model.getRefreshFailure(refreshToken),
        ).pipe(
          Effect.map((failure) =>
            Option.fromUndefinedOr(failure).pipe(
              Option.filter(
                ({ clientId }) =>
                  clientId === undefined || clientId === client.id,
              ),
            ),
          ),
          Effect.catchTag('OAuthStoreUnavailable', () => Effect.succeedNone),
          Effect.withSpan('RefreshRotations.cachedFailure'),
        ),

      recordFailure: ({
        refreshToken,
        failure,
      }: {
        readonly refreshToken: string;
        readonly failure: RefreshFailure;
      }) =>
        stored('saveRefreshFailure', async () =>
          model.saveRefreshFailure(refreshToken, failure),
        ),

      recordResult: ({
        refreshToken,
        result,
      }: {
        readonly refreshToken: string;
        readonly result: RefreshResult;
      }) =>
        stored('saveRefreshResult', async () =>
          model.saveRefreshResult(refreshToken, result),
        ),
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make);
}
