import { randomUUID } from 'node:crypto';
import type { McpHandlerOptions } from 'mcp-handler';
import { Effect } from 'effect';
import { Analytics } from '../analytics/analytics-service';
import { reportServerFailure } from '../sentry/effect';
import { agentSentryTags } from '../sentry/utils';
import { logger } from '../utils/logger';
import { errorContexts } from './authenticated-session';
import type { ClientIdentity, ServerState } from './authenticated-session';
import type { createSdkErrorReporter } from './sdk-errors';
import { runSdkCallback } from './tool-call';

/**
 * Logs `notifications/initialized`. In the stateless transport that
 * notification arrives on its own request, whose server instance never saw
 * `initialize`, so no client info is known here; client identity comes from
 * each tool call instead.
 */
export const onInitialized = (client: ClientIdentity) => (): void => {
  logger.info('MCP oninitialized:', {
    hasName: false,
    currentClientName: client.identified.clientName,
  });
};

// Sentry's own event id format, so the analytics event names the Sentry event.
const sentryEventId = (): string => randomUUID().replaceAll('-', '');

const serverError = (
  error: Error,
  client: ClientIdentity,
  state: ServerState,
) =>
  Effect.gen(function* () {
    const { message } = error;
    const context = state.lastKnownContext;
    const contexts = errorContexts(state);
    const eventId = sentryEventId();

    yield* Effect.logError('Server error:').pipe(
      Effect.annotateLogs({ message, error }),
    );
    yield* reportServerFailure(error, {
      event_id: eventId,
      captureContext: {
        user: context === undefined ? undefined : { id: context.account.id },
        contexts,
        tags: agentSentryTags(client.identified),
      },
    });

    const analytics = yield* Analytics;

    yield* analytics.track({
      userId: context?.account.id ?? 'unknown',
      event: 'server_error',
      properties: {
        authMethod: context?.authMethod ?? 'unknown',
        message,
        error,
        eventId,
      },
      context: contexts,
    });
  });

/** The SDK's protocol errors, which arrive outside any request handler. */
export const onServerError =
  (
    client: ClientIdentity,
    state: ServerState,
    sdkErrors: ReturnType<typeof createSdkErrorReporter>,
  ) =>
  (error: Error): void => {
    sdkErrors.onProtocolError(error, () => {
      runSdkCallback(serverError(error, client, state));
    });
  };

const isConnectionLost = (error: Error | string): boolean =>
  (error instanceof Error ? error.message : error).includes(
    'No connection established',
  );

export const authenticatedEvents =
  (
    sdkErrors: ReturnType<typeof createSdkErrorReporter>,
  ): NonNullable<McpHandlerOptions['onEvent']> =>
  (event) => {
    if (event.type === 'ERROR' && isConnectionLost(event.error)) {
      logger.warn('MCP connection lost', {
        source: event.source,
        severity: event.severity,
        context: event.context,
      });

      return;
    }

    if (event.type === 'ERROR') {
      sdkErrors.onError(event);

      return;
    }

    if (event.type === 'REQUEST_COMPLETED' && event.status === 'error') {
      logger.warn('MCP request failed', {
        method: event.method,
        duration: event.duration,
      });
    }
  };
