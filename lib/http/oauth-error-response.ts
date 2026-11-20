import { HttpServerResponse } from 'effect/http';

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
