import type { McpHandlerOptions } from 'mcp-handler';
import { Cause, Effect, Exit } from 'effect';
import { runAfterResponse } from '../../lib/effect/runtime';
import type { McpCallbackServices } from '../../lib/effect/runtime';
import { reportServerFailure } from '../sentry/effect';
import { flushSentry } from '../sentry/flush';

type McpErrorEvent = Extract<
  Parameters<NonNullable<McpHandlerOptions['onEvent']>>[0],
  { type: 'ERROR' }
>;

type SentryTags = () => Record<string, string>;

type HeldReport = (status: number) => Effect.Effect<void>;

// Rejection messages quote the request, which can carry credentials.
const logRejectedRequest = (status: number, source: string, error: Error) =>
  Effect.logWarning('MCP SDK rejected request').pipe(
    Effect.annotateLogs({ status, source, errorName: error.name }),
  );

const reportSdkError = (
  event: McpErrorEvent,
  status: number | undefined,
  tags: SentryTags,
) => {
  const error =
    event.error instanceof Error ? event.error : new Error(event.error);

  if (status !== undefined && status < 500) {
    return logRejectedRequest(status, event.source, error);
  }

  return Effect.logError('MCP SDK error').pipe(
    Effect.annotateLogs({
      message: error.message,
      stack: error.stack,
      source: event.source,
      severity: event.severity,
      context: event.context,
      status,
    }),
    Effect.andThen(
      reportServerFailure(error, {
        tags: tags(),
        extra: { source: event.source, severity: event.severity, status },
      }),
    ),
  );
};

// A report made once the request is over has no response flush behind it.
const reportAfterResponse = (
  report: Effect.Effect<void, never, McpCallbackServices>,
) => {
  runAfterResponse(report.pipe(Effect.andThen(flushSentry)));
};

/**
 * mcp-handler forwards every SDK `onerror` report as severity `error`. The SDK
 * reports requests it rejects with a 4xx the same way as its own 500s, and it
 * reports both before the response exists, so only the response status tells a
 * client error from a server failure. Anything reported after the response is
 * a failure while streaming it.
 *
 * The 2025-era transport reports what it rejects, such as a body that is not
 * JSON, to the server's own `onerror` instead, which `onProtocolError` holds
 * the same way.
 */
export const createSdkErrorReporter = (tags: SentryTags) => {
  const pending: HeldReport[] = [];
  const state = { settled: false };

  const settle = (status: number) =>
    Effect.suspend(() => {
      state.settled = true;

      return Effect.forEach(pending.splice(0), (report) => report(status), {
        discard: true,
      });
    });

  const settleWhenDone = (response: Promise<Response>) =>
    Effect.promise(async () => response).pipe(
      Effect.exit,
      Effect.flatMap(
        Exit.match({
          onSuccess: ({ status }) => settle(status),
          onFailure: () => settle(500),
        }),
      ),
    );

  return {
    onError: (event: McpErrorEvent): void => {
      if (state.settled) {
        reportAfterResponse(reportSdkError(event, undefined, tags));

        return;
      }

      pending.push((status) => reportSdkError(event, status, tags));
    },
    /**
     * Calls `report` unless the response is a 4xx. A protocol error behind a
     * 2xx, such as a failing notification handler, was never answered as a
     * rejection, so it still counts as a server failure.
     */
    onProtocolError: (error: Error, report: () => void): void => {
      if (state.settled) {
        report();

        return;
      }

      pending.push((status) =>
        status >= 400 && status < 500
          ? logRejectedRequest(status, 'protocol', error)
          : Effect.sync(report),
      );
    },
    /**
     * Waits for mcp-handler's response and reports the events held for it once
     * its status is known. A client that disconnects interrupts the wait, but
     * the response still settles, and the held events are reported then.
     */
    settleAfter: (response: Promise<Response>) =>
      Effect.promise(async () => response).pipe(
        Effect.onExit(
          Exit.match({
            onSuccess: ({ status }) => settle(status),
            onFailure: (cause) =>
              Cause.hasInterruptsOnly(cause)
                ? Effect.sync(() => {
                    reportAfterResponse(settleWhenDone(response));
                  })
                : settle(500),
          }),
        ),
      ),
  };
};
