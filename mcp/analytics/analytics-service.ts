import { waitUntil } from '@vercel/functions';
import { Context, Effect, Layer } from 'effect';
import { flushAnalytics, identify, track } from './analytics';
import type { IdentifyAccount, IdentifyParams, TrackParams } from './analytics';

/**
 * Segment product analytics for Effect code. Each call is flushed after the
 * response through `waitUntil`, so a serverless function that returns first
 * still delivers it.
 */
export class Analytics extends Context.Service<
  Analytics,
  {
    readonly track: (event: TrackParams) => Effect.Effect<void>;
    readonly identify: (input: {
      readonly account: IdentifyAccount;
      readonly params: IdentifyParams;
    }) => Effect.Effect<void>;
  }
>()('@neondatabase/mcp-server-neon/mcp/analytics/analytics-service/Analytics', {
  make: Effect.succeed({
    track: Effect.fn('Analytics.track')(function* (event: TrackParams) {
      yield* Effect.annotateCurrentSpan({ 'analytics.event': event.event });
      yield* Effect.sync(() => {
        track(event);
        waitUntil(flushAnalytics());
      });
    }),
    identify: Effect.fn('Analytics.identify')(function* (input: {
      readonly account: IdentifyAccount;
      readonly params: IdentifyParams;
    }) {
      yield* Effect.sync(() => {
        identify(input.account, input.params);
        waitUntil(flushAnalytics());
      });
    }),
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
