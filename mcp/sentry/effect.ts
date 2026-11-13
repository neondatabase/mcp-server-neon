import { layerGlobal } from '@effect/opentelemetry/OtelTracer';
import { captureException } from '@sentry/node';
import { ErrorReporter, Layer } from 'effect';

// Sentry registers the global OpenTelemetry tracer provider in instrument.ts,
// so Effect spans become Sentry spans, nested under the active request span.
// Effect's HTTP server reports every unhandled cause here; errors that are the
// caller's mistake set `[ErrorReporter.ignore] = true` to stay out of Sentry.
export const SentryLayer = Layer.merge(
  layerGlobal,
  ErrorReporter.layer([
    ErrorReporter.make(({ error }) => {
      captureException(error);
    }),
  ]),
);
