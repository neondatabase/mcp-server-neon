import { Layer } from 'effect';
import { HttpMiddleware, HttpRouter, HttpServer } from 'effect/http';
import { SentryLayer } from '../../mcp/sentry/effect';
import { ServerConfigLayer } from '../config';
import { WinstonLoggerLayer } from '../effect/logger';
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

// Built once per instance; every Next.js route file forwards its requests
// here. Request fibers run with this layer's output, so the config, tracer,
// error reporter, and logger are merged in rather than provided to the routes.
export const app = HttpRouter.toWebHandler(
  Layer.mergeAll(
    Routes,
    ServerConfigLayer,
    SentryLayer,
    WinstonLoggerLayer,
    withoutServerSpan,
  ).pipe(Layer.provide(HttpServer.layerServices)),
  { disableLogger: true },
);
