import { Layer } from 'effect';
import { HttpMiddleware, HttpRouter, HttpServer } from 'effect/http';
import { SentryLayer } from '../../mcp/sentry/effect';
import { ServerConfig } from '../config';
import { WinstonLoggerLayer } from '../effect/logger';
import { memoMap } from '../effect/runtime';
import { DiscoveryRoutes } from './routes/discovery';
import { HealthRoutes } from './routes/health';
import { ListToolsRoutes } from './routes/list-tools';

const Routes = Layer.mergeAll(HealthRoutes, DiscoveryRoutes, ListToolsRoutes);

// Sentry's HTTP integration already opens the request span, with the header
// and query redaction in mcp/sentry/instrument.ts. Effect's server span would
// record request headers and the full URL, and would take its parent from a
// client's traceparent header, which Sentry's span doesn't follow.
const withoutServerSpan = Layer.succeed(HttpMiddleware.TracerDisabledWhen)(
  () => true,
);

/**
 * A web handler for `routes`. Request fibers run with this layer's output, so
 * the config, tracer, error reporter, and logger are merged in rather than
 * provided to the routes, as are any services `routes` itself outputs. Every
 * handler builds from the shared memo map.
 */
export const webHandlerFor = <
  A,
  E,
  R extends
    | HttpRouter.HttpRouter
    | HttpRouter.Request<'Requires', unknown>
    | HttpRouter.Request<'Error', unknown>,
>(
  routes: Layer.Layer<A, E, R>,
) =>
  HttpRouter.toWebHandler(
    Layer.mergeAll(
      routes,
      ServerConfig.layer,
      SentryLayer,
      WinstonLoggerLayer,
      withoutServerSpan,
    ).pipe(Layer.provide(HttpServer.layerServices)),
    { disableLogger: true, memoMap },
  );

// Built once per instance; every Next.js route file except the MCP transport
// forwards its requests here.
export const app = webHandlerFor(Routes);
