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

const reportSdkError = (
  event: McpErrorEvent,
  status: number | undefined,
  tags: SentryTags,
) => {
  const error =
    event.error instanceof Error ? event.error : new Error(event.error);

  if (status !== undefined && status < 500) {
    // Rejection messages quote the request, which can carry credentials.
    return Effect.logWarning('MCP SDK rejected request').pipe(
      Effect.annotateLogs({
        status,
        source: event.source,
        errorName: error.name,
      }),
    );
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
 */
export const createSdkErrorReporter = (tags: SentryTags) => {
  const pending: McpErrorEvent[] = [];
  const state = { settled: false };

  const settle = (status: number) =>
    Effect.suspend(() => {
      state.settled = true;

      return Effect.forEach(
        pending.splice(0),
        (event) => reportSdkError(event, status, tags),
        { discard: true },
      );
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

      pending.push(event);
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
