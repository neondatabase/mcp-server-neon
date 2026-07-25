import { NeonApiError } from '@neon/sdk';
import { NeonDbError } from '@neondatabase/serverless';
import { logger } from '../utils/logger';
import { captureException } from '@sentry/node';

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

type NonJsonResponseDetails = {
  status: number;
  statusText: string;
  contentType: string | null;
  bodySnippet: string;
};

/**
 * An upstream response whose body could not be parsed as JSON, typically an HTML
 * error page served by the edge in front of the API.
 *
 * It carries the HTTP context that a bare `SyntaxError` from `JSON.parse` discards,
 * so the layer that knows the API's semantics can decide whether the caller or the
 * backend is at fault. It is intentionally not a client error: left unclassified it
 * reaches Sentry, because an undecodable body is never something the LLM can fix.
 */
export class NonJsonResponseError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly contentType: string | null;
  readonly bodySnippet: string;

  constructor(details: NonJsonResponseDetails) {
    super(
      `Expected JSON but received ${details.contentType ?? 'an unknown content type'} (HTTP ${details.status}): ${details.bodySnippet}`,
    );
    this.name = 'NonJsonResponseError';
    this.status = details.status;
    this.statusText = details.statusText;
    this.contentType = details.contentType;
    this.bodySnippet = details.bodySnippet;
  }
}

function isClientError(
  error: unknown,
): error is InvalidArgumentError | NotFoundError {
  return (
    error instanceof InvalidArgumentError || error instanceof NotFoundError
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

export function handleToolError(
  error: unknown,
  properties: Record<string, string>,
  traceId?: string,
) {
  if (error instanceof NeonDbError || isClientError(error)) {
    return errorResponse(error);
  } else if (error instanceof NeonApiError && error.status < 500) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: error.message,
        },
        {
          type: 'text' as const,
          text: `[HTTP ${error.status}] ${error.message}`,
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
    captureException(error, { extra: errorContext });
    return errorResponse(error);
  }
}
