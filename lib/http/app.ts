import { DateTime, Effect, Layer } from 'effect';
import { HttpRouter, HttpServer, HttpServerResponse } from 'effect/http';
import pkg from '../../package.json';

const health = Effect.gen(function* () {
  const now = yield* DateTime.now;

  return yield* HttpServerResponse.json({
    status: 'ok',
    version: pkg.version,
    timestamp: DateTime.formatIso(now),
  });
});

// A next.config.ts rewrite keeps the original URL, so the router sees /health
// for the alias.
const routes = Layer.mergeAll(
  HttpRouter.add('GET', '/api/health', health),
  HttpRouter.add('GET', '/health', health),
);

// Built once per instance; Next.js route handlers forward their requests here.
export const app = HttpRouter.toWebHandler(
  routes.pipe(Layer.provide(HttpServer.layerServices)),
  { disableLogger: true },
);
