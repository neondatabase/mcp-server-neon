import { waitUntil } from '@vercel/functions';
import { Context, Effect, Layer } from 'effect';
import { flushAnalytics, track } from './analytics';
import type { TrackParams } from './analytics';

/**
 * Segment product analytics for Effect code. Each event is flushed after the
 * response through `waitUntil`, so a serverless function that returns first
 * still delivers it.
 */
export class Analytics extends Context.Service<
  Analytics,
  { readonly track: (event: TrackParams) => Effect.Effect<void> }
>()('@neondatabase/mcp-server-neon/mcp/analytics/analytics-service/Analytics', {
  make: Effect.succeed({
    track: Effect.fn('Analytics.track')(function* (event: TrackParams) {
      yield* Effect.sync(() => {
        track(event);
        waitUntil(flushAnalytics());
      });
    }),
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
