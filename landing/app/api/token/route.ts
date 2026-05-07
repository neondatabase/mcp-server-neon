import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { Client } from 'oauth2-server';
import { model } from '../../../mcp-src/oauth/model';
import { exchangeRefreshToken } from '../../../lib/oauth/client';
import { verifyPKCE } from '../../../mcp-src/oauth/utils';
import { identify, flushAnalytics } from '../../../mcp-src/analytics/analytics';
import { handleOAuthError } from '../../../lib/errors';
import { logger } from '../../../mcp-src/utils/logger';
import { singleflight } from '../../../mcp-src/utils/singleflight';
import { retryAsync } from '../../../mcp-src/utils/retry';
import {
  withRefreshLock,
  signalTransientFailure,
  peekTransientFailure,
} from '../../../mcp-src/oauth/refresh-lock';

const toSeconds = (ms: number): number => Math.floor(ms / 1000);
const toMilliseconds = (seconds: number): number => seconds * 1000;

type RefreshTokenResult = {
  access_token: string;
  expires_in: number;
  token_type: 'bearer';
  refresh_token: string;
  scope?: string | string[];
};

/**
 * Outcome bucket for the refresh-token SLO. See dev-notes/refresh-slo.md.
 *
 * - `success`                    — 200 returned (fresh upstream rotation OR
 *                                  cached cross-instance hit). Counts good.
 * - `correct_invalid_grant`      — 400; client presented a token we knew was
 *                                  dead (RT-not-found, failure-cache hit, etc.)
 *                                  Counts good — our system did the right thing.
 * - `cliff_upstream`             — 4xx from upstream Hydra. Counts BAD —
 *                                  the chain is now revoked, user must re-auth.
 * - `transient_lock_timeout`     — 503 from lock-waiter timeout. Counts BAD.
 * - `transient_persist_failure`  — KV write threw after upstream rotated.
 *                                  Counts BAD — leaks rotation state.
 * - `transient_upstream_5xx`     — Hydra returned an HTTP 5xx response.
 *                                  Excluded from SLO (provider issue).
 * - `transient_upstream_network` — Network-level error reaching Hydra
 *                                  (ECONNRESET, ETIMEDOUT, ENOTFOUND, etc.).
 *                                  Distinguished from 5xx because it's
 *                                  retryable from our side and a different
 *                                  diagnostic category. Excluded from SLO.
 * - `bad_request`                — request validation failure. Excluded.
 */
type SloOutcome =
  | 'success'
  | 'correct_invalid_grant'
  | 'cliff_upstream'
  | 'transient_lock_timeout'
  | 'transient_persist_failure'
  | 'transient_upstream_5xx'
  | 'transient_upstream_network'
  | 'bad_request';

// Network-layer error codes commonly observed talking to Hydra. Walking
// the error chain catches openid-client's wrapping (TypeError "fetch failed"
// with .cause containing the underlying Node error).
const RETRYABLE_NETWORK_CODES = [
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_SOCKET',
] as const;

function findNetworkErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  // Cap iterations to avoid pathological cycles.
  for (let depth = 0; depth < 8; depth++) {
    if (!(current instanceof Error)) return undefined;
    const e = current as Error & { code?: unknown; cause?: unknown };
    if (typeof e.code === 'string') {
      const match = RETRYABLE_NETWORK_CODES.find((c) => c === e.code);
      if (match) return match;
    }
    const message = e.message ?? '';
    const match = RETRYABLE_NETWORK_CODES.find((c) => message.includes(c));
    if (match) return match;
    current = e.cause;
  }
  return undefined;
}

/**
 * Decides whether an upstream `exchangeRefreshToken` failure is safe to
 * retry. We only retry errors with NO HTTP response — those are network-
 * layer failures (DNS, TCP reset, timeout). HTTP 4xx/5xx responses mean
 * Hydra processed the request and possibly rotated the RT; retrying could
 * present an already-rotated token and trigger a cliff.
 */
function shouldRetryUpstreamError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  // Got a structured HTTP response → server processed it, don't retry.
  if (
    'status' in error &&
    typeof (error as { status: unknown }).status === 'number'
  ) {
    return false;
  }
  return findNetworkErrorCode(error) !== undefined;
}

class RefreshError extends Error {
  constructor(
    public readonly oauthError: string,
    public readonly description: string,
    public readonly statusCode: number,
    public readonly sloOutcome: SloOutcome,
  ) {
    super(description);
    this.name = 'RefreshError';
  }
}

// Stable, greppable SLO metric line. Aggregator scripts parse the
// `outcome=<bucket>` token; other fields are diagnostic context.
function emitRefreshSlo(
  outcome: SloOutcome,
  startMs: number,
  context: {
    clientId?: string;
    reason?: string;
    upstreamOauthError?: string;
  } = {},
): void {
  const elapsedMs = Date.now() - startMs;
  const fields = [`outcome=${outcome}`, `elapsedMs=${elapsedMs}`];
  if (context.clientId) fields.push(`clientId=${context.clientId}`);
  if (context.reason) fields.push(`reason=${context.reason}`);
  if (context.upstreamOauthError)
    fields.push(`upstreamOauthError=${context.upstreamOauthError}`);
  logger.info(`[SLO] refresh ${fields.join(' ')}`);
}

// Extracts structured details from openid-client errors so the upstream
// failure log captures the actual OAuth `error` / `error_description` instead
// of the generic "server responded with an error in the response body".
function extractUpstreamErrorDetails(error: unknown): {
  name?: string;
  message?: string;
  status?: number;
  oauthError?: string;
  oauthErrorDescription?: string;
  cause?: string;
} {
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
  return {
    name: e.name,
    message: e.message,
    status: asNumber(e.status),
    oauthError: asString(e.error),
    oauthErrorDescription: asString(e.error_description),
    cause:
      e.cause instanceof Error
        ? `${e.cause.name}: ${e.cause.message}`
        : e.cause !== undefined
          ? String(e.cause)
          : undefined,
  };
}

// When a holder bails out before the upstream call (RT/AT not found in KV,
// client mismatch, etc.), populate the failure cache too — otherwise concurrent
// waiters time out with a 503 instead of getting the actual 400 invalid_grant.
// Outcome of these checks is durable: an RT we don't have in storage will not
// suddenly become valid, so caching is correct.
async function cachePreUpstreamFailure(
  refreshToken: string,
  reason: string,
): Promise<void> {
  await model
    .saveRefreshFailure(refreshToken, {
      failedAt: Date.now(),
      oauthError: 'invalid_grant',
      oauthErrorDescription: reason,
    })
    .catch((err) => {
      logger.warn('Failed to cache pre-upstream refresh failure', {
        err,
        reason,
      });
    });
}

async function executeRefresh(
  refreshToken: string,
  client: Client,
): Promise<RefreshTokenResult> {
  const providedRefreshToken = await model.getRefreshToken(refreshToken);
  if (!providedRefreshToken) {
    logger.warn('Refresh token not found in storage');
    await cachePreUpstreamFailure(refreshToken, 'rt_not_found_in_storage');
    throw new RefreshError(
      'invalid_grant',
      'Invalid or expired refresh token',
      400,
      'correct_invalid_grant',
    );
  }

  const oldToken = await model.getAccessToken(providedRefreshToken.accessToken);
  if (!oldToken) {
    logger.warn('Access token for refresh token not found, cleaning up');
    await model.deleteRefreshToken(providedRefreshToken);
    await cachePreUpstreamFailure(refreshToken, 'access_token_not_found');
    throw new RefreshError(
      'invalid_grant',
      'Invalid or expired refresh token',
      400,
      'correct_invalid_grant',
    );
  }

  if (oldToken.client.id !== client.id) {
    logger.warn('Client mismatch for refresh token', {
      tokenClientId: oldToken.client.id,
      requestClientId: client.id,
    });
    await cachePreUpstreamFailure(refreshToken, 'client_mismatch');
    throw new RefreshError(
      'invalid_grant',
      'Invalid or expired refresh token',
      400,
      'correct_invalid_grant',
    );
  }

  let upstreamToken: Awaited<ReturnType<typeof exchangeRefreshToken>>;
  try {
    logger.info('Exchanging refresh token with upstream');
    // Retry on network-layer errors (ECONNRESET, ETIMEDOUT, DNS, etc.) but
    // never on HTTP responses — those mean Hydra processed the request and
    // may have rotated the RT. Two attempts with a short backoff catches
    // most TCP/connection blips without piling latency.
    upstreamToken = await retryAsync(
      () => exchangeRefreshToken(providedRefreshToken.refreshToken),
      {
        attempts: 2,
        delaysMs: [200],
        op: 'upstream refresh exchange',
        shouldRetry: shouldRetryUpstreamError,
      },
    );
    logger.info('Upstream token exchange successful');
  } catch (error) {
    const details = extractUpstreamErrorDetails(error);
    const isClientError =
      details.status !== undefined &&
      details.status >= 400 &&
      details.status < 500;
    const networkErrorCode = findNetworkErrorCode(error);

    logger.error('Upstream refresh token exchange failed', {
      ...details,
      clientId: client.id,
      isClientError,
      networkErrorCode,
    });

    if (isClientError) {
      // Cache the dead RT so subsequent retries from the same client
      // (which we've observed firing 100-500 requests in sub-second bursts)
      // get a fast 400 from KV instead of stampeding upstream.
      await model
        .saveRefreshFailure(refreshToken, {
          failedAt: Date.now(),
          oauthError: details.oauthError,
          oauthErrorDescription: details.oauthErrorDescription,
        })
        .catch((err) => {
          logger.warn('Failed to cache refresh failure', { err });
        });

      await model.deleteToken(oldToken);
      await model.deleteRefreshToken(providedRefreshToken);
      throw new RefreshError(
        'invalid_grant',
        'Invalid or expired refresh token',
        400,
        'cliff_upstream',
      );
    }

    // Signal the lock waiters that the upstream is currently flaky so they
    // exit their poll loop fast instead of timing out 5s later as 503s. The
    // marker is short-lived (30s) so genuine recovery isn't masked.
    await signalTransientFailure(refreshToken);

    // Distinguish network-layer failures (no HTTP response) from HTTP 5xx
    // for SLO bucketing. Both are excluded from the SLO denominator, but
    // network-error volume tells us about TCP/DNS health vs Hydra-
    // application health — useful when investigating provider issues.
    if (networkErrorCode !== undefined) {
      throw new RefreshError(
        'server_error',
        'Network error contacting upstream; please retry',
        503,
        'transient_upstream_network',
      );
    }
    throw new RefreshError(
      'server_error',
      'Temporary error refreshing token, please retry',
      503,
      'transient_upstream_5xx',
    );
  }

  const now = Date.now();
  const upstreamExpiresIn = upstreamToken.expiresIn();
  if (upstreamExpiresIn === undefined) {
    logger.error(
      'Upstream omitted expires_in on refresh; defaulting to 3600s',
      { clientId: client.id },
    );
  }
  const expiresAt = now + toMilliseconds(upstreamExpiresIn ?? 3600);

  const newRefreshToken =
    upstreamToken.refresh_token ?? providedRefreshToken.refreshToken;

  if (!upstreamToken.access_token) {
    logger.error('Upstream token missing access_token', {
      hasAccessToken: !!upstreamToken.access_token,
      hasRefreshToken: !!upstreamToken.refresh_token,
    });
    throw new RefreshError(
      'server_error',
      'Invalid token response from upstream',
      502,
      'transient_persist_failure',
    );
  }

  const expiresIn = toSeconds(expiresAt - now);
  if (!Number.isFinite(expiresIn)) {
    logger.error('Invalid expiresIn calculated', { expiresAt, now, expiresIn });
    throw new RefreshError(
      'server_error',
      'Invalid token expiration',
      500,
      'transient_persist_failure',
    );
  }

  const scope = oldToken.scope;
  const scopeValue =
    typeof scope === 'string' || Array.isArray(scope) ? scope : undefined;

  // Build the response from the upstream tokens directly. We commit to this
  // exact pair regardless of what happens during persistence — the goal of
  // the next phase is to make our local KV agree with what we tell the
  // client, but if it can't, the client's tokens are still valid at upstream.
  const result: RefreshTokenResult = {
    access_token: upstreamToken.access_token,
    expires_in: expiresIn,
    token_type: 'bearer',
    refresh_token: newRefreshToken,
    scope: scopeValue,
  };

  // Write the cross-instance success cache FIRST, before the local
  // refresh_tokens persist. Reasoning: if persist fails after this point,
  // peers (and this client's retries with the OLD refresh_token) can still
  // serve the new pair from this cache via getRefreshResult. Without this
  // ordering, a Postgres blip during persist would leak the rotation —
  // Hydra has advanced but our system has no record, so any retry hits
  // upstream again and gets `token_inactive`.
  await model
    .saveRefreshResult(refreshToken, {
      accessToken: result.access_token,
      refreshToken: result.refresh_token,
      expiresAt,
      scope: scopeValue,
    })
    .catch((err) => {
      logger.warn('Failed to cache refresh result', { err });
    });

  // Persist the new pair into refresh_tokens with retry. Most persist
  // failures are transient (Postgres connection blip, deadlock, brief
  // unavailability) and clear within milliseconds. Three quick attempts
  // with backoff catches that without piling latency on the success path.
  //
  // If all retries fail, throw `transient_persist_failure`. The route's
  // outer catch will then see that the success cache (written above) has
  // the rotation outcome and serve the client a 200 from cache — the
  // "degraded" path. Throwing here is what gets the SLO bucket recorded
  // correctly; the cache rescue is handled in the route layer.
  logger.info('Saving new tokens from refresh');
  try {
    await retryAsync(
      async () => {
        const saved = await model.saveToken({
          accessToken: upstreamToken.access_token,
          refreshToken: newRefreshToken,
          expires_at: expiresAt,
          client: client,
          user: oldToken.user,
          scope: oldToken.scope,
          grant: oldToken.grant,
        });
        await model.saveRefreshToken({
          refreshToken: newRefreshToken,
          accessToken: saved.accessToken,
        });
        if (!saved.accessToken) {
          throw new Error('saveToken returned token without accessToken');
        }
      },
      { attempts: 3, delaysMs: [50, 250], op: 'persist refresh result' },
    );
  } catch (persistErr) {
    logger.error('Persist after upstream rotation failed (after retry)', {
      err: persistErr instanceof Error ? persistErr.message : persistErr,
      clientId: client.id,
    });
    throw new RefreshError(
      'server_error',
      'Failed to persist refreshed tokens',
      500,
      'transient_persist_failure',
    );
  }

  // Best-effort cleanup of old tokens. Errors are swallowed — they'll TTL
  // out and the new tokens are already live.
  await model.deleteToken(oldToken).catch((err) => {
    logger.warn('Failed to delete old access token', { err });
  });
  if (newRefreshToken !== providedRefreshToken.refreshToken) {
    await model.deleteRefreshToken(providedRefreshToken).catch((err) => {
      logger.warn('Failed to delete old refresh token', { err });
    });
  }

  logger.info('Refresh token exchanged successfully');

  logger.info('Building refresh token response', {
    hasAccessToken: !!result.access_token,
    hasRefreshToken: !!result.refresh_token,
    expiresIn: result.expires_in,
    scopeType: typeof result.scope,
    scopeIsArray: Array.isArray(result.scope),
  });

  return result;
}

const extractClientCredentials = (
  request: NextRequest,
  formData: URLSearchParams,
) => {
  const authorization = request.headers.get('authorization');
  if (authorization?.startsWith('Basic ')) {
    const credentials = atob(authorization.replace(/^Basic\s+/i, ''));
    const [clientId, clientSecret] = credentials.split(':');
    return { clientId, clientSecret };
  }

  return {
    clientId: formData.get('client_id') ?? undefined,
    clientSecret: formData.get('client_secret') ?? undefined,
  };
};

export async function POST(request: NextRequest) {
  logger.info('Token endpoint called');

  try {
    const contentType = request.headers.get('content-type');

    if (!contentType?.includes('application/x-www-form-urlencoded')) {
      logger.warn('Invalid content type for token request', { contentType });
      return NextResponse.json(
        {
          error: 'invalid_request',
          error_description: 'Invalid content type',
        },
        { status: 415 },
      );
    }

    const body = await request.text();
    const formData = new URLSearchParams(body);
    const grantType = formData.get('grant_type');

    logger.info('Token request parsed', { grantType });

    const { clientId, clientSecret } = extractClientCredentials(
      request,
      formData,
    );

    if (!clientId) {
      logger.warn('Token request missing client_id');
      return NextResponse.json(
        {
          error: 'invalid_request',
          error_description: 'client_id is required',
        },
        { status: 400 },
      );
    }

    const error = {
      error: 'invalid_client',
      error_description: 'client not found or invalid client credentials',
    };

    const client = await model.getClient(clientId, '');
    if (!client) {
      logger.warn('Client not found', { clientId });
      return NextResponse.json(error, { status: 400 });
    }

    const isPublicClient = client.tokenEndpointAuthMethod === 'none';
    if (!isPublicClient) {
      if (clientSecret !== client.secret) {
        logger.warn('Client secret mismatch', { clientId });
        return NextResponse.json(error, { status: 400 });
      }
    }

    if (grantType === 'authorization_code') {
      logger.info('Processing authorization_code grant');
      const code = formData.get('code');
      if (!code) {
        logger.warn('Authorization code missing');
        return NextResponse.json(
          {
            error: 'invalid_request',
            error_description: 'code is required',
          },
          { status: 400 },
        );
      }

      const authorizationCode = await model.getAuthorizationCode(code);
      if (!authorizationCode) {
        logger.warn('Invalid authorization code');
        return NextResponse.json(
          {
            error: 'invalid_grant',
            error_description: 'Invalid authorization code',
          },
          { status: 400 },
        );
      }
      logger.info('Authorization code found', {
        userId: authorizationCode.user?.id,
      });

      if (authorizationCode.client.id !== client.id) {
        logger.warn('Authorization code client mismatch', {
          codeClientId: authorizationCode.client.id,
          requestClientId: client.id,
        });
        return NextResponse.json(
          {
            error: 'invalid_grant',
            error_description: 'Invalid authorization code',
          },
          { status: 400 },
        );
      }

      if (authorizationCode.expiresAt < new Date()) {
        logger.warn('Authorization code expired');
        return NextResponse.json(
          {
            error: 'invalid_grant',
            error_description: 'Authorization code expired',
          },
          { status: 400 },
        );
      }

      const isPkceEnabled = authorizationCode.code_challenge !== undefined;
      const codeVerifier = formData.get('code_verifier');

      if (
        isPkceEnabled &&
        !verifyPKCE(
          authorizationCode.code_challenge!,
          authorizationCode.code_challenge_method!,
          codeVerifier ?? '',
        )
      ) {
        logger.warn('Invalid PKCE code verifier');
        return NextResponse.json(
          {
            error: 'invalid_grant',
            error_description: 'Invalid PKCE code verifier',
          },
          { status: 400 },
        );
      }

      const redirectUri = formData.get('redirect_uri');
      if (!isPkceEnabled && !redirectUri) {
        logger.warn('Missing redirect_uri for non-PKCE flow');
        return NextResponse.json(
          {
            error: 'invalid_request',
            error_description: 'redirect_uri is required when not using PKCE',
          },
          { status: 400 },
        );
      }
      if (redirectUri && !client.redirect_uris.includes(redirectUri)) {
        logger.warn('Invalid redirect_uri', { provided: redirectUri });
        return NextResponse.json(
          {
            error: 'invalid_request',
            error_description: 'Invalid redirect URI',
          },
          { status: 400 },
        );
      }

      const upstreamRefreshToken = authorizationCode.token.refresh_token;
      if (!upstreamRefreshToken) {
        logger.error(
          'Authorization code missing refresh_token; upstream did not issue one',
          { clientId: client.id, userId: authorizationCode.user?.id },
        );
        return NextResponse.json(
          {
            error: 'server_error',
            error_description: 'Upstream did not issue a refresh token',
          },
          { status: 502 },
        );
      }

      // Save the token
      logger.info('Saving token for authorization_code grant');
      const token = await model.saveToken({
        accessToken: authorizationCode.token.access_token,
        refreshToken: upstreamRefreshToken,
        expires_at: authorizationCode.token.access_token_expires_at,
        client: client,
        user: authorizationCode.user,
        scope: authorizationCode.scope,
        grant: authorizationCode.grant,
      });

      await model.saveRefreshToken({
        refreshToken: upstreamRefreshToken,
        accessToken: token.accessToken,
      });

      identify(
        {
          id: authorizationCode.user.id,
          name: authorizationCode.user.name,
          email: authorizationCode.user.email,
          isOrg: authorizationCode.user.isOrg ?? false,
        },
        {
          context: {
            client: {
              id: client.id,
              name: client.client_name,
            },
          },
        },
      );

      waitUntil(flushAnalytics());

      // Revoke the authorization code, it can only be used once
      await model.revokeAuthorizationCode(authorizationCode);
      logger.info('Authorization code exchanged successfully');

      return NextResponse.json({
        access_token: token.accessToken,
        expires_in: toSeconds(token.expires_at - Date.now()),
        token_type: 'bearer',
        refresh_token: token.refreshToken,
        scope: authorizationCode.scope,
      });
    } else if (grantType === 'refresh_token') {
      logger.info('Processing refresh_token grant');
      const sloStartMs = Date.now();
      const refreshToken = formData.get('refresh_token');
      if (!refreshToken) {
        logger.warn('Refresh token missing from request');
        emitRefreshSlo('bad_request', sloStartMs, {
          clientId: client.id,
          reason: 'missing_refresh_token',
        });
        return NextResponse.json(
          {
            error: 'invalid_request',
            error_description: 'refresh_token is required',
          },
          { status: 400 },
        );
      }

      // Absorb retry storms: if upstream already rejected this RT recently,
      // skip the singleflight + upstream call and return the cached failure.
      const cachedFailure = await model
        .getRefreshFailure(refreshToken)
        .catch(() => undefined);
      if (cachedFailure) {
        logger.info('Refresh token in failure cache; rejecting fast', {
          clientId: client.id,
          ageMs: Date.now() - cachedFailure.failedAt,
          oauthError: cachedFailure.oauthError,
        });
        emitRefreshSlo('correct_invalid_grant', sloStartMs, {
          clientId: client.id,
          reason: 'failure_cache_hit',
          upstreamOauthError: cachedFailure.oauthError,
        });
        return NextResponse.json(
          {
            error: 'invalid_grant',
            error_description: 'Invalid or expired refresh token',
          },
          { status: 400 },
        );
      }

      const cachedToResponse = (cached: {
        accessToken: string;
        refreshToken: string;
        expiresAt: number;
        scope?: string | string[];
      }): RefreshTokenResult => ({
        access_token: cached.accessToken,
        expires_in: toSeconds(cached.expiresAt - Date.now()),
        token_type: 'bearer' as const,
        refresh_token: cached.refreshToken,
        scope: cached.scope,
      });

      // Used by the outer catch to fold a winning peer's success cache write
      // into our own response — never throws.
      const checkSuccessCache = async (): Promise<
        RefreshTokenResult | undefined
      > => {
        const cached = await model
          .getRefreshResult(refreshToken)
          .catch(() => undefined);
        return cached ? cachedToResponse(cached) : undefined;
      };

      // Used by the lock-waiter poll loop. The failure cache wins: if a peer
      // marked this RT dead (either via an upstream 4xx or a pre-upstream
      // RT-not-found / client-mismatch), throw RefreshError so the waiter
      // surfaces 400 immediately instead of polling until the lock-wait
      // timeout and surfacing 503.
      const peekResolution = async (): Promise<
        RefreshTokenResult | undefined
      > => {
        const failure = await model
          .getRefreshFailure(refreshToken)
          .catch(() => undefined);
        if (failure) {
          throw new RefreshError(
            'invalid_grant',
            'Invalid or expired refresh token',
            400,
            'correct_invalid_grant',
          );
        }
        // Holder may have hit upstream 5xx and signalled "don't wait, retry
        // shortly." Surface 503 immediately rather than polling for 5s.
        if (await peekTransientFailure(refreshToken)) {
          throw new RefreshError(
            'server_error',
            'Upstream temporarily unavailable; please retry',
            503,
            'transient_upstream_5xx',
          );
        }
        return checkSuccessCache();
      };

      try {
        // Distributed lock + singleflight + cross-instance cache, in order:
        //   - withRefreshLock holds a Redis lock so two Vercel instances
        //     can't both forward the same RT to upstream Hydra and trigger
        //     reuse-detection (which would revoke the entire chain).
        //   - The peek closure lets a waiter return as soon as the lock
        //     holder writes the success cache, avoiding the upstream call
        //     entirely.
        //   - Inside the lock, singleflight still dedups same-instance
        //     concurrent calls so we don't spam Redis SET ops.
        const result = await withRefreshLock(
          refreshToken,
          () =>
            singleflight(`refresh:${refreshToken}`, () =>
              executeRefresh(refreshToken, client),
            ),
          peekResolution,
        );
        logger.info('Returning refresh token response');
        emitRefreshSlo('success', sloStartMs, { clientId: client.id });
        return NextResponse.json(result);
      } catch (error) {
        // Cross-instance fallback: if another instance already completed the
        // refresh, the distributed cache will have the result. Also covers
        // the persist-failure degrade path: executeRefresh writes the cache
        // BEFORE the persist phase, so a persist failure leaves the cache
        // populated and the client gets a clean 200 from here instead of a
        // 500 + immediate cliff.
        if (error instanceof RefreshError) {
          const cached = await checkSuccessCache();
          if (cached) {
            // Persist-failure is special: we want the SLO to count it as a
            // bad outcome even though the user gets a 200. Without this
            // override, the metric would silently mask Postgres degradation.
            // Other RefreshError-with-cache cases are genuine cache replays.
            const sloBucket: SloOutcome =
              error.sloOutcome === 'transient_persist_failure'
                ? 'transient_persist_failure'
                : 'success';
            logger.info(
              'Returning cached refresh result (cross-instance hit)',
              {
                sloBucket,
                underlyingOutcome: error.sloOutcome,
              },
            );
            emitRefreshSlo(sloBucket, sloStartMs, {
              clientId: client.id,
              reason:
                error.sloOutcome === 'transient_persist_failure'
                  ? 'recovered_via_cache'
                  : 'cache_replay_after_error',
            });
            return NextResponse.json(cached);
          }

          emitRefreshSlo(error.sloOutcome, sloStartMs, {
            clientId: client.id,
          });
          return NextResponse.json(
            {
              error: error.oauthError,
              error_description: error.description,
            },
            { status: error.statusCode },
          );
        }
        // Lock-wait timeout: surface as 503 so the client retries.
        if (
          error instanceof Error &&
          'status' in error &&
          (error as { status: unknown }).status === 503
        ) {
          logger.info('Refresh lock waiter timed out; returning 503 for retry');
          emitRefreshSlo('transient_lock_timeout', sloStartMs, {
            clientId: client.id,
          });
          return NextResponse.json(
            {
              error: 'temporarily_unavailable',
              error_description:
                'A refresh of this token is in progress; please retry shortly',
            },
            { status: 503 },
          );
        }
        throw error;
      }
    }

    logger.warn('Invalid grant type', { grantType });
    return NextResponse.json(
      {
        error: 'unsupported_grant_type',
        error_description: 'Unsupported grant type',
      },
      { status: 400 },
    );
  } catch (error: unknown) {
    logger.error('Token endpoint error', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return handleOAuthError(error, 'Token exchange error');
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
