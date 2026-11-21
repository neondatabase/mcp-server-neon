import { Layer } from 'effect';
import { HttpMiddleware, HttpRouter, HttpServer } from 'effect/http';
import { SentryLayer } from '../../mcp/sentry/effect';
import { ServerConfig } from '../config';
import { WinstonLoggerLayer } from '../effect/logger';
import { flushSentryAfter, memoMap } from '../effect/runtime';
import { DiscoveryRoutes } from './routes/discovery';
import { HealthRoutes } from './routes/health';
import { ListToolsRoutes } from './routes/list-tools';
import { OAuthRoutes } from './routes/oauth';

const Routes = Layer.mergeAll(
  HealthRoutes,
  DiscoveryRoutes,
  ListToolsRoutes,
  OAuthRoutes,
);

// Sentry's HTTP integration already opens the request span, with the header
// and query redaction in mcp/sentry/instrument.ts. Effect's server span would
// record request headers and the full URL, and would take its parent from a
// client's traceparent header, which Sentry's span doesn't follow.
const withoutServerSpan = Layer.succeed(HttpMiddleware.TracerDisabledWhen)(
  () => true,
);

/**
 * What every request fiber runs with: config, tracer, error reporter, logger,
 * and the HTTP server services. Web handlers merge it with their routes rather
 * than providing it to them, and build from the shared memo map.
 */
export const AppLayer = Layer.mergeAll(
  ServerConfig.layer,
  SentryLayer,
  WinstonLoggerLayer,
  withoutServerSpan,
  HttpServer.layerServices,
);

const webHandler = HttpRouter.toWebHandler(Layer.merge(Routes, AppLayer), {
  disableLogger: true,
  memoMap,
});

// Built once per instance; every Next.js route file except the MCP transport
// (lib/http/mcp-app.ts) forwards its requests here. None of these routes
// stream a body, so the Sentry flush need not wait for one.
export const app = {
  handler: async (request: Request) =>
    flushSentryAfter(webHandler.handler(request)),
  dispose: webHandler.dispose,
};
