import { DateTime, Effect, Layer } from 'effect';
import {
  HttpMiddleware,
  HttpRouter,
  HttpServer,
  HttpServerResponse,
} from 'effect/http';
import { SentryLayer } from '../../mcp/sentry/effect';
import pkg from '../../package.json';

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
const routes = Layer.mergeAll(
  HttpRouter.add('GET', '/api/health', health),
  HttpRouter.add('GET', '/health', health),
);

// Sentry's HTTP integration already opens the request span, with the header
// and query redaction in mcp/sentry/instrument.ts. Effect's server span would
// record request headers and the full URL, and would take its parent from a
// client's traceparent header, which Sentry's span doesn't follow.
const withoutServerSpan = Layer.succeed(HttpMiddleware.TracerDisabledWhen)(
  () => true,
);

// Built once per instance; Next.js route handlers forward their requests here.
// Request fibers run with this layer's output, so the tracer and error reporter
// are merged in rather than provided to the routes.
export const app = HttpRouter.toWebHandler(
  Layer.mergeAll(routes, SentryLayer, withoutServerSpan).pipe(
    Layer.provide(HttpServer.layerServices),
  ),
  { disableLogger: true },
);
