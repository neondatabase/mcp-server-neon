/**
 * Integration tests for the refresh token flow.
 *
 * Tests the actual POST /api/token route handler with mocked model and
 * upstream OAuth exchange. Verifies singleflight coalescing (same-instance)
 * and distributed cache fallback (cross-instance) behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../oauth/model', () => ({
  model: {
    getClient: vi.fn(),
    getRefreshToken: vi.fn(),
    getAccessToken: vi.fn(),
    saveToken: vi.fn(),
    saveRefreshToken: vi.fn(),
    deleteToken: vi.fn(),
    deleteRefreshToken: vi.fn(),
    saveRefreshResult: vi.fn(),
    getRefreshResult: vi.fn(),
    saveRefreshFailure: vi.fn(),
    getRefreshFailure: vi.fn(),
  },
}));

vi.mock('../../lib/oauth/client', () => ({
  exchangeRefreshToken: vi.fn(),
}));

vi.mock('../oauth/utils', () => ({
  verifyPKCE: vi.fn().mockReturnValue(true),
}));

vi.mock('../analytics/analytics', () => ({
  identify: vi.fn(),
  flushAnalytics: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/errors', () => ({
  handleOAuthError: vi.fn(
    () =>
      new Response(JSON.stringify({ error: 'server_error' }), { status: 500 }),
  ),
}));

vi.mock('@vercel/functions', () => ({
  waitUntil: vi.fn(),
}));

// Default: lock is a passthrough — keeps the existing tests focused on the
// underlying refresh logic rather than the lock plumbing. The dedicated
// `refresh-lock.test.ts` covers acquire/wait/release semantics.
const mockSignalTransientFailure = vi.fn().mockResolvedValue(undefined);
const mockPeekTransientFailure = vi.fn().mockResolvedValue(false);
// Capture the ReleaseHint that executeRefresh mutates so tests can assert on
// it (replaces the pre-atomic-Lua `signalTransientFailure` call signature).
let lastReleaseHint: { markTransientForWaiters?: boolean } | undefined;
vi.mock('../oauth/refresh-lock', () => ({
  withRefreshLock: vi.fn(
    async (
      _token: string,
      execute: (hint: { markTransientForWaiters?: boolean }) => unknown,
    ) => {
      lastReleaseHint = {};
      return execute(lastReleaseHint);
    },
  ),
  signalTransientFailure: (...args: unknown[]) =>
    mockSignalTransientFailure(...args),
  peekTransientFailure: (...args: unknown[]) =>
    mockPeekTransientFailure(...args),
}));

// Spy on logger so SLO assertions can read what was emitted.
const loggerInfoSpy = vi.fn();
vi.mock('../utils/logger', () => ({
  logger: {
    info: (...args: unknown[]) => loggerInfoSpy(...args),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

function lastSloLine(): string | undefined {
  for (let i = loggerInfoSpy.mock.calls.length - 1; i >= 0; i--) {
    const arg = loggerInfoSpy.mock.calls[i][0];
    if (typeof arg === 'string' && arg.startsWith('[SLO] refresh ')) return arg;
  }
  return undefined;
}

import { POST } from '../../app/api/token/route';
import { model } from '../oauth/model';
import { exchangeRefreshToken } from '../../lib/oauth/client';
import { NextRequest } from 'next/server';

const mockModel = vi.mocked(model);
const mockExchange = vi.mocked(exchangeRefreshToken);

const TEST_CLIENT = {
  id: 'client-1',
  secret: 'secret-1',
  grants: ['refresh_token'],
  redirect_uris: ['http://localhost/callback'],
  client_name: 'Test Client',
  tokenEndpointAuthMethod: 'client_secret_post',
};

const TEST_OLD_ACCESS_TOKEN = {
  accessToken: 'old-access-token',
  refreshToken: 'old-refresh-token',
  expires_at: Date.now() + 3600_000,
  client: TEST_CLIENT,
  user: { id: 'user-1', name: 'Test User', email: 'test@example.com' },
  scope: 'read write',
};

const TEST_REFRESH_TOKEN_RECORD = {
  refreshToken: 'old-refresh-token',
  accessToken: 'old-access-token',
};

function makeTokenRequest(
  refreshToken: string,
  clientId = 'client-1',
  clientSecret = 'secret-1',
): NextRequest {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  return new NextRequest('http://localhost/api/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
}

function makeUpstreamTokenResponse(overrides: Record<string, unknown> = {}) {
  return {
    access_token: 'new-access-token',
    refresh_token: 'new-refresh-token',
    expiresIn: () => 3600,
    ...overrides,
  };
}

describe('Token refresh flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loggerInfoSpy.mockClear();

    mockModel.getClient.mockResolvedValue(TEST_CLIENT as any);
    mockModel.getRefreshToken.mockResolvedValue(TEST_REFRESH_TOKEN_RECORD);
    mockModel.getAccessToken.mockResolvedValue(TEST_OLD_ACCESS_TOKEN as any);
    mockModel.saveToken.mockImplementation(async (token: any) => token);
    mockModel.saveRefreshToken.mockResolvedValue({} as any);
    mockModel.deleteToken.mockResolvedValue(true);
    mockModel.deleteRefreshToken.mockResolvedValue(true);
    mockModel.saveRefreshResult.mockResolvedValue(undefined);
    mockModel.getRefreshResult.mockResolvedValue(undefined);
    mockModel.saveRefreshFailure.mockResolvedValue(undefined);
    mockModel.getRefreshFailure.mockResolvedValue(undefined);
  });

  it('happy path: refreshes token and returns new tokens', async () => {
    mockExchange.mockResolvedValue(makeUpstreamTokenResponse() as any);

    const response = await POST(makeTokenRequest('old-refresh-token'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.access_token).toBe('new-access-token');
    expect(body.refresh_token).toBe('new-refresh-token');
    expect(body.token_type).toBe('bearer');
    expect(body.expires_in).toBeGreaterThan(0);

    expect(mockExchange).toHaveBeenCalledTimes(1);
    expect(mockModel.saveToken).toHaveBeenCalledTimes(1);
    expect(mockModel.saveRefreshToken).toHaveBeenCalledTimes(1);
    expect(mockModel.deleteToken).toHaveBeenCalledTimes(1);
    expect(mockModel.deleteRefreshToken).toHaveBeenCalledTimes(1);
    expect(mockModel.saveRefreshResult).toHaveBeenCalledTimes(1);
  });

  it('does not delete refresh token when upstream reuses the same token string', async () => {
    mockExchange.mockResolvedValue(
      makeUpstreamTokenResponse({ refresh_token: undefined }) as any,
    );

    const response = await POST(makeTokenRequest('old-refresh-token'));
    expect(response.status).toBe(200);

    expect(mockModel.saveRefreshToken).toHaveBeenCalledTimes(1);
    expect(mockModel.deleteRefreshToken).not.toHaveBeenCalled();
  });

  describe('singleflight coalescing (same-instance)', () => {
    it('concurrent requests with same refresh token share one upstream call', async () => {
      let resolveExchange!: (value: any) => void;
      mockExchange.mockReturnValue(
        new Promise((resolve) => {
          resolveExchange = resolve;
        }),
      );

      const req1 = POST(makeTokenRequest('old-refresh-token'));
      const req2 = POST(makeTokenRequest('old-refresh-token'));

      resolveExchange(makeUpstreamTokenResponse());

      const [response1, response2] = await Promise.all([req1, req2]);
      const [body1, body2] = await Promise.all([
        response1.json(),
        response2.json(),
      ]);

      expect(response1.status).toBe(200);
      expect(response2.status).toBe(200);
      expect(body1.access_token).toBe('new-access-token');
      expect(body2.access_token).toBe('new-access-token');

      expect(mockExchange).toHaveBeenCalledTimes(1);
    });
  });

  describe('distributed cache fallback (cross-instance)', () => {
    it('returns cached result when refresh token is already consumed', async () => {
      mockModel.getRefreshToken.mockResolvedValue(undefined);

      mockModel.getRefreshResult.mockResolvedValue({
        accessToken: 'cached-access-token',
        refreshToken: 'cached-refresh-token',
        expiresAt: Date.now() + 3600_000,
        scope: 'read write',
      });

      const response = await POST(makeTokenRequest('old-refresh-token'));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.access_token).toBe('cached-access-token');
      expect(body.refresh_token).toBe('cached-refresh-token');

      expect(mockExchange).not.toHaveBeenCalled();
    });

    it('returns cached result when upstream rejects with 4xx (token rotation)', async () => {
      const upstreamError = new Error('invalid_grant') as Error & {
        status: number;
      };
      upstreamError.status = 400;
      mockExchange.mockRejectedValue(upstreamError);

      mockModel.getRefreshResult.mockResolvedValue({
        accessToken: 'cached-access-token',
        refreshToken: 'cached-refresh-token',
        expiresAt: Date.now() + 3600_000,
        scope: 'read write',
      });

      const response = await POST(makeTokenRequest('old-refresh-token'));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.access_token).toBe('cached-access-token');
      expect(body.refresh_token).toBe('cached-refresh-token');
    });

    it('returns error when no cache hit and token is gone', async () => {
      mockModel.getRefreshToken.mockResolvedValue(undefined);
      mockModel.getRefreshResult.mockResolvedValue(undefined);

      const response = await POST(makeTokenRequest('old-refresh-token'));
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('invalid_grant');
    });

    it('returns error when upstream rejects and no cache hit', async () => {
      const upstreamError = new Error('invalid_grant') as Error & {
        status: number;
      };
      upstreamError.status = 400;
      mockExchange.mockRejectedValue(upstreamError);
      mockModel.getRefreshResult.mockResolvedValue(undefined);

      const response = await POST(makeTokenRequest('old-refresh-token'));
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('invalid_grant');
    });
  });

  describe('transient errors', () => {
    it('returns 503 on upstream 5xx without deleting tokens', async () => {
      const upstreamError = new Error('Internal Server Error') as Error & {
        status: number;
      };
      upstreamError.status = 500;
      mockExchange.mockRejectedValue(upstreamError);

      const response = await POST(makeTokenRequest('old-refresh-token'));
      const body = await response.json();

      expect(response.status).toBe(503);
      expect(body.error).toBe('server_error');

      expect(mockModel.deleteToken).not.toHaveBeenCalled();
      expect(mockModel.deleteRefreshToken).not.toHaveBeenCalled();
    });

    it('marks the release hint on upstream 5xx so the lock release also writes the transient marker atomically', async () => {
      // executeRefresh now mutates the ReleaseHint passed by withRefreshLock
      // instead of calling signalTransientFailure directly — see
      // RELEASE_WITH_TRANSIENT_LUA in refresh-lock.ts. This test pins the
      // contract: a 5xx upstream response must set markTransientForWaiters so
      // waiters bail fast as transient_upstream_5xx instead of timing out.
      const upstreamError = new Error('Internal Server Error') as Error & {
        status: number;
      };
      upstreamError.status = 500;
      mockExchange.mockRejectedValue(upstreamError);

      await POST(makeTokenRequest('old-refresh-token'));

      expect(lastReleaseHint).toBeDefined();
      expect(lastReleaseHint?.markTransientForWaiters).toBe(true);
    });

    it('does not mark the release hint on upstream 4xx (it is a hard cliff, not transient)', async () => {
      const upstreamError = new Error('inactive') as Error & {
        status: number;
        error?: string;
      };
      upstreamError.status = 401;
      upstreamError.error = 'token_inactive';
      mockExchange.mockRejectedValue(upstreamError);

      await POST(makeTokenRequest('old-refresh-token'));

      expect(lastReleaseHint?.markTransientForWaiters).toBeUndefined();
    });

    describe('upstream call timeout (slow Hydra cap)', () => {
      // Production data shows Hydra holds connections open during 5xx bursts —
      // 5xx events are bimodal (<200ms or 4-37s). Capping the upstream call
      // at 4.5s forces the slow-mode response into the 5xx code path before
      // waiters exhaust their lock-poll budget. The lock release then writes
      // the transient marker (atomic Lua) and waiters bail fast as
      // transient_upstream_5xx (excluded from SLO) instead of cascading into
      // transient_lock_timeout (counts BAD).

      it('exchange that exceeds 4.5s is cancelled and surfaces as transient_upstream_5xx', async () => {
        vi.useFakeTimers();
        try {
          // Promise that never resolves — simulates Hydra holding the
          // connection open (the production failure mode we're guarding
          // against).
          mockExchange.mockReturnValue(
            new Promise(() => {
              /* never resolves */
            }) as never,
          );

          const responsePromise = POST(makeTokenRequest('old-refresh-token'));
          // Advance past the 4.5s upstream cap.
          await vi.advanceTimersByTimeAsync(5_000);

          const response = await responsePromise;
          expect(response.status).toBe(503);

          const body = await response.json();
          expect(body.error).toBe('server_error');

          // Atomic Lua release path: the holder's catch sets
          // markTransientForWaiters so waiters bail fast.
          expect(lastReleaseHint?.markTransientForWaiters).toBe(true);

          // SLO bucket: transient_upstream_5xx (excluded from SLO).
          expect(lastSloLine()).toMatch(/outcome=transient_upstream_5xx\b/);
        } finally {
          vi.useRealTimers();
        }
      });

      it('upstream timeout is NOT retried (server-side outcome unknown)', async () => {
        vi.useFakeTimers();
        try {
          mockExchange.mockReturnValue(
            new Promise(() => {
              /* never resolves */
            }) as never,
          );

          const responsePromise = POST(makeTokenRequest('old-refresh-token'));
          await vi.advanceTimersByTimeAsync(5_000);
          await responsePromise;

          // Single attempt only — UpstreamTimeoutError is in the same
          // non-retry category as HTTP responses: outcome unknown
          // server-side, retrying could cliff the chain.
          expect(mockExchange).toHaveBeenCalledTimes(1);
        } finally {
          vi.useRealTimers();
        }
      });

      it('upstream timeout does NOT delete tokens (different from 4xx)', async () => {
        vi.useFakeTimers();
        try {
          mockExchange.mockReturnValue(
            new Promise(() => {
              /* never resolves */
            }) as never,
          );

          const responsePromise = POST(makeTokenRequest('old-refresh-token'));
          await vi.advanceTimersByTimeAsync(5_000);
          await responsePromise;

          // Tokens stay alive — client retries should keep working once
          // upstream recovers.
          expect(mockModel.deleteToken).not.toHaveBeenCalled();
          expect(mockModel.deleteRefreshToken).not.toHaveBeenCalled();
          expect(mockModel.saveRefreshFailure).not.toHaveBeenCalled();
        } finally {
          vi.useRealTimers();
        }
      });

      it('exchange that completes inside the 4.5s budget is unaffected', async () => {
        // Healthy success p99 in production is ~700ms; assert the happy
        // path is not regressed by the new cap.
        mockExchange.mockResolvedValue(makeUpstreamTokenResponse() as never);

        const response = await POST(makeTokenRequest('old-refresh-token'));
        expect(response.status).toBe(200);
        expect(lastSloLine()).toMatch(/outcome=success\b/);
      });

      it('passes an AbortSignal to exchangeRefreshToken and aborts it on timeout (cancels in-flight socket)', async () => {
        // Without an AbortController wired through, Promise.race just
        // unblocks the await; the underlying fetch keeps the socket open
        // until the OS-level timeout. This test pins the contract: the
        // signal IS passed and IS aborted at the cap.
        vi.useFakeTimers();
        try {
          let capturedSignal: AbortSignal | undefined;
          mockExchange.mockImplementation((_token, signal) => {
            capturedSignal = signal;
            return new Promise(() => {
              /* never resolves */
            }) as never;
          });

          const responsePromise = POST(makeTokenRequest('old-refresh-token'));
          await vi.advanceTimersByTimeAsync(5_000);
          await responsePromise;

          expect(capturedSignal).toBeDefined();
          expect(capturedSignal?.aborted).toBe(true);
        } finally {
          vi.useRealTimers();
        }
      });
    });
  });

  describe('failure cache (retry storm absorption)', () => {
    it('writes failure cache when upstream rejects with 4xx', async () => {
      const upstreamError = new Error(
        'server responded with an error in the response body',
      ) as Error & {
        status: number;
        error?: string;
        error_description?: string;
      };
      upstreamError.status = 400;
      upstreamError.error = 'invalid_grant';
      upstreamError.error_description = 'token expired';
      mockExchange.mockRejectedValue(upstreamError);

      const response = await POST(makeTokenRequest('old-refresh-token'));
      expect(response.status).toBe(400);

      expect(mockModel.saveRefreshFailure).toHaveBeenCalledTimes(1);
      const [token, detail] = mockModel.saveRefreshFailure.mock.calls[0];
      expect(token).toBe('old-refresh-token');
      expect(detail.oauthError).toBe('invalid_grant');
      expect(detail.oauthErrorDescription).toBe('token expired');
      expect(typeof detail.failedAt).toBe('number');
    });

    it('rejects fast without calling upstream when failure is cached', async () => {
      mockModel.getRefreshFailure.mockResolvedValue({
        failedAt: Date.now() - 5_000,
        oauthError: 'invalid_grant',
      });

      const response = await POST(makeTokenRequest('old-refresh-token'));
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('invalid_grant');

      // Critical: upstream must not be touched, and we must not even consult
      // the success cache or refresh-token store.
      expect(mockExchange).not.toHaveBeenCalled();
      expect(mockModel.getRefreshToken).not.toHaveBeenCalled();
      expect(mockModel.getRefreshResult).not.toHaveBeenCalled();
    });

    it('does not cache failure on transient 5xx', async () => {
      const upstreamError = new Error('Internal Server Error') as Error & {
        status: number;
      };
      upstreamError.status = 503;
      mockExchange.mockRejectedValue(upstreamError);

      await POST(makeTokenRequest('old-refresh-token'));

      expect(mockModel.saveRefreshFailure).not.toHaveBeenCalled();
    });
  });

  describe('pre-upstream failure cache (waiter 503 → 400 fix)', () => {
    it('caches failure when refresh_token is not in storage', async () => {
      mockModel.getRefreshToken.mockResolvedValue(undefined);

      const response = await POST(makeTokenRequest('stale-rt'));
      expect(response.status).toBe(400);

      expect(mockModel.saveRefreshFailure).toHaveBeenCalledTimes(1);
      const [token, detail] = mockModel.saveRefreshFailure.mock.calls[0];
      expect(token).toBe('stale-rt');
      expect(detail.oauthError).toBe('invalid_grant');
      expect(detail.oauthErrorDescription).toBe('rt_not_found_in_storage');
      // Critical: upstream must NOT have been touched.
      expect(mockExchange).not.toHaveBeenCalled();
    });

    it('caches failure when access_token for the refresh_token is missing', async () => {
      mockModel.getAccessToken.mockResolvedValue(undefined);

      const response = await POST(makeTokenRequest('old-refresh-token'));
      expect(response.status).toBe(400);

      expect(mockModel.saveRefreshFailure).toHaveBeenCalledTimes(1);
      const [, detail] = mockModel.saveRefreshFailure.mock.calls[0];
      expect(detail.oauthErrorDescription).toBe('access_token_not_found');
      // Existing cleanup behaviour preserved.
      expect(mockModel.deleteRefreshToken).toHaveBeenCalledTimes(1);
      expect(mockExchange).not.toHaveBeenCalled();
    });

    it('caches failure when client_id does not match the token', async () => {
      mockModel.getAccessToken.mockResolvedValue({
        ...TEST_OLD_ACCESS_TOKEN,
        client: { ...TEST_CLIENT, id: 'different-client' },
      } as never);

      const response = await POST(makeTokenRequest('old-refresh-token'));
      expect(response.status).toBe(400);

      expect(mockModel.saveRefreshFailure).toHaveBeenCalledTimes(1);
      const [, detail] = mockModel.saveRefreshFailure.mock.calls[0];
      expect(detail.oauthErrorDescription).toBe('client_mismatch');
      expect(mockExchange).not.toHaveBeenCalled();
    });
  });

  describe('SLO instrumentation', () => {
    it('happy path emits outcome=success', async () => {
      mockExchange.mockResolvedValue(makeUpstreamTokenResponse() as never);
      const response = await POST(makeTokenRequest('old-refresh-token'));
      expect(response.status).toBe(200);
      const line = lastSloLine();
      expect(line).toMatch(/outcome=success\b/);
      expect(line).toMatch(/elapsedMs=\d+/);
      expect(line).toMatch(/clientId=client-1/);
    });

    it('failure-cache fast-fail emits outcome=correct_invalid_grant', async () => {
      mockModel.getRefreshFailure.mockResolvedValue({
        failedAt: Date.now() - 5_000,
        oauthError: 'invalid_grant',
      });
      const response = await POST(makeTokenRequest('old-refresh-token'));
      expect(response.status).toBe(400);
      expect(lastSloLine()).toMatch(/outcome=correct_invalid_grant\b/);
      expect(lastSloLine()).toMatch(/reason=failure_cache_hit/);
    });

    it('RT-not-found emits outcome=correct_invalid_grant', async () => {
      mockModel.getRefreshToken.mockResolvedValue(undefined);
      const response = await POST(makeTokenRequest('stale-rt'));
      expect(response.status).toBe(400);
      expect(lastSloLine()).toMatch(/outcome=correct_invalid_grant\b/);
    });

    it('upstream 4xx emits outcome=cliff_upstream with upstreamOauthError plumbed through', async () => {
      const upstreamError = new Error('inactive') as Error & {
        status: number;
        error?: string;
      };
      upstreamError.status = 401;
      upstreamError.error = 'token_inactive';
      mockExchange.mockRejectedValue(upstreamError);

      const response = await POST(makeTokenRequest('old-refresh-token'));
      expect(response.status).toBe(400);
      expect(lastSloLine()).toMatch(/outcome=cliff_upstream\b/);
      // Inv 3 plumbing: cliff events now carry the upstream OAuth error
      // code so cliff bursts can be classified by upstream cause via a
      // single grep pipeline (token_inactive vs invalid_client vs
      // invalid_request).
      expect(lastSloLine()).toMatch(/upstreamOauthError=token_inactive\b/);
    });

    it('upstream 5xx emits outcome=transient_upstream_5xx', async () => {
      const upstreamError = new Error('boom') as Error & { status: number };
      upstreamError.status = 502;
      mockExchange.mockRejectedValue(upstreamError);

      const response = await POST(makeTokenRequest('old-refresh-token'));
      expect(response.status).toBe(503);
      expect(lastSloLine()).toMatch(/outcome=transient_upstream_5xx\b/);
    });

    it('upstream HTTP 5xx is NOT retried (response means Hydra processed it)', async () => {
      const upstreamError = new Error('boom') as Error & { status: number };
      upstreamError.status = 502;
      mockExchange.mockRejectedValue(upstreamError);

      await POST(makeTokenRequest('old-refresh-token'));
      // Single attempt only — the retryAsync.shouldRetry guard skips HTTP
      // responses to avoid presenting an already-rotated RT.
      expect(mockExchange).toHaveBeenCalledTimes(1);
    });

    it('upstream ECONNRESET emits outcome=transient_upstream_network', async () => {
      // openid-client wraps fetch errors as TypeError "fetch failed" with
      // .cause being the underlying Node error. Replicate that shape.
      const inner = new Error('read ECONNRESET') as Error & { code?: string };
      inner.code = 'ECONNRESET';
      const wrapped = new TypeError('fetch failed') as TypeError & {
        cause?: unknown;
      };
      wrapped.cause = inner;
      mockExchange.mockRejectedValue(wrapped);

      const response = await POST(makeTokenRequest('old-refresh-token'));
      expect(response.status).toBe(503);
      expect(lastSloLine()).toMatch(/outcome=transient_upstream_network\b/);
    });

    it('upstream network error is retried, succeeds on attempt 2', async () => {
      const inner = new Error('connect ETIMEDOUT') as Error & { code?: string };
      inner.code = 'ETIMEDOUT';
      const wrapped = new TypeError('fetch failed') as TypeError & {
        cause?: unknown;
      };
      wrapped.cause = inner;
      mockExchange
        .mockRejectedValueOnce(wrapped)
        .mockResolvedValue(makeUpstreamTokenResponse() as never);

      const response = await POST(makeTokenRequest('old-refresh-token'));
      expect(response.status).toBe(200);
      expect(lastSloLine()).toMatch(/outcome=success\b/);
      expect(mockExchange).toHaveBeenCalledTimes(2);
    });

    it('upstream network error that survives all retries surfaces as transient_upstream_network', async () => {
      const inner = new Error('getaddrinfo ENOTFOUND') as Error & {
        code?: string;
      };
      inner.code = 'ENOTFOUND';
      const wrapped = new TypeError('fetch failed') as TypeError & {
        cause?: unknown;
      };
      wrapped.cause = inner;
      mockExchange.mockRejectedValue(wrapped);

      await POST(makeTokenRequest('old-refresh-token'));
      // Two attempts (the retryAsync configured for upstream uses attempts=2),
      // both fail, classify and emit.
      expect(mockExchange).toHaveBeenCalledTimes(2);
      expect(lastSloLine()).toMatch(/outcome=transient_upstream_network\b/);
    });

    it('persist failure after upstream success degrades to 200 via cache + SLO captures persist-failure', async () => {
      mockExchange.mockResolvedValue(makeUpstreamTokenResponse() as never);
      // saveToken fails on every retry attempt.
      mockModel.saveToken.mockRejectedValue(new Error('postgres down'));
      // The success cache lookup in the route's outer catch finds the
      // entry executeRefresh wrote BEFORE the persist phase.
      mockModel.getRefreshResult.mockResolvedValue({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expiresAt: Date.now() + 3600_000,
        scope: 'read write',
      });

      const response = await POST(makeTokenRequest('old-refresh-token'));
      const body = await response.json();

      // User-visible: success. They got tokens via the cross-instance cache.
      expect(response.status).toBe(200);
      expect(body.access_token).toBe('new-access-token');
      // SLO: bad outcome counted, even though user got 200. This is the
      // signal that lets us track Postgres degradation rates.
      expect(lastSloLine()).toMatch(/outcome=transient_persist_failure\b/);
      expect(lastSloLine()).toMatch(/reason=recovered_via_cache/);
    });

    it('persist retry — succeeds on attempt 2 emits outcome=success', async () => {
      mockExchange.mockResolvedValue(makeUpstreamTokenResponse() as never);
      mockModel.saveToken
        .mockRejectedValueOnce(new Error('transient blip'))
        .mockImplementation(async (token: any) => token);

      const response = await POST(makeTokenRequest('old-refresh-token'));
      expect(response.status).toBe(200);
      expect(lastSloLine()).toMatch(/outcome=success\b/);
      expect(mockModel.saveToken).toHaveBeenCalledTimes(2);
    });

    it('missing refresh_token in body emits outcome=bad_request', async () => {
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: TEST_CLIENT.id,
        client_secret: TEST_CLIENT.secret,
      });
      const req = new NextRequest('http://localhost/api/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      const response = await POST(req);
      expect(response.status).toBe(400);
      expect(lastSloLine()).toMatch(/outcome=bad_request\b/);
    });
  });
});
