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

function isClientError(error: unknown): boolean {
  return (
    error instanceof InvalidArgumentError ||
    error instanceof NotFoundError ||
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
  return lines.join('\n');
}

function errorResponse(error: unknown) {
  return {
    isError: true,
    content: [{ type: 'text' as const, text: errorText(error) }],
  };
}

function apiErrorReason(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null || !('reason' in body)) {
    return undefined;
  }
  return typeof body.reason === 'string' ? body.reason : undefined;
}

/**
 * Whether a thrown tool error is the server's failure rather than a mistake in
 * the call (bad input, bad SQL, a 4xx from the Neon API). Only these are
 * reported to Sentry and mark the tool span as failed.
 */
export function isServerError(error: unknown): boolean {
  return !(
    error instanceof NeonDbError ||
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
    const errorContext = { ...properties, ...(traceId && { traceId }) };
    logger.error('Tool call error:', {
      error:
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : 'Unknown error',
      ...errorContext,
    });
    captureException(error, {
      extra: errorContext,
      tags: agentSentryTags(agent),
    });
    return errorResponse(error);
  }
}
