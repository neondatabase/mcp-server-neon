import { NextRequest, NextResponse } from 'next/server';
import { model } from '../../mcp-src/oauth/model';
import {
  isPgConnectFailure,
  withPgConnectRetry,
} from '../../mcp-src/oauth/kv-store';
import { exchangeCode } from '../../lib/oauth/client';
import { extractUpstreamErrorDetails } from '../../lib/oauth/upstream-error';
import { generateRandomString } from '../../mcp-src/oauth/utils';
import { createNeonClient } from '../../mcp-src/server/api';
import { resolveAccountFromAuth } from '../../mcp-src/server/account';
import { handleOAuthError } from '../../lib/errors';
import { matchesRedirectUri } from '../../lib/oauth/redirect-uri';
import { logger } from '../../mcp-src/utils/logger';
import type { AuthorizationCode } from 'oauth2-server';
import {
  DEFAULT_GRANT,
  resolveGrantFromResourceUri,
  type GrantContext,
} from '../../mcp-src/utils/grant-context';

type DownstreamAuthRequest = {
  responseType: string;
  clientId: string;
  redirectUri: string;
  scope: string[];
  state: string;
  resource?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
};

const decodeAuthParams = (state: string): DownstreamAuthRequest => {
  const decoded = atob(state);
  return JSON.parse(decoded);
};

const toMilliseconds = (seconds: number): number => seconds * 1000;

/**
 * Auth-flow SLO outcome buckets emitted by /callback. Mirrors the refresh
 * SLO at /api/token (see dev-notes/refresh-slo.md). Bucket map:
 *
 *  GOOD (numerator):
 *  - `success`                   200/302 successful exchange + redirect
 *  - `correct_user_denied`       User clicked Cancel (Hydra `access_denied`)
 *  - `correct_consent_expired`   Hydra `request_unauthorized` — the
 *                                login/consent challenge DB row expired
 *                                (ttl.login_consent_request, 30m default
 *                                in Hydra v1.11.x). Counts GOOD because
 *                                the user took too long; system worked
 *                                as designed.
 *  - `correct_csrf_mismatch`     Hydra `request_forbidden` — CSRF cookie
 *                                value differs from the DB row, typically
 *                                because a concurrent OAuth flow on the
 *                                same host overwrote the cookie. Counts
 *                                GOOD because the CSRF guard correctly
 *                                rejected a corrupted flow; user retries
 *                                in a single tab and succeeds.
 *  - `correct_invalid_grant`     Hydra `invalid_grant` on code-exchange —
 *                                the authorization code was already used
 *                                or expired (ttl.auth_code, 10m default).
 *                                Mirrors the refresh SLO's same-named
 *                                bucket; system worked as designed.
 *
 *  BAD (numerator):
 *  - `upstream_unmapped_error`   Hydra returned `?error=error` with
 *                                description "The error is unrecognizable"
 *                                (Fosite-unmapped fallback). The canonical
 *                                fingerprint of a Hydra-side state issue
 *                                we can't classify; user is stranded.
 *  - `upstream_other_error`      Any other upstream OAuth error we haven't
 *                                explicitly classified. Counts BAD until
 *                                characterized — when a new fingerprint
 *                                shows up here often enough, promote it to
 *                                its own bucket (good or bad as appropriate).
 *  - `state_decode_failed`       Our own base64/JSON state could not be
 *                                parsed — our encoding broke or caller tampered.
 *  - `internal_error`            Everything else (KV failures, neon API
 *                                errors, unexpected throws).
 *
 *  EXCLUDED (not in denominator):
 *  - `upstream_5xx`              Hydra returned 5xx during code-exchange
 *                                (OAUTH_RESPONSE_IS_NOT_CONFORM) — provider
 *                                outage, not our quality.
 *  - `bad_request`               Bare GET to /callback without any of
 *                                code/state/error — direct navigation,
 *                                prefetch, browser history.
 *
 * Source-grounded justifications for the "correct_*" buckets live in
 * dev-notes/hydra-incident-2026-05-12T13-44Z.md §Update. See also
 * dev-notes/auth-callback-slo.md for the SLO definition + targets.
 */
type AuthCallbackOutcome =
  | 'success'
  | 'correct_user_denied'
  | 'correct_consent_expired'
  | 'correct_csrf_mismatch'
  | 'correct_invalid_grant'
  | 'upstream_unmapped_error'
  | 'upstream_5xx'
  | 'upstream_other_error'
  | 'state_decode_failed'
  | 'bad_request'
  | 'internal_error';

/**
 * Map an upstream OAuth error (as either an `?error=...` redirect or an
 * exception thrown by the code-exchange call) to its SLO bucket. Centralised
 * so both code paths in GET() reach the same classification.
 */
function classifyUpstreamError(
  upstreamError: string,
  upstreamErrorDescription: string | null,
  upstreamStatus: number | undefined,
): AuthCallbackOutcome {
  // Provider 5xx wins — excluded from the SLO denominator regardless of
  // the OAuth error code Hydra may have attached.
  if (upstreamStatus !== undefined && upstreamStatus >= 500) {
    return 'upstream_5xx';
  }
  // Hydra's catch-all unmapped error — the canonical fingerprint of a
  // Hydra-side state issue we can't classify. Counts BAD because the user
  // is left without a clear remediation path.
  if (
    upstreamError === 'error' ||
    upstreamErrorDescription === HYDRA_UNRECOGNIZABLE_ERROR_DESCRIPTION
  ) {
    return 'upstream_unmapped_error';
  }
  // Buckets that count as "system worked as designed" — Hydra rejected the
  // request for a well-understood reason, the user can retry and succeed
  // without our intervention. See file-level JSDoc for the rationale.
  switch (upstreamError) {
    case 'access_denied':
      return 'correct_user_denied';
    case 'request_unauthorized':
      return 'correct_consent_expired';
    case 'request_forbidden':
      return 'correct_csrf_mismatch';
    case 'invalid_grant':
      return 'correct_invalid_grant';
  }
  // Unclassified — counts BAD until a fingerprint emerges and we promote.
  return 'upstream_other_error';
}

function emitAuthCallbackSlo(
  outcome: AuthCallbackOutcome,
  startMs: number,
  context: {
    clientId?: string;
    upstreamError?: string;
    upstreamStatus?: number;
    reason?: string;
    downstreamRequest?: DownstreamRequestSummary;
  } = {},
): void {
  const elapsedMs = Date.now() - startMs;
  const fields = [`outcome=${outcome}`, `elapsedMs=${elapsedMs}`];
  if (context.clientId) fields.push(`clientId=${context.clientId}`);
  if (context.upstreamError)
    fields.push(`upstreamError=${context.upstreamError}`);
  if (typeof context.upstreamStatus === 'number')
    fields.push(`upstreamStatus=${context.upstreamStatus}`);
  if (context.reason) fields.push(`reason=${context.reason}`);
  if (context.downstreamRequest) {
    // Inline-serialise rather than as a JSON blob so log dashboards can
    // grep fields like `stateLen=` directly.
    const d = context.downstreamRequest;
    fields.push(`stateLen=${d.stateLength}`);
    fields.push(`stateFp=${d.stateFingerprint}`);
    fields.push(`scopeCount=${d.scopeCount}`);
    if (d.redirectUriHost) fields.push(`rURIHost=${d.redirectUriHost}`);
    if (d.redirectUriPath) fields.push(`rURIPath=${d.redirectUriPath}`);
    if (d.hasResource) fields.push(`hasResource=1`);
    if (d.hasCodeChallenge) fields.push(`hasPKCE=1`);
  }
  logger.info(`[SLO] auth-callback ${fields.join(' ')}`);
}

/**
 * Privacy-safe summary of the downstream client's auth request, captured at
 * `/callback` when Hydra returns an `?error=...` redirect. Mirrors the
 * `UpstreamRequestSummary` pattern from PR #252 (refresh-grant) — the goal is
 * the same: when Hydra returns a generic `invalid_request` ("missing/invalid
 * parameter, includes a parameter more than once, or is otherwise malformed"),
 * we want enough fingerprint of what we forwarded to disambiguate the cause
 * without leaking the downstream state.
 *
 * NEVER logs the raw `state` value — only its length + a short prefix. State
 * is base64-encoded JSON containing the downstream client's params; leaking
 * even partial values could be replay-leverage if any of them are sensitive.
 */
type DownstreamRequestSummary = {
  /** Length of the `state` query param we forwarded to Hydra. Hydra may
   *  reject very long states; this is the most likely `invalid_request`
   *  trigger we don't currently see. */
  stateLength: number;
  /** Length + first-6-char prefix of the state, for correlating this
   *  failure to an earlier `/api/authorize` log line without leaking the
   *  full value. */
  stateFingerprint: string;
  /** Number of scopes the downstream client requested. */
  scopeCount: number;
  /** Downstream `redirect_uri` host (e.g. `localhost`) — not the port,
   *  because per-process random ports are PII-adjacent on a small user
   *  base and don't help diagnosis. */
  redirectUriHost?: string;
  /** Downstream `redirect_uri` path (e.g. `/oauth/callback`). */
  redirectUriPath?: string;
  /** Whether the downstream client passed a `resource` URI (grant scoping). */
  hasResource: boolean;
  /** Whether the downstream client passed PKCE challenge params. */
  hasCodeChallenge: boolean;
};

function summarizeDownstreamRequest(
  state: string,
  requestParams: DownstreamAuthRequest,
): DownstreamRequestSummary {
  let redirectUriHost: string | undefined;
  let redirectUriPath: string | undefined;
  try {
    const u = new URL(requestParams.redirectUri);
    redirectUriHost = u.hostname;
    redirectUriPath = u.pathname;
  } catch {
    // Malformed redirect_uri — leave host/path undefined; the upstream
    // error description usually tells us this happened.
  }
  return {
    stateLength: state.length,
    stateFingerprint: `len=${state.length},prefix=${state.slice(0, 6)}`,
    scopeCount: requestParams.scope?.length ?? 0,
    redirectUriHost,
    redirectUriPath,
    hasResource: Boolean(requestParams.resource),
    hasCodeChallenge: Boolean(requestParams.codeChallenge),
  };
}

/**
 * Hydra's well-known `error` value when the underlying failure can't be
 * mapped to a standard OAuth error code. Surfaces with
 * `error_description=The error is unrecognizable`. Useful as a separate
 * SLO bucket because it's the canonical fingerprint of a Hydra-side
 * internal-state issue (unmapped consent / session / scope).
 */
const HYDRA_UNRECOGNIZABLE_ERROR_DESCRIPTION = 'The error is unrecognizable';

/**
 * RFC 6749 §4.1.2.1 — error redirect to the downstream client.
 *
 * Builds a redirect URL to the originally-supplied `redirect_uri` with
 * `error`, `error_description`, `error_uri`, and the client's original
 * `state` propagated, so the MCP client (Cursor, ChatGPT, etc.) sees
 * the failure on its own side and can surface a meaningful UI instead
 * of leaving the user stranded at our /callback page.
 */
function buildClientErrorRedirect(
  requestParams: DownstreamAuthRequest,
  upstreamError: string,
  upstreamErrorDescription: string | null,
  upstreamErrorUri: string | null,
): URL {
  const url = new URL(requestParams.redirectUri);
  url.searchParams.set('error', upstreamError);
  if (upstreamErrorDescription) {
    url.searchParams.set('error_description', upstreamErrorDescription);
  }
  if (upstreamErrorUri) {
    url.searchParams.set('error_uri', upstreamErrorUri);
  }
  if (requestParams.state) {
    url.searchParams.set('state', requestParams.state);
  }
  return url;
}


/**
 * CWE-601 guard: confirm that a redirect_uri decoded from the OAuth state
 * is on the client's registered allowlist. Used by the upstream-error
 * relay path, which doesn't have a loaded `Client` in scope (the
 * success path does its own check inline once the client is loaded).
 *
 * Errors from the KV lookup intentionally fail closed — when in doubt,
 * we don't redirect.
 */
async function isAllowedRedirectUri(
  clientId: string,
  redirectUri: string,
): Promise<boolean> {
  if (!clientId || !redirectUri) return false;
  try {
    const client = await withPgConnectRetry('callback.validateRedirect', () =>
      model.getClient(clientId, ''),
    );
    const registered =
      (client as { redirect_uris?: string[] } | undefined)?.redirect_uris ?? [];
    return matchesRedirectUri(redirectUri, registered);
  } catch (err) {
    logger.warn('Failed to load client for redirect_uri validation', {
      clientId,
      err: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export async function GET(request: NextRequest) {
  const sloStartMs = Date.now();
  // Captured for the outer catch so an internal_error event carries a
  // usable clientId in the SLO line. Without this, post-mortems on
  // /callback failures (e.g. the 2026-05-12 OAUTH_DATABASE_URL compute
  // scale-from-zero blip) can't be correlated to a specific user.
  let clientIdForSlo: string | undefined;
  try {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const upstreamError = searchParams.get('error');
    const upstreamErrorDescription = searchParams.get('error_description');
    const upstreamErrorUri = searchParams.get('error_uri');

    // RFC 6749 §4.1.2.1: upstream returned an error redirect. Try to relay
    // it to the downstream client's redirect_uri so the MCP client sees a
    // real failure on its own side. Falls back to a JSON 400 if we don't
    // have enough state to do the relay.
    if (upstreamError) {
      // Centralised classification — see classifyUpstreamError + file-level
      // JSDoc for the bucket map. No HTTP status in the redirect-error
      // path, so 5xx classification doesn't apply here.
      const outcome = classifyUpstreamError(
        upstreamError,
        upstreamErrorDescription,
        undefined,
      );

      logger.warn('Upstream returned error to /callback', {
        upstreamError,
        upstreamErrorDescription,
        upstreamErrorUri,
        hasState: Boolean(state),
        outcome,
      });

      if (state) {
        try {
          const requestParams = decodeAuthParams(state);
          // CWE-601 defence-in-depth: re-validate the decoded redirectUri
          // against the client's registered redirect_uris before relaying
          // an upstream error. The state value is opaque to us once it
          // round-trips through the upstream IdP, so we cannot trust the
          // embedded redirectUri without checking it again here.
          if (
            !(await isAllowedRedirectUri(
              requestParams.clientId,
              requestParams.redirectUri,
            ))
          ) {
            logger.warn(
              'Refusing to relay upstream error to non-allowlisted redirect_uri',
              {
                clientId: requestParams.clientId,
                providedRedirectUri: requestParams.redirectUri,
              },
            );
            emitAuthCallbackSlo('bad_request', sloStartMs, {
              clientId: requestParams.clientId,
              upstreamError,
              reason: 'redirect_uri_not_allowlisted',
            });
            return NextResponse.json(
              {
                error: 'invalid_request',
                error_description: 'Invalid redirect URI',
              },
              { status: 400 },
            );
          }
          const redirectUrl = buildClientErrorRedirect(
            requestParams,
            upstreamError,
            upstreamErrorDescription,
            upstreamErrorUri,
          );
          emitAuthCallbackSlo(outcome, sloStartMs, {
            clientId: requestParams.clientId,
            upstreamError,
            // Sanitized fingerprint of what we forwarded to Hydra's
            // /oauth2/auth. Closes the diagnostic gap when Hydra returns
            // its generic `invalid_request` (the catch-all that flags
            // missing/duplicate/malformed params OR a redirect_uri
            // whitelist failure — Hydra returns the same description for
            // all of them). See dev-notes/auth-callback-slo.md.
            downstreamRequest: summarizeDownstreamRequest(state, requestParams),
          });
          return NextResponse.redirect(redirectUrl.href);
        } catch (decodeErr) {
          // State decode failed — fall through to JSON 400 below.
          logger.warn('Failed to decode state while relaying upstream error', {
            upstreamError,
            decodeErr:
              decodeErr instanceof Error
                ? decodeErr.message
                : String(decodeErr),
          });
          emitAuthCallbackSlo('state_decode_failed', sloStartMs, {
            upstreamError,
            reason: 'decode_failed_during_error_relay',
          });
          return NextResponse.json(
            {
              error: upstreamError,
              error_description:
                upstreamErrorDescription ?? 'Upstream authorization failed',
            },
            { status: 400 },
          );
        }
      }

      emitAuthCallbackSlo(outcome, sloStartMs, {
        upstreamError,
        reason: 'no_state_for_relay',
      });
      return NextResponse.json(
        {
          error: upstreamError,
          error_description:
            upstreamErrorDescription ?? 'Upstream authorization failed',
        },
        { status: 400 },
      );
    }

    if (!code || !state) {
      // Neither success params nor an error — likely a bare GET to /callback
      // (direct navigation, prefetch, browser history). Don't conflate with
      // upstream failures: separate bucket, excluded from SLO denominator.
      logger.warn(
        'Callback hit without code/state and without upstream error',
        {
          hasCode: Boolean(code),
          hasState: Boolean(state),
          queryKeys: Array.from(searchParams.keys()),
        },
      );
      emitAuthCallbackSlo('bad_request', sloStartMs);
      return NextResponse.json(
        {
          error: 'invalid_request',
          error_description: 'Missing code or state',
        },
        { status: 400 },
      );
    }

    // Build the current URL for the code exchange
    const currentUrl = new URL(request.url);
    currentUrl.protocol = 'https:'; // Force HTTPS for production

    let requestParams: DownstreamAuthRequest;
    try {
      requestParams = decodeAuthParams(state);
      clientIdForSlo = requestParams.clientId;
    } catch (decodeErr) {
      logger.error('Failed to decode state at /callback', {
        decodeErr:
          decodeErr instanceof Error ? decodeErr.message : String(decodeErr),
      });
      emitAuthCallbackSlo('state_decode_failed', sloStartMs);
      return NextResponse.json(
        {
          error: 'invalid_request',
          error_description: 'Invalid state parameter',
        },
        { status: 400 },
      );
    }

    // Exchange the upstream authorization code for tokens. Wrapping the
    // call in its own try/catch lets us classify upstream failures into
    // SLO buckets distinct from internal failures further down.
    let tokens: Awaited<ReturnType<typeof exchangeCode>>;
    try {
      tokens = await exchangeCode(currentUrl, state);
    } catch (exchangeErr) {
      const details = extractUpstreamErrorDetails(exchangeErr);
      const upstreamStatus = details.status;
      const outcome = classifyUpstreamError(
        details.oauthError ?? '',
        details.oauthErrorDescription ?? null,
        upstreamStatus,
      );
      logger.error('Upstream code exchange failed at /callback', {
        ...details,
        clientId: requestParams.clientId,
        outcome,
      });
      emitAuthCallbackSlo(outcome, sloStartMs, {
        clientId: requestParams.clientId,
        upstreamError: details.oauthError,
        upstreamStatus,
        // Same diagnostic as the `?error=...` redirect path above —
        // fingerprint what we forwarded so a generic `invalid_request`
        // / `invalid_grant` event isn't a black box.
        downstreamRequest: summarizeDownstreamRequest(state, requestParams),
      });
      return handleOAuthError(exchangeErr, 'OAuth callback error');
    }

    const clientId = requestParams.clientId;
    const client = await withPgConnectRetry('callback.getClient', () =>
      model.getClient(clientId, ''),
    );
    if (!client) {
      logger.warn('Client not found at /callback', { clientId });
      emitAuthCallbackSlo('internal_error', sloStartMs, {
        clientId,
        reason: 'client_not_found',
      });
      return NextResponse.json(
        {
          error: 'invalid_client',
          error_description: 'Invalid client ID',
        },
        { status: 400 },
      );
    }

    // CWE-601: refuse to mint an authorization code for a redirect_uri
    // that isn't on this client's registered allowlist. /api/authorize
    // already enforces this on the way in, but the state value reaches
    // /callback after a round-trip through the upstream IdP, so we
    // re-validate here to defend against a tampered state (e.g. from
    // POST /api/authorize, which re-encodes the supplied state without
    // re-checking redirectUri/clientId).
    if (
      !requestParams.redirectUri ||
      !matchesRedirectUri(
        requestParams.redirectUri,
        (client as { redirect_uris?: string[] }).redirect_uris ?? [],
      )
    ) {
      logger.warn('Invalid redirect URI at /callback', {
        clientId,
        providedRedirectUri: requestParams.redirectUri,
        registeredRedirectUris: (client as { redirect_uris?: string[] })
          .redirect_uris,
      });
      emitAuthCallbackSlo('bad_request', sloStartMs, {
        clientId,
        reason: 'redirect_uri_not_allowlisted',
      });
      return NextResponse.json(
        {
          error: 'invalid_request',
          error_description: 'Invalid redirect URI',
        },
        { status: 400 },
      );
    }

    // Standard authorization code grant
    const grantId = generateRandomString(16);
    const nonce = generateRandomString(32);
    const authCode = `${grantId}:${nonce}`;

    // Get auth details to determine account type (org vs personal)
    const neonClient = createNeonClient(tokens.access_token);
    const { data: auth } = await neonClient.getAuthDetails();
    const upstreamExpiresIn = tokens.expiresIn();
    if (upstreamExpiresIn === undefined) {
      logger.error(
        'Upstream omitted expires_in at callback; defaulting to 3600s',
        { clientId },
      );
    }
    const expiresAt = Date.now() + toMilliseconds(upstreamExpiresIn ?? 3600);

    if (!tokens.refresh_token) {
      logger.error(
        'Upstream did not issue refresh_token at callback; offline_access likely missing from granted scopes',
        { clientId, scope: tokens.scope },
      );
      emitAuthCallbackSlo('internal_error', sloStartMs, {
        clientId,
        reason: 'no_refresh_token',
      });
      return NextResponse.json(
        {
          error: 'server_error',
          error_description: 'Upstream did not issue a refresh token',
        },
        { status: 502 },
      );
    }

    // Resolve account info (no identify here - happens in token exchange)
    const userInfo = await resolveAccountFromAuth(auth, neonClient);

    const storedContext = await withPgConnectRetry(
      'callback.getClientAuthContext',
      () => model.getClientAuthContext(clientId),
    );

    // Source of truth is KV context written during /authorize.
    // Keep state-derived values only as a fallback for backward compatibility.
    let grant: GrantContext = storedContext?.grant ?? { ...DEFAULT_GRANT };
    if (!storedContext && requestParams.resource) {
      try {
        grant = resolveGrantFromResourceUri(requestParams.resource);
      } catch {
        emitAuthCallbackSlo('bad_request', sloStartMs, {
          clientId,
          reason: 'invalid_resource',
        });
        return NextResponse.json(
          {
            error: 'invalid_target',
            error_description: 'Invalid resource parameter',
          },
          { status: 400 },
        );
      }
    }
    const finalScopes =
      storedContext?.scope && storedContext.scope.length > 0
        ? storedContext.scope
        : requestParams.scope;

    // Save the authorization code with associated data
    const authCodeData: AuthorizationCode = {
      authorizationCode: authCode,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
      createdAt: Date.now(),
      redirectUri: requestParams.redirectUri,
      scope: finalScopes.join(' '),
      client: client,
      user: userInfo,
      token: {
        access_token: tokens.access_token,
        access_token_expires_at: expiresAt,
        refresh_token: tokens.refresh_token,
        id_token: tokens.id_token,
      },
      code_challenge: requestParams.codeChallenge,
      code_challenge_method: requestParams.codeChallengeMethod,
      grant,
    };

    await withPgConnectRetry('callback.saveAuthorizationCode', () =>
      model.saveAuthorizationCode(authCodeData),
    );
    await withPgConnectRetry('callback.deleteClientAuthContext', () =>
      model.deleteClientAuthContext(clientId),
    );

    // Redirect back to client with auth code
    const redirectUrl = new URL(requestParams.redirectUri);
    redirectUrl.searchParams.set('code', authCode);
    if (requestParams.state) {
      redirectUrl.searchParams.set('state', requestParams.state);
    }

    emitAuthCallbackSlo('success', sloStartMs, { clientId });
    return NextResponse.redirect(redirectUrl.href);
  } catch (error: unknown) {
    // Catch-all for anything not classified above (KV failures, neon API
    // errors, unexpected shapes from openid-client). Counts as bad. We
    // tag the reason field with a coarse fingerprint so dashboards can
    // distinguish a PG compute hiccup from a generic exception without
    // having to grep the raw error message.
    const reason = isPgConnectFailure(error)
      ? 'pg_connect_failure'
      : error instanceof Error && error.name
        ? error.name
        : 'unknown';
    emitAuthCallbackSlo('internal_error', sloStartMs, {
      clientId: clientIdForSlo,
      reason,
    });
    return handleOAuthError(error, 'OAuth callback error');
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
