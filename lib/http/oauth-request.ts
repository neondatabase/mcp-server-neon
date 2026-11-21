import { HttpServerRequest } from 'effect/http';
import { Effect } from 'effect';
import {
  browserBindingFromCookies,
  cookieSecureForRequest,
} from '../../mcp/oauth/browser-binding';
import { requestPublicOrigin } from '../../mcp/oauth/consent-canonical-url';

/**
 * What the browser-facing OAuth routes read from a request: its full URL,
 * whether consent cookies must be `Secure` (`__Host-` prefixed), the origin
 * the browser used, and the browser binding for a transaction.
 */
export const oauthBrowserRequest = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const url = new URL(request.originalUrl);
  const headers = new Headers(request.headers);
  const view = { nextUrl: url, headers };

  return {
    url,
    headers,
    accept: request.headers.accept,
    secure: cookieSecureForRequest(view),
    publicOrigin: requestPublicOrigin(view),
    browserSecret: (transactionId: string) =>
      browserBindingFromCookies(
        {
          get: (name) => {
            const value = request.cookies[name];

            return value === undefined ? undefined : { value };
          },
        },
        transactionId,
      ),
  };
});
