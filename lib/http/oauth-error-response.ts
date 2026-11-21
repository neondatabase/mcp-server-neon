import { Effect } from 'effect';
import { HttpServerResponse } from 'effect/http';
import type { HttpServerError } from 'effect/http';
import { oauthServerErrorResponse } from '../oauth/oauth-server-fault';

/** An RFC 6749 error body: `{ error, error_description }`. */
export const oauthErrorResponse = (
  status: number,
  error: string,
  description: string,
) =>
  HttpServerResponse.jsonUnsafe(
    { error, error_description: description },
    { status },
  );

/**
 * The request body could not be read, usually because the client dropped the
 * connection mid-upload. It keeps the OAuth `server_error` answer these
 * endpoints always gave it, but it is the connection's failure, not the
 * server's, so it stays out of Sentry.
 */
export const unreadableBodyResponse = (
  error: HttpServerError.HttpServerError,
) =>
  Effect.logWarning('Request body could not be read').pipe(
    Effect.annotateLogs({ reason: error.reason._tag }),
    Effect.andThen(
      Effect.annotateCurrentSpan({ 'error.type': 'RequestBodyUnreadable' }),
    ),
    Effect.as(oauthServerErrorResponse()),
  );
