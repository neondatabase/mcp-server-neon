import { Cause, Effect, ErrorReporter, Predicate } from 'effect';
import type { HttpServerError } from 'effect/http';
import type { OAuthStoreUnavailable } from '../../../mcp/oauth/oauth-store-unavailable';
import { clientMetadataUnavailableResponse } from '../../oauth/client-metadata-unavailable';
import {
  oauthErrorAnswer,
  oauthErrorAnswerResponse,
} from '../../oauth/oauth-error';
import {
  OAuthServerFault,
  oauthServerErrorResponse,
} from '../../oauth/oauth-server-fault';

/** What a failure thrown inside the endpoint was, for its two log lines. */
const logThrown = (failure: { readonly cause: unknown }) => {
  const { cause } = failure;
  const message = cause instanceof Error ? cause.message : undefined;
  const code = Predicate.hasProperty(cause, 'code') ? cause.code : undefined;

  return Effect.logError('Token endpoint error').pipe(
    Effect.annotateLogs({
      error: message ?? String(cause),
      stack: cause instanceof Error ? cause.stack : undefined,
    }),
    Effect.andThen(
      Effect.logError('Token exchange error:').pipe(
        Effect.annotateLogs({
          message: message ?? 'Unknown error',
          code,
          error: cause,
        }),
      ),
    ),
  );
};

/** The OAuth answer the endpoint has always given a thrown `cause`. */
const thrownAnswer = (failure: { readonly cause: unknown }) =>
  failure.cause instanceof Error
    ? oauthErrorAnswerResponse(oauthErrorAnswer(failure.cause))
    : oauthServerErrorResponse();

// The client's failures: logged and answered inside the span, out of Sentry.
export const answeredInSpan = (
  failure: { readonly cause: unknown },
  type: string,
) =>
  logThrown(failure).pipe(
    Effect.andThen(Effect.annotateCurrentSpan({ 'error.type': type })),
    Effect.as(thrownAnswer(failure)),
  );

export const unreadableBody = (error: HttpServerError.HttpServerError) =>
  answeredInSpan(
    {
      cause: Predicate.hasProperty(error.reason, 'cause')
        ? error.reason.cause
        : error,
    },
    'RequestBodyUnreadable',
  );

// The server's failures fail the route span and reach Sentry once, keeping
// the answer the endpoint has always given them.
export const serverFailure = (
  failure: OAuthStoreUnavailable | OAuthServerFault,
) =>
  logThrown(failure).pipe(
    Effect.andThen(ErrorReporter.report(Cause.fail(failure))),
    Effect.as(thrownAnswer(failure)),
  );

export const metadataUnavailable = (outage: { readonly cause: unknown }) =>
  logThrown(outage).pipe(
    Effect.andThen(
      Effect.annotateCurrentSpan({ 'error.type': 'ClientMetadataUnavailable' }),
    ),
    Effect.as(clientMetadataUnavailableResponse()),
  );

export const defectAsFault = Effect.catchDefect((cause) =>
  Effect.fail(OAuthServerFault.make({ endpoint: 'token', cause })),
);
