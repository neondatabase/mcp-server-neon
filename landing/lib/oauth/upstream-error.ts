/**
 * Shared helper for normalising errors thrown by openid-client / oauth4webapi
 * calls into a structured shape we can log and act on.
 *
 * openid-client surfaces three relevant error families:
 *  - `OperationProcessingError` (code OAUTH_RESPONSE_IS_NOT_CONFORM, etc.) —
 *    used when the upstream HTTP response isn't a conforming OAuth response
 *    (e.g. Hydra returns 5xx with a non-JSON body). The original `Response`
 *    is attached as `error.cause`.
 *  - `ResponseBodyError` (code OAUTH_RESPONSE_BODY_ERROR) — used when the
 *    upstream response IS a conforming OAuth error (status 400 + JSON body
 *    `{error, error_description}`).
 *  - `AuthorizationResponseError` / generic errors — surfaced as `cause`.
 *
 * Previously this lived inline in app/api/token/route.ts and the callback
 * route's catch path logged `cause: "[object Response]"` — hiding the actual
 * upstream status code on the most common production error. Lifting it here
 * lets both /api/token and /callback share the same normalisation.
 */
type UpstreamErrorDetails = {
  name?: string;
  message?: string;
  /** Numeric HTTP status from the upstream Response, when available. */
  status?: number;
  /** OAuth `error` field from a conforming OAuth error body. */
  oauthError?: string;
  /** OAuth `error_description` field from a conforming OAuth error body. */
  oauthErrorDescription?: string;
  /** Upstream URL we called (extracted from the Response cause when present). */
  upstreamUrl?: string;
  /** Short stringified description of the underlying cause. */
  cause?: string;
};

export function extractUpstreamErrorDetails(
  error: unknown,
): UpstreamErrorDetails {
  if (!(error instanceof Error)) return { message: String(error) };
  const e = error as Error & {
    status?: unknown;
    error?: unknown;
    error_description?: unknown;
    cause?: unknown;
  };
  const asString = (v: unknown): string | undefined =>
    typeof v === 'string' ? v : undefined;
  const asNumber = (v: unknown): number | undefined =>
    typeof v === 'number' ? v : undefined;

  // openid-client's OperationProcessingError (notably the
  // OAUTH_RESPONSE_IS_NOT_CONFORM variant) carries the upstream HTTP
  // Response as `cause`. Walk that shape so we capture status + URL
  // instead of stringifying to "[object Response]".
  let status = asNumber(e.status);
  let upstreamUrl: string | undefined;
  let causeStr: string | undefined;
  if (e.cause instanceof Response) {
    status = status ?? e.cause.status;
    upstreamUrl = e.cause.url || undefined;
    causeStr = `Response status=${e.cause.status}`;
  } else if (e.cause instanceof Error) {
    causeStr = `${e.cause.name}: ${e.cause.message}`;
  } else if (e.cause !== undefined) {
    causeStr = String(e.cause);
  }

  return {
    name: e.name,
    message: e.message,
    status,
    oauthError: asString(e.error),
    oauthErrorDescription: asString(e.error_description),
    upstreamUrl,
    cause: causeStr,
  };
}
