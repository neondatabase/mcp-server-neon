import { Option, Schema } from 'effect';
import { HttpServerResponse } from 'effect/http';
import { ClientMetadataUnavailableError } from './client-id-metadata-document';
import { extractUpstreamErrorDetails } from './upstream-error';

// oauth4webapi error codes. Importing the constants through openid-client
// isn't tree-shakeable for the bundle; the string values are part of its
// public API.
const OAUTH_RESPONSE_BODY_ERROR = 'OAUTH_RESPONSE_BODY_ERROR';
const OAUTH_RESPONSE_IS_NOT_CONFORM = 'OAUTH_RESPONSE_IS_NOT_CONFORM';

type OAuthErrorAnswer = {
  readonly status: number;
  readonly error: string;
  readonly description: string | undefined;
  readonly headers?: Readonly<Record<string, string>>;
};

// The fields openid-client puts on its errors.
const ErrorFields = Schema.Struct({
  code: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
  error_description: Schema.optional(Schema.String),
});

type ErrorFields = typeof ErrorFields.Type;

const fieldsOf = (error: Error): ErrorFields =>
  Schema.decodeUnknownOption(ErrorFields)(error).pipe(
    Option.getOrElse((): ErrorFields => ({})),
  );

const upstreamBodyAnswer = (
  error: Error,
  fields: ErrorFields,
): OAuthErrorAnswer => {
  const status = extractUpstreamErrorDetails(error).status ?? 500;

  return {
    status: status >= 500 ? 502 : 400,
    error: fields.error ?? 'upstream_error',
    description: fields.error_description,
  };
};

const notConformAnswer = (error: Error): OAuthErrorAnswer => {
  const { status } = extractUpstreamErrorDetails(error);

  return {
    status: 502,
    error: 'upstream_error',
    description: `Upstream returned a non-conforming response${
      status === undefined ? '' : ` (status=${status})`
    }`,
  };
};

/**
 * The answer an OAuth endpoint gives for a failure: a conforming upstream
 * OAuth error is relayed (4xx as 400, 5xx as 502), a non-conforming or
 * unreachable upstream is 502, an unreadable client metadata document is 503,
 * a JSON parse error is 400, and anything else is `server_error`.
 */
export const oauthErrorAnswer = (error: Error): OAuthErrorAnswer => {
  const fields = fieldsOf(error);
  const { code } = fields;
  const { message } = error;

  if (code === OAUTH_RESPONSE_BODY_ERROR) {
    return upstreamBodyAnswer(error, fields);
  }

  if (code === OAUTH_RESPONSE_IS_NOT_CONFORM) {
    return notConformAnswer(error);
  }

  // Not `invalid_client`: the client's credentials may be fine, and telling
  // it otherwise during its own host's outage would make it discard them.
  if (error instanceof ClientMetadataUnavailableError) {
    return {
      status: 503,
      error: 'temporarily_unavailable',
      description: 'Could not read the client ID metadata document',
      headers: { 'Retry-After': '30' },
    };
  }

  if (error instanceof TypeError && message.includes('fetch')) {
    return {
      status: 502,
      error: 'upstream_unavailable',
      description: 'Failed to connect to authorization server',
    };
  }

  if (error instanceof SyntaxError && message.includes('JSON')) {
    return {
      status: 400,
      error: 'invalid_request',
      description: 'Invalid JSON in request body',
    };
  }

  return {
    status: 500,
    error: 'server_error',
    description: 'Internal server error',
  };
};

export const oauthErrorAnswerResponse = (answer: OAuthErrorAnswer) =>
  HttpServerResponse.jsonUnsafe(
    { error: answer.error, error_description: answer.description },
    { status: answer.status, headers: answer.headers },
  );
