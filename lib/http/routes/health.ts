import { DateTime, Effect, Layer } from 'effect';
import { HttpRouter, HttpServerResponse } from 'effect/http';
import pkg from '../../../package.json';

const health = Effect.gen(function* () {
  const now = yield* DateTime.now;

  return yield* HttpServerResponse.json({
    status: 'ok',
    version: pkg.version,
    timestamp: DateTime.formatIso(now),
  });
}).pipe(Effect.withSpan('Health.check'));

// A next.config.ts rewrite keeps the original URL, so the router sees /health
// for the alias.
export const HealthRoutes = Layer.mergeAll(
  HttpRouter.add('GET', '/api/health', health),
  HttpRouter.add('GET', '/health', health),
);
