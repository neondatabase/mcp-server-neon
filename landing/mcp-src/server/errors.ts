import { isAxiosError } from 'axios';
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

export function isClientError(
  error: unknown,
): error is InvalidArgumentError | NotFoundError {
  return (
    error instanceof InvalidArgumentError || error instanceof NotFoundError
  );
}

export function errorResponse(error: unknown) {
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
  } else if (
    isAxiosError(error) &&
    error.response?.status &&
    error.response?.status < 500
  ) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: error.response.data.message,
        },
        {
          type: 'text' as const,
          text: `[${error.response.statusText}] ${error.message}`,
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
