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

type NeonApiErrorDetails = {
  neonApiStatus: string;
  neonApiCode?: string;
  neonApiRequestId?: string;
  neonApiRetryAfter?: string;
};

const neonApiErrorDetails = (error: NeonApiError): NeonApiErrorDetails => {
  const details: NeonApiErrorDetails = { neonApiStatus: String(error.status) };

  if (error.code !== undefined && error.code !== '') {
    details.neonApiCode = error.code;
  }

  if (error.requestId !== undefined && error.requestId !== '') {
    details.neonApiRequestId = error.requestId;
  }

  const retryAfter = error.response?.headers.get('retry-after');

  if (retryAfter !== undefined && retryAfter !== null && retryAfter !== '') {
    details.neonApiRetryAfter = retryAfter;
  }

  return details;
};

const neonApiErrorLines = ({
  neonApiStatus,
  neonApiCode,
  neonApiRequestId,
  neonApiRetryAfter,
}: NeonApiErrorDetails) =>
  [
    `HTTP status: ${neonApiStatus}`,
    neonApiCode === undefined ? undefined : `Code: ${neonApiCode}`,
    neonApiRequestId === undefined
      ? undefined
      : `Request ID: ${neonApiRequestId}`,
    neonApiRetryAfter === undefined
      ? undefined
      : `Retry-After: ${neonApiRetryAfter}`,
  ].filter((line) => line !== undefined);

const serverErrorTags = (
  agent: IdentifiedClient,
  apiDetails: NeonApiErrorDetails | undefined,
) =>
  apiDetails === undefined
    ? agentSentryTags(agent)
    : {
        ...agentSentryTags(agent),
        'neon.api.status': apiDetails.neonApiStatus,
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
    const action = BILLING_ERROR_ACTIONS.get('SPEND_CAP_EXCEEDED');

    if (
      error.code === '57P03' &&
      error.detail?.includes('SPEND_CAP_EXCEEDED') === true &&
      action !== undefined
    ) {
      lines.push(action);
    }
  }

  if (error instanceof NeonApiError) {
    lines.push(...neonApiErrorLines(neonApiErrorDetails(error)));
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

const apiClientErrorResponse = (error: NeonApiError) => {
  const reason = apiErrorReason(error.body);

  const response = {
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

  const action = BILLING_ERROR_ACTIONS.get(error.code ?? '');

  if (action === undefined) {
    return response;
  }

  // SDK 1.x validates present structured content against the success schema,
  // even for errors. Keep denial details in text so those clients receive them.
  return {
    ...response,
    content: [
      ...response.content,
      { type: 'text' as const, text: `Code: ${error.code}\n${action}` },
    ],
  };
};

const BILLING_ERROR_ACTIONS = new Map([
  [
    'SPEND_CAP_EXCEEDED',
    'An Organization Admin can increase or disable the spend cap in Organization Billing. Storage charges continue; recovery is asynchronous and other restrictions can remain.',
  ],
  [
    'INSUFFICIENT_ORG_PERMISSIONS',
    'An Organization Admin must perform this action.',
  ],
]);

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

// Only an unreachable endpoint (`sourceError`) or an answer the driver couldn't
// read is surely the server's: an HTTP error answer, 5xx included, can carry
// the caller's condition, such as a quota or a role that can't log in.
const isSqlEndpointFailure = (error: NeonDbError) =>
  (error.code === undefined || error.code === '') &&
  (error.sourceError !== undefined ||
    error.message.startsWith('Neon internal error'));

export function handleToolError(
  error: unknown,
  properties: Record<string, string>,
  traceId: string | undefined,
  agent: IdentifiedClient,
) {
  if (
    isClientError(error) ||
    (error instanceof NeonDbError && !isSqlEndpointFailure(error))
  ) {
    return errorResponse(error);
  } else if (error instanceof NeonApiError && error.status < 500) {
    return apiClientErrorResponse(error);
  } else {
    const apiDetails =
      error instanceof NeonApiError ? neonApiErrorDetails(error) : undefined;

    const errorContext = {
      ...properties,
      ...(traceId && { traceId }),
      ...apiDetails,
    };

    logger.error('Tool call error:', {
      error:
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : 'Unknown error',
      ...errorContext,
    });

    captureException(error, {
      extra: errorContext,
      tags: serverErrorTags(agent, apiDetails),
    });

    return errorResponse(error);
  }
}
