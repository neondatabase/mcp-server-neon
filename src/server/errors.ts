import { isAxiosError } from 'axios';
import { NeonDbError } from '@neondatabase/serverless';
import { logger } from '../utils/logger.js';
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
        text: error instanceof Error ? error.message : 'Unknown error',
      },
      { type: 'text' as const, text: JSON.stringify(error, null, 2) },
    ],
  };
}

export function handleToolError(
  error: unknown,
  properties: Record<string, string>,
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
          text: error.response?.data.message || error.message,
        },
      ],
    };
  } else {
    logger.error('Tool call error:', { error, properties });
    captureException(error, { extra: properties });
    return errorResponse(error);
  }
}
