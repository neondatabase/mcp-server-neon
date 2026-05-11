import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

// Shared spies; the `createClient` mock below closes over them so tests can
// assert against Redis calls without touching real Redis.
const setSpy = vi.fn();
const getSpy = vi.fn();
const delSpy = vi.fn();
const connectSpy = vi.fn();
const loggerInfoSpy = vi.fn();
const loggerWarnSpy = vi.fn();
const loggerErrorSpy = vi.fn();
const loggerDebugSpy = vi.fn();

vi.mock('redis', () => ({
  createClient: vi.fn(() => ({
    on: vi.fn(),
    connect: connectSpy,
    set: setSpy,
    get: getSpy,
    del: delSpy,
  })),
}));

vi.mock('../utils/logger', () => ({
  logger: {
    info: loggerInfoSpy,
    warn: loggerWarnSpy,
    error: loggerErrorSpy,
    debug: loggerDebugSpy,
  },
}));

function lastSseBindLine(): string | null {
  for (let i = loggerInfoSpy.mock.calls.length - 1; i >= 0; i--) {
    const arg = loggerInfoSpy.mock.calls[i]?.[0];
    if (typeof arg === 'string' && arg.startsWith('[SEC] sse-bind ')) {
      return arg;
    }
  }
  return null;
}

// `session-binding` memoises the Redis client in a module-level promise, which
// survives between tests unless we isolate the module. `vi.resetModules()` in
// beforeEach gives each test a fresh module graph.
async function loadModule() {
  return import('../server/session-binding');
}

function buildAuthInfo(overrides?: {
  accountId?: string | null;
  clientId?: unknown;
  apiKey?: unknown;
  extraMissing?: boolean;
}): AuthInfo | undefined {
  if (overrides?.extraMissing) {
    return { token: 't', scopes: [], clientId: 'c' } as AuthInfo;
  }
  return {
    token: 't',
    scopes: [],
    clientId: overrides?.clientId === undefined ? 'c' : overrides.clientId,
    extra: {
      account:
        overrides?.accountId === null
          ? undefined
          : { id: overrides?.accountId ?? 'acct_123', name: 'A' },
      // apiKey is kept on extra so the AuthContext shape stays realistic,
      // but it's no longer part of the identity binding.
      apiKey: overrides?.apiKey === undefined ? 'sk_secret' : overrides.apiKey,
    },
  } as unknown as AuthInfo;
}

describe('deriveIdentity', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns null when authInfo is undefined', async () => {
    const { deriveIdentity } = await loadModule();
    expect(deriveIdentity(undefined)).toBeNull();
  });

  it('returns null when extra is missing', async () => {
    const { deriveIdentity } = await loadModule();
    expect(deriveIdentity(buildAuthInfo({ extraMissing: true }))).toBeNull();
  });

  it('returns null when accountId is missing', async () => {
    const { deriveIdentity } = await loadModule();
    expect(deriveIdentity(buildAuthInfo({ accountId: null }))).toBeNull();
  });

  it('returns null when clientId is not a string', async () => {
    const { deriveIdentity } = await loadModule();
    expect(deriveIdentity(buildAuthInfo({ clientId: null }))).toBeNull();
    expect(deriveIdentity(buildAuthInfo({ clientId: 42 }))).toBeNull();
    expect(deriveIdentity(buildAuthInfo({ clientId: undefined }))).toBeTruthy();
    // ^ default 'c' kicks in; sanity check the fixture.
  });

  it('apiKey is ignored — same account + same clientId yields the same identity regardless of apiKey', async () => {
    // Regression for the Cursor re-auth UX bug: identity must NOT flip when
    // the bearer rotates within the same OAuth client. The whole point of
    // this fix is that token rotation is transparent to the SSE binding.
    const { deriveIdentity } = await loadModule();
    const a = deriveIdentity(buildAuthInfo({ apiKey: 'sk_one' }));
    const b = deriveIdentity(buildAuthInfo({ apiKey: 'sk_two' }));
    expect(a).toBe(b);
  });

  it('produces a 32-char lowercase hex fingerprint', async () => {
    const { deriveIdentity } = await loadModule();
    const id = deriveIdentity(buildAuthInfo());
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it('is stable for the same inputs', async () => {
    const { deriveIdentity } = await loadModule();
    expect(deriveIdentity(buildAuthInfo())).toBe(
      deriveIdentity(buildAuthInfo()),
    );
  });

  it('changes when accountId changes', async () => {
    const { deriveIdentity } = await loadModule();
    const a = deriveIdentity(buildAuthInfo({ accountId: 'acct_A' }));
    const b = deriveIdentity(buildAuthInfo({ accountId: 'acct_B' }));
    expect(a).not.toBe(b);
  });

  it('changes when clientId changes (same account, different OAuth client)', async () => {
    const { deriveIdentity } = await loadModule();
    const a = deriveIdentity(buildAuthInfo({ clientId: 'client_A' }));
    const b = deriveIdentity(buildAuthInfo({ clientId: 'client_B' }));
    expect(a).not.toBe(b);
  });

  it('does not leak the clientId in the fingerprint', async () => {
    const { deriveIdentity } = await loadModule();
    const id = deriveIdentity(buildAuthInfo({ clientId: 'super_secret_cli' }));
    expect(id).not.toContain('super');
    expect(id).not.toContain('secret');
  });
});

describe('bindSession / verifySession / releaseSession', () => {
  beforeEach(() => {
    vi.resetModules();
    setSpy.mockReset();
    getSpy.mockReset();
    delSpy.mockReset();
    connectSpy.mockReset();
    connectSpy.mockResolvedValue(undefined);
    process.env.KV_URL = 'redis://localhost:6379';
  });

  it('bindSession sets key with caller-provided TTL under mcp:session: prefix', async () => {
    const { bindSession } = await loadModule();
    setSpy.mockResolvedValue('OK');

    await bindSession('sess-abc', 'identity-xyz', 870);

    expect(setSpy).toHaveBeenCalledTimes(1);
    const [key, value, opts] = setSpy.mock.calls[0];
    expect(key).toBe('mcp:session:sess-abc');
    expect(value).toBe('identity-xyz');
    expect(opts).toEqual({ EX: 870 });
  });

  it('bindSession forwards whatever TTL the caller passes', async () => {
    const { bindSession } = await loadModule();
    setSpy.mockResolvedValue('OK');

    await bindSession('s', 'id', 42);

    expect(setSpy.mock.calls[0][2]).toEqual({ EX: 42 });
  });

  it('verifySession returns false when no binding exists', async () => {
    const { verifySession } = await loadModule();
    getSpy.mockResolvedValue(null);

    await expect(verifySession('sess', 'id')).resolves.toBe(false);
    expect(getSpy).toHaveBeenCalledWith('mcp:session:sess');
  });

  it('verifySession returns true when identity matches', async () => {
    const { verifySession } = await loadModule();
    getSpy.mockResolvedValue('id-match');

    await expect(verifySession('sess', 'id-match')).resolves.toBe(true);
  });

  it('verifySession returns false when identity mismatches (same length)', async () => {
    const { verifySession } = await loadModule();
    getSpy.mockResolvedValue('abcdef12');

    await expect(verifySession('sess', '12fedcba')).resolves.toBe(false);
  });

  it('verifySession returns false when identity length differs (timing-safe requires equal length)', async () => {
    const { verifySession } = await loadModule();
    getSpy.mockResolvedValue('short');

    await expect(verifySession('sess', 'much-longer-identity')).resolves.toBe(
      false,
    );
  });

  it('releaseSession deletes the binding key', async () => {
    const { releaseSession } = await loadModule();
    delSpy.mockResolvedValue(1);

    await releaseSession('sess-abc');

    expect(delSpy).toHaveBeenCalledWith('mcp:session:sess-abc');
  });

  it('reuses the same client across calls (connects once)', async () => {
    const { bindSession, verifySession, releaseSession } = await loadModule();
    setSpy.mockResolvedValue('OK');
    getSpy.mockResolvedValue('id');
    delSpy.mockResolvedValue(1);

    await bindSession('s', 'id', 60);
    await verifySession('s', 'id');
    await releaseSession('s');

    expect(connectSpy).toHaveBeenCalledTimes(1);
  });

  it('rejects when KV_URL and REDIS_URL are unset', async () => {
    delete process.env.KV_URL;
    delete process.env.REDIS_URL;
    const { bindSession } = await loadModule();

    await expect(bindSession('s', 'id', 60)).rejects.toThrow(
      /KV_URL\/REDIS_URL not set/,
    );
  });

  it('retries the connect after a failed initial connect (no sticky rejection)', async () => {
    connectSpy
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValue(undefined);
    setSpy.mockResolvedValue('OK');
    const { bindSession } = await loadModule();

    await expect(bindSession('s', 'id', 60)).rejects.toThrow(/transient/);
    // Second call should re-attempt connect with a fresh client rather than
    // inheriting the rejected promise from the first call.
    await expect(bindSession('s', 'id', 60)).resolves.toBeUndefined();
    expect(connectSpy).toHaveBeenCalledTimes(2);
  });

  it('concurrent first callers both reject when the initial connect fails, then a later call succeeds', async () => {
    // Documented behavior from the in-code comment: callers that latched the
    // in-flight clientPromise before connect rejected will share that
    // rejection. After the catch clears `clientPromise`, the next call gets a
    // fresh client.
    connectSpy
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValue(undefined);
    setSpy.mockResolvedValue('OK');
    const { bindSession } = await loadModule();

    const [a, b] = await Promise.allSettled([
      bindSession('s', 'id', 60),
      bindSession('s', 'id', 60),
    ]);
    expect(a.status).toBe('rejected');
    expect(b.status).toBe('rejected');
    if (a.status === 'rejected') expect(String(a.reason)).toMatch(/transient/);
    if (b.status === 'rejected') expect(String(b.reason)).toMatch(/transient/);

    // Third call after the catch clears clientPromise gets a fresh client.
    await expect(bindSession('s', 'id', 60)).resolves.toBeUndefined();
    expect(connectSpy).toHaveBeenCalledTimes(2);
  });
});

describe('evaluateMessageOwnership (POST /message 403 gate)', () => {
  beforeEach(() => {
    vi.resetModules();
    setSpy.mockReset();
    getSpy.mockReset();
    connectSpy.mockReset();
    connectSpy.mockResolvedValue(undefined);
    loggerInfoSpy.mockReset();
    loggerWarnSpy.mockReset();
    loggerErrorSpy.mockReset();
    process.env.KV_URL = 'redis://localhost:6379';
  });

  it('returns not-applicable for GET requests', async () => {
    const { evaluateMessageOwnership } = await loadModule();
    const r = await evaluateMessageOwnership(
      'GET',
      '/api/message',
      'sess',
      'id',
    );
    expect(r).toEqual({ kind: 'not-applicable' });
  });

  it('returns not-applicable for POSTs to non-/message paths', async () => {
    const { evaluateMessageOwnership } = await loadModule();
    const r = await evaluateMessageOwnership('POST', '/api/sse', 'sess', 'id');
    expect(r).toEqual({ kind: 'not-applicable' });
  });

  it('returns not-applicable when sessionId query param is absent', async () => {
    const { evaluateMessageOwnership } = await loadModule();
    const r = await evaluateMessageOwnership(
      'POST',
      '/api/message',
      null,
      'id',
    );
    expect(r).toEqual({ kind: 'not-applicable' });
  });

  it('rejects with 401 when identity cannot be derived', async () => {
    const { evaluateMessageOwnership } = await loadModule();
    const r = await evaluateMessageOwnership(
      'POST',
      '/api/message',
      'sess',
      null,
    );
    expect(r.kind).toBe('reject');
    if (r.kind === 'reject') expect(r.status).toBe(401);
  });

  it('rejects with 403 when verify returns false (no binding)', async () => {
    const { evaluateMessageOwnership } = await loadModule();
    getSpy.mockResolvedValue(null);

    const r = await evaluateMessageOwnership(
      'POST',
      '/api/message',
      'sess',
      'identity-A',
    );
    expect(r.kind).toBe('reject');
    if (r.kind === 'reject') expect(r.status).toBe(403);
    expect(getSpy).toHaveBeenCalledTimes(1);
  });

  it('rejects with 403 when caller identity differs from bound owner', async () => {
    const { evaluateMessageOwnership } = await loadModule();
    getSpy.mockResolvedValue('identity-A'); // SSE owner
    const r = await evaluateMessageOwnership(
      'POST',
      '/api/message',
      'sess',
      'identity-B', // different caller
    );
    expect(r.kind).toBe('reject');
    if (r.kind === 'reject') expect(r.status).toBe(403);
  });

  it('passes when caller identity matches bound owner', async () => {
    const { evaluateMessageOwnership } = await loadModule();
    getSpy.mockResolvedValue('identity-A');
    const r = await evaluateMessageOwnership(
      'POST',
      '/api/message',
      'sess',
      'identity-A',
    );
    expect(r).toEqual({ kind: 'pass' });
  });

  it('rejects with 503 when Redis throws (fail-closed)', async () => {
    const { evaluateMessageOwnership } = await loadModule();
    getSpy.mockRejectedValue(new Error('boom'));
    const r = await evaluateMessageOwnership(
      'POST',
      '/api/message',
      'sess',
      'identity-A',
    );
    expect(r.kind).toBe('reject');
    if (r.kind === 'reject') expect(r.status).toBe(503);
  });
});

describe('evaluateMessageOwnership emits [SEC] sse-bind outcomes', () => {
  beforeEach(() => {
    vi.resetModules();
    setSpy.mockReset();
    getSpy.mockReset();
    connectSpy.mockReset();
    connectSpy.mockResolvedValue(undefined);
    loggerInfoSpy.mockReset();
    process.env.KV_URL = 'redis://localhost:6379';
  });

  it('does NOT emit on not-applicable (GET, non-/message, missing sessionId)', async () => {
    const { evaluateMessageOwnership } = await loadModule();
    await evaluateMessageOwnership('GET', '/api/message', 'sess', 'id');
    await evaluateMessageOwnership('POST', '/api/sse', 'sess', 'id');
    await evaluateMessageOwnership('POST', '/api/message', null, 'id');
    expect(lastSseBindLine()).toBeNull();
  });

  it('emits caller_unidentified when identity is null', async () => {
    const { evaluateMessageOwnership } = await loadModule();
    await evaluateMessageOwnership('POST', '/api/message', 'sess', null);
    const line = lastSseBindLine();
    expect(line).not.toBeNull();
    expect(line).toContain('outcome=caller_unidentified');
    expect(line).toContain('sessionId=sess');
    expect(line).toContain('path=/api/message');
    expect(line).toMatch(/elapsedMs=\d+/);
  });

  it('emits binding_missing when Redis returns null', async () => {
    const { evaluateMessageOwnership } = await loadModule();
    getSpy.mockResolvedValue(null);
    await evaluateMessageOwnership(
      'POST',
      '/api/message',
      'sess',
      'identity-A',
    );
    expect(lastSseBindLine()).toContain('outcome=binding_missing');
  });

  it('emits binding_mismatch when stored identity differs', async () => {
    const { evaluateMessageOwnership } = await loadModule();
    getSpy.mockResolvedValue('identity-A');
    await evaluateMessageOwnership(
      'POST',
      '/api/message',
      'sess',
      'identity-B',
    );
    expect(lastSseBindLine()).toContain('outcome=binding_mismatch');
  });

  it('emits bound_ok on identity match', async () => {
    const { evaluateMessageOwnership } = await loadModule();
    getSpy.mockResolvedValue('identity-A');
    await evaluateMessageOwnership(
      'POST',
      '/api/message',
      'sess',
      'identity-A',
    );
    expect(lastSseBindLine()).toContain('outcome=bound_ok');
  });

  it('emits redis_error when Redis throws', async () => {
    const { evaluateMessageOwnership } = await loadModule();
    getSpy.mockRejectedValue(new Error('boom'));
    await evaluateMessageOwnership(
      'POST',
      '/api/message',
      'sess',
      'identity-A',
    );
    expect(lastSseBindLine()).toContain('outcome=redis_error');
  });
});

describe('emitSseBindOutcome formatting', () => {
  beforeEach(() => {
    vi.resetModules();
    loggerInfoSpy.mockReset();
  });

  it('emits a [SEC] sse-bind line with outcome and provided context fields', async () => {
    const { emitSseBindOutcome } = await loadModule();
    emitSseBindOutcome('envelope_mismatch', { invocation: 'list_projects' });
    expect(loggerInfoSpy).toHaveBeenCalledTimes(1);
    const line = loggerInfoSpy.mock.calls[0]?.[0];
    expect(line).toBe(
      '[SEC] sse-bind outcome=envelope_mismatch invocation=list_projects',
    );
  });

  it('omits context fields that are not set', async () => {
    const { emitSseBindOutcome } = await loadModule();
    emitSseBindOutcome('bound_ok');
    expect(loggerInfoSpy.mock.calls[0]?.[0]).toBe(
      '[SEC] sse-bind outcome=bound_ok',
    );
  });
});

describe('shouldRejectEnvelope (SSE-side defense)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('does not reject when SSE owner identity is unknown (no check)', async () => {
    const { shouldRejectEnvelope } = await loadModule();
    expect(shouldRejectEnvelope(null, buildAuthInfo())).toBe(false);
  });

  it('does not reject when caller identity matches SSE owner', async () => {
    const { shouldRejectEnvelope, deriveIdentity } = await loadModule();
    const owner = deriveIdentity(buildAuthInfo({ accountId: 'acct_X' }));
    expect(
      shouldRejectEnvelope(owner, buildAuthInfo({ accountId: 'acct_X' })),
    ).toBe(false);
  });

  it('rejects when caller is a different account', async () => {
    const { shouldRejectEnvelope, deriveIdentity } = await loadModule();
    const owner = deriveIdentity(buildAuthInfo({ accountId: 'acct_X' }));
    expect(
      shouldRejectEnvelope(owner, buildAuthInfo({ accountId: 'acct_Y' })),
    ).toBe(true);
  });

  it('rejects when caller is the same account but a different OAuth client', async () => {
    const { shouldRejectEnvelope, deriveIdentity } = await loadModule();
    const owner = deriveIdentity(
      buildAuthInfo({ accountId: 'acct_X', clientId: 'client_one' }),
    );
    expect(
      shouldRejectEnvelope(
        owner,
        buildAuthInfo({ accountId: 'acct_X', clientId: 'client_two' }),
      ),
    ).toBe(true);
  });

  it('accepts when caller is the same account + same OAuth client but a different bearer (token rotation)', async () => {
    // Regression for the Cursor re-auth UX bug. Identity is now bound to
    // clientId, not the bearer; same client + new bearer = same identity.
    const { shouldRejectEnvelope, deriveIdentity } = await loadModule();
    const owner = deriveIdentity(
      buildAuthInfo({
        accountId: 'acct_X',
        clientId: 'cursor_xyz',
        apiKey: 'sk_pre_refresh',
      }),
    );
    expect(
      shouldRejectEnvelope(
        owner,
        buildAuthInfo({
          accountId: 'acct_X',
          clientId: 'cursor_xyz',
          apiKey: 'sk_post_refresh',
        }),
      ),
    ).toBe(false);
  });

  it('rejects when caller auth info is missing entirely', async () => {
    const { shouldRejectEnvelope, deriveIdentity } = await loadModule();
    const owner = deriveIdentity(buildAuthInfo());
    expect(shouldRejectEnvelope(owner, undefined)).toBe(true);
  });
});

/**
 * Simulates the route's registered tool handler short-circuit pattern:
 *
 *   if (checkEnvelopeMatches(extra, tool.name)) return { content: [] };
 *   // ... real handler runs
 *
 * The wrapper exists in `route.ts` as a closure over `sseOwnerIdentity`, so we
 * recreate the same pattern here against `shouldRejectEnvelope` to lock the
 * contract: mismatch → no-op result; match → handler is invoked.
 */
describe('shouldRejectEnvelope via simulated registered handler', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  function makeWrappedHandler(
    sseOwnerIdentity: string | null,
    inner: (extra: { authInfo?: AuthInfo }) => {
      content: Array<{ type: 'text'; text: string }>;
      isError?: boolean;
    },
    shouldReject: (owner: string | null, info: AuthInfo | undefined) => boolean,
  ) {
    return (extra: { authInfo?: AuthInfo }) => {
      if (shouldReject(sseOwnerIdentity, extra.authInfo)) {
        return { content: [], isError: false } as const;
      }
      return inner(extra);
    };
  }

  it('short-circuits with empty content when envelope identity does not match the SSE owner', async () => {
    const { shouldRejectEnvelope, deriveIdentity } = await loadModule();
    const innerSpy = vi.fn(() => ({
      content: [{ type: 'text' as const, text: 'real result' }],
    }));
    const ownerIdentity = deriveIdentity(
      buildAuthInfo({ accountId: 'acct_X' }),
    );
    const handler = makeWrappedHandler(
      ownerIdentity,
      innerSpy,
      shouldRejectEnvelope,
    );

    const attackerInfo = buildAuthInfo({ accountId: 'acct_Y' });
    const result = handler({ authInfo: attackerInfo });

    expect(result).toEqual({ content: [], isError: false });
    expect(innerSpy).not.toHaveBeenCalled();
  });

  it('invokes the inner handler when envelope identity matches', async () => {
    const { shouldRejectEnvelope, deriveIdentity } = await loadModule();
    const innerSpy = vi.fn(() => ({
      content: [{ type: 'text' as const, text: 'real result' }],
    }));
    const ownerIdentity = deriveIdentity(
      buildAuthInfo({ accountId: 'acct_X' }),
    );
    const handler = makeWrappedHandler(
      ownerIdentity,
      innerSpy,
      shouldRejectEnvelope,
    );

    const matchingInfo = buildAuthInfo({ accountId: 'acct_X' });
    const result = handler({ authInfo: matchingInfo });

    expect(result.content).toEqual([{ type: 'text', text: 'real result' }]);
    expect(innerSpy).toHaveBeenCalledTimes(1);
  });

  it('passes through when SSE owner identity is unknown (no check)', async () => {
    const { shouldRejectEnvelope } = await loadModule();
    const innerSpy = vi.fn(() => ({
      content: [{ type: 'text' as const, text: 'unguarded' }],
    }));
    const handler = makeWrappedHandler(null, innerSpy, shouldRejectEnvelope);

    handler({ authInfo: buildAuthInfo() });

    expect(innerSpy).toHaveBeenCalledTimes(1);
  });
});
