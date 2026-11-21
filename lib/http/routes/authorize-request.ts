import { Effect, Option } from 'effect';
import { consentCanonicalLocation } from '../../../mcp/oauth/consent-canonical-url';
import { preferenceReadOnly } from '../../../mcp/oauth/consent-mode';
import type { DownstreamAuthRequest } from '../../../mcp/oauth/downstream-auth-request';
import { OAuthStore } from '../../../mcp/oauth/oauth-store';
import { resolveGrantFromResourceUri } from '../../../mcp/utils/grant-context';
import { SERVER_HOST } from '../../config';
import { oauthBrowserRequest } from '../oauth-request';
import { InvalidRequestOrigin } from './authorize-consent';

/** The authorization request's parameters; an empty value counts as absent. */
export const parseAuthRequest = (
  searchParams: URLSearchParams,
): DownstreamAuthRequest => {
  const value = (name: string) => {
    const raw = searchParams.get(name);

    return raw === null || raw === '' ? undefined : raw;
  };

  return {
    responseType: value('response_type') ?? '',
    clientId: value('client_id') ?? '',
    redirectUri: value('redirect_uri') ?? '',
    scope: (value('scope') ?? '').split(' ').filter((scope) => scope !== ''),
    state: value('state') ?? '',
    resource: value('resource'),
    codeChallenge: value('code_challenge'),
    codeChallengeMethod: value('code_challenge_method') ?? 'plain',
  };
};

/**
 * Where to send a browser that reached us on another host, if anywhere.
 * Consent cookies are host-scoped, and upstream always returns to SERVER_HOST.
 */
export const canonicalLocation = Effect.fnUntraced(function* (url: URL) {
  const browser = yield* oauthBrowserRequest;

  return yield* Effect.try({
    try: () =>
      consentCanonicalLocation(
        browser.publicOrigin,
        `${url.pathname}${url.search}`,
        SERVER_HOST,
      ),
    catch: () => InvalidRequestOrigin.make({}),
  });
});

/** The request's grant from its `resource`, or none when it is malformed. */
export const resourceGrantOf = (resource: string | undefined) =>
  Effect.try({
    try: () => resolveGrantFromResourceUri(resource),
    catch: () => 'invalid' as const,
  }).pipe(Effect.option);

/** The read-only default: the query, the request header, or registration. */
export const readOnlyPreference = Effect.fnUntraced(function* (input: {
  readonly clientId: string;
  readonly searchParams: URLSearchParams;
}) {
  const browser = yield* oauthBrowserRequest;
  const store = yield* OAuthStore;

  const registered = yield* store.findRegisterHeaders({
    clientId: input.clientId,
  });

  const savedReadOnly = registered.pipe(
    Option.flatMap(({ headers }) =>
      Option.fromUndefinedOr(headers['x-read-only']),
    ),
    Option.getOrUndefined,
  );

  return preferenceReadOnly({
    authorizeReadOnly: input.searchParams.get('readonly'),
    headerValue: browser.headers.get('x-read-only') ?? savedReadOnly ?? null,
  });
});
