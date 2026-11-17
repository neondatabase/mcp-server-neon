import { NeonApiError, NeonClientError } from '@neon/sdk';
import { NeonDbError } from '@neondatabase/serverless';
import { ZodError } from 'zod';
import { logger } from '../utils/logger';
import { captureException } from '@sentry/node';
import { agentSentryTags } from '../sentry/utils';
import type { IdentifiedClient } from '../utils/client-application';

export class InvalidArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidArgumentError';
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

class ToolCallCancelledError extends Error {
  constructor() {
    super('The client cancelled the tool call.');
    this.name = 'ToolCallCancelledError';
  }
}

function isClientError(error: unknown): boolean {
  return (
    error instanceof InvalidArgumentError ||
    error instanceof NotFoundError ||
    error instanceof ToolCallCancelledError ||
    error instanceof ZodError ||
    error instanceof NeonClientError
  );
}

const POSTGRES_ERROR_FIELDS = [
  ['code', 'SQLSTATE'],
  ['position', 'POSITION'],
  ['detail', 'DETAIL'],
  ['hint', 'HINT'],
  ['where', 'CONTEXT'],
] as const;

type NeonApiErrorField = {
  /** Label of the line in the tool result. */
  label: string;
  /** Key in the Sentry event's `extra` and in the error log. */
  key: string;
  value: string;
};

/**
 * What identifies a failed Neon API request. A server error's message is
 * whatever the API wrote, which can say nothing at all, so the status and
 * request id are what a user can act on or quote to Neon support. Never the
 * response body: it can quote user data, such as a Neon Auth user's email.
 */
const neonApiErrorFields = (error: NeonApiError): NeonApiErrorField[] =>
  [
    { label: 'HTTP status', key: 'neonApiStatus', value: String(error.status) },
    { label: 'Code', key: 'neonErrorCode', value: error.code ?? '' },
    { label: 'Request ID', key: 'neonRequestId', value: error.requestId ?? '' },
  ].filter(({ value }) => value !== '');

/** The Sentry tags and `extra` fields of a server error; `extra` is logged too. */
const serverErrorReport = (agent: IdentifiedClient, apiError?: NeonApiError) =>
  apiError === undefined
    ? { tags: agentSentryTags(agent), extra: {} }
    : {
        tags: {
          ...agentSentryTags(agent),
          'neon.api.status': String(apiError.status),
        },
        extra: Object.fromEntries(
          neonApiErrorFields(apiError).map(({ key, value }) => [key, value]),
        ),
      };

function errorText(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'Unknown error';
  }
  const lines = [`${error.name}: ${error.message}`];
  if (error instanceof NeonDbError) {
    for (const [field, label] of POSTGRES_ERROR_FIELDS) {
      const value = error[field];
      if (value) {
        lines.push(`${label}: ${value}`);
      }
    }
  }

  if (error instanceof NeonApiError) {
    lines.push(
      ...neonApiErrorFields(error).map(
        ({ label, value }) => `${label}: ${value}`,
      ),
    );
  }
  return lines.join('\n');
}

function errorResponse(error: unknown) {
  return {
    isError: true,
    content: [{ type: 'text' as const, text: errorText(error) }],
  };
}

/** What a tool call the client cancelled renders as. */
export const cancelledToolResult = () =>
  errorResponse(new ToolCallCancelledError());

function apiErrorReason(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null || !('reason' in body)) {
    return undefined;
  }
  return typeof body.reason === 'string' ? body.reason : undefined;
}

/**
 * Whether a thrown tool error is the server's failure rather than a mistake in
 * the call (bad input, a statement Postgres rejected, a 4xx from the Neon API).
 * Only these mark the tool span as failed.
 */
export function isServerError(error: unknown): boolean {
  // The driver copies a SQLSTATE only from Postgres's answer; a NeonDbError
  // without one is a failure to reach or read from the SQL endpoint.
  if (error instanceof NeonDbError) return !error.code;
  return !(
    isClientError(error) ||
    (error instanceof NeonApiError && error.status < 500)
  );
}

export function handleToolError(
  error: unknown,
  properties: Record<string, string>,
  traceId: string | undefined,
  agent: IdentifiedClient,
) {
  if (error instanceof NeonDbError || isClientError(error)) {
    return errorResponse(error);
  } else if (error instanceof NeonApiError && error.status < 500) {
    const reason = apiErrorReason(error.body);
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: error.message,
        },
        {
          type: 'text' as const,
          text: `[HTTP ${error.status}] ${error.message}${reason ? ` (reason: ${reason})` : ''}`,
        },
      ],
    };
  } else {
    const report = serverErrorReport(
      agent,
      error instanceof NeonApiError ? error : undefined,
    );

    const errorContext = {
      ...properties,
      ...(traceId && { traceId }),
      ...report.extra,
    };

    logger.error('Tool call error:', {
      error:
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : 'Unknown error',
      ...errorContext,
    });
    captureException(error, { extra: errorContext, tags: report.tags });
    return errorResponse(error);
  }
}
