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
 *  - `success`              200/302 successful exchange + redirect
 *  - `correct_user_denied`  User clicked Cancel at upstream (Hydra returned
 *                           `error=access_denied`). System worked correctly.
 *  - `upstream_unmapped_error` Hydra returned an `?error=...` redirect that
 *                           we couldn't map to a known OAuth code (notably
 *                           Hydra's "The error is unrecognizable" fallback).
 *                           Counts BAD — this is the failure mode that
 *                           strands users on a generic error page.
 *  - `upstream_5xx`         Hydra returned 5xx during the code-exchange
 *                           (OAUTH_RESPONSE_IS_NOT_CONFORM). Excluded from
 *                           the denominator — provider-side outage.
 *  - `upstream_other_error` Hydra-mapped OAuth error during code-exchange
 *                           that isn't 5xx (rare; usually invalid_grant on
 *                           a code we sent back). Counts BAD.
 *  - `state_decode_failed`  Our own base64/JSON state could not be parsed.
 *                           Counts BAD — our state encoding broke or the
 *                           caller tampered.
 *  - `bad_request`          Callback hit without any of code/state/error
 *                           query params. Excluded — usually direct
 *                           navigation by a browser to the bare URL.
 *  - `internal_error`       Everything else (KV failures, neon API errors,
 *                           etc.). Counts BAD.
 *
 * See dev-notes/auth-callback-slo.md for the definition + targets.
 */
type AuthCallbackOutcome =
  | 'success'
  | 'correct_user_denied'
  | 'upstream_unmapped_error'
  | 'upstream_5xx'
  | 'upstream_other_error'
  | 'state_decode_failed'
  | 'bad_request'
  | 'internal_error';

function emitAuthCallbackSlo(
  outcome: AuthCallbackOutcome,
  startMs: number,
  context: {
    clientId?: string;
    upstreamError?: string;
    upstreamStatus?: number;
    reason?: string;
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
  logger.info(`[SLO] auth-callback ${fields.join(' ')}`);
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
      // Hydra's "The error is unrecognizable" fingerprint indicates an
      // unmapped internal state on the upstream side. Bucket separately so
      // we can alert on it without conflating with legitimate user-denied.
      const isUnmapped =
        upstreamErrorDescription === HYDRA_UNRECOGNIZABLE_ERROR_DESCRIPTION ||
        upstreamError === 'error';
      const outcome: AuthCallbackOutcome =
        upstreamError === 'access_denied'
          ? 'correct_user_denied'
          : isUnmapped
            ? 'upstream_unmapped_error'
            : 'upstream_other_error';

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
          const redirectUrl = buildClientErrorRedirect(
            requestParams,
            upstreamError,
            upstreamErrorDescription,
            upstreamErrorUri,
          );
          emitAuthCallbackSlo(outcome, sloStartMs, {
            clientId: requestParams.clientId,
            upstreamError,
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
      const outcome: AuthCallbackOutcome =
        upstreamStatus !== undefined && upstreamStatus >= 500
          ? 'upstream_5xx'
          : 'upstream_other_error';
      logger.error('Upstream code exchange failed at /callback', {
        ...details,
        clientId: requestParams.clientId,
        outcome,
      });
      emitAuthCallbackSlo(outcome, sloStartMs, {
        clientId: requestParams.clientId,
        upstreamError: details.oauthError,
        upstreamStatus,
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
