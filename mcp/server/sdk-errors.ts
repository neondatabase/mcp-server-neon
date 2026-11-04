import { captureException } from '@sentry/node';
import type { McpHandlerOptions } from 'mcp-handler';
import { logger } from '../utils/logger';

type McpErrorEvent = Extract<
  Parameters<NonNullable<McpHandlerOptions['onEvent']>>[0],
  { type: 'ERROR' }
>;

/**
 * mcp-handler forwards every SDK `onerror` report as severity `error`. The SDK
 * reports requests it rejects with a 4xx the same way as its own 500s, and it
 * reports both before the response exists, so only the response status tells a
 * client error from a server failure. Anything reported after the response is
 * a failure while streaming it.
 */
export function createSdkErrorReporter(tags: () => Record<string, string>) {
  const pending: McpErrorEvent[] = [];
  let settled = false;

  function report(event: McpErrorEvent, status: number | undefined) {
    const error =
      event.error instanceof Error
        ? event.error
        : new Error(String(event.error));
    if (status !== undefined && status < 500) {
      // Rejection messages quote the request, which can carry credentials.
      logger.warn('MCP SDK rejected request', {
        status,
        source: event.source,
        errorName: error.name,
      });
      return;
    }
    logger.error('MCP SDK error', {
      message: error.message,
      stack: error.stack,
      source: event.source,
      severity: event.severity,
      context: event.context,
      status,
    });
    captureException(error, {
      tags: tags(),
      extra: { source: event.source, severity: event.severity, status },
    });
  }

  function settle(status: number) {
    settled = true;
    for (const event of pending.splice(0)) {
      report(event, status);
    }
  }

  return {
    onError(event: McpErrorEvent) {
      if (settled) {
        report(event, undefined);
      } else {
        pending.push(event);
      }
    },
    async settleAfter(response: Promise<Response>): Promise<Response> {
      try {
        const resolved = await response;
        settle(resolved.status);
        return resolved;
      } catch (error) {
        settle(500);
        throw error;
      }
    },
  };
}
