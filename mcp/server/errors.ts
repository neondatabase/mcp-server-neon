import { NeonDbError } from '@neondatabase/serverless';
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

function isClientError(
  error: unknown,
): error is InvalidArgumentError | NotFoundError {
  return (
    error instanceof InvalidArgumentError || error instanceof NotFoundError
  );
}

type NeonApiErrorLike = Error & {
  kind: 'api' | 'not_found' | 'auth' | 'rate_limit';
  status: number;
  body: unknown;
};

function isNeonApiError(error: unknown): error is NeonApiErrorLike {
  if (!(error instanceof Error)) return false;
  if (!('kind' in error) || !('status' in error) || !('body' in error)) {
    return false;
  }
  const kind = error.kind;
  return (
    (kind === 'api' ||
      kind === 'not_found' ||
      kind === 'auth' ||
      kind === 'rate_limit') &&
    typeof error.status === 'number' &&
    Number.isInteger(error.status)
  );
}

function errorResponse(error: unknown) {
  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text:
          error instanceof Error
            ? `${error.name}: ${error.message}`
            : 'Unknown error',
      },
    ],
  };
}

function apiErrorReason(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null || !('reason' in body)) {
    return undefined;
  }
  return typeof body.reason === 'string' ? body.reason : undefined;
}

export function handleToolError(
  error: unknown,
  properties: Record<string, string>,
  traceId: string | undefined,
  agent: IdentifiedClient,
) {
  if (error instanceof NeonDbError || isClientError(error)) {
    return errorResponse(error);
  } else if (isNeonApiError(error) && error.status < 500) {
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
