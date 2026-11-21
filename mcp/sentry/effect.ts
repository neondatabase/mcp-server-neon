import { layerGlobal } from '@effect/opentelemetry/OtelTracer';
import { captureException } from '@sentry/node';
import { Cause, Context, Effect, ErrorReporter, Layer } from 'effect';

type CaptureContext = NonNullable<Parameters<typeof captureException>[1]>;

// Scope data (tags, extra, user) for the events one report sends.
const ReportCaptureContext = Context.Reference<CaptureContext | undefined>(
  '@neondatabase/mcp-server-neon/mcp/sentry/effect/ReportCaptureContext',
  { defaultValue: () => undefined },
);

// Sentry registers the global OpenTelemetry tracer provider in instrument.ts,
// so Effect spans become Sentry spans, nested under the active request span.
// Effect's HTTP server reports every unhandled cause here; errors that are the
// caller's mistake set `[ErrorReporter.ignore] = true` to stay out of Sentry.
export const SentryLayer = Layer.merge(
  layerGlobal,
  ErrorReporter.layer([
    ErrorReporter.make(({ cause, error, fiber }) => {
      const context = fiber.getRef(ReportCaptureContext);

      if (context === undefined) {
        captureException(error);

        return;
      }

      // An explicit report sends the error it was given rather than Effect's
      // rendering of it, so its stack, and the issue it groups into, stay its own.
      captureException(Cause.squash(cause), context);
    }),
  ]),
);

/**
 * Sends a server failure that never reaches an Effect boundary to Sentry
 * through the error reporter, with Sentry scope data for that one event. The
 * reporter never sends the same error object twice.
 */
export const reportServerFailure = (error: Error, context: CaptureContext) =>
  ErrorReporter.report(Cause.fail(error)).pipe(
    Effect.provideService(ReportCaptureContext, context),
  );
