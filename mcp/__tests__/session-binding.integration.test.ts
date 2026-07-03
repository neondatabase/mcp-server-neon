import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type RedisClientType } from 'redis';

/**
 * End-to-end integration against a real Redis instance. Requires
 * `REDIS_URL=redis://localhost:6379` (or `KV_URL=...`) to be set. Skipped
 * otherwise so unit-test CI doesn't need a Redis side-car.
 */
const REDIS_URL = process.env.REDIS_URL || process.env.KV_URL;
const describeIfRedis = REDIS_URL ? describe : describe.skip;

describeIfRedis('session-binding integration (real Redis)', () => {
  let probe: RedisClientType;

  beforeAll(async () => {
    probe = createClient({ url: REDIS_URL }) as RedisClientType;
    await probe.connect();
    // Sanity: confirm Redis is actually reachable before running the suite.
    await probe.ping();
  });

  afterAll(async () => {
    // Best-effort cleanup of any stray keys our tests produced.
    const keys = await probe.keys('mcp:session:*');
    if (keys.length > 0) await probe.del(keys);
    await probe.quit();
  });

  beforeEach(async () => {
    const keys = await probe.keys('mcp:session:*');
    if (keys.length > 0) await probe.del(keys);
  });

  it('bindSession → verifySession round-trips for the same identity', async () => {
    const { bindSession, verifySession } =
      await import('../server/session-binding');
    await bindSession('sess-roundtrip', 'identity-A', 60);
    expect(await verifySession('sess-roundtrip', 'identity-A')).toBe(true);
  });

  it('verifySession rejects a different identity on the same sessionId', async () => {
    const { bindSession, verifySession } =
      await import('../server/session-binding');
    await bindSession('sess-mismatch', 'identity-A', 60);
    expect(await verifySession('sess-mismatch', 'identity-B')).toBe(false);
  });

  it('verifySession returns false for an unknown sessionId', async () => {
    const { verifySession } = await import('../server/session-binding');
    expect(await verifySession('sess-unknown', 'identity-A')).toBe(false);
  });

  it('bindSession stores the value under mcp:session: prefix with TTL', async () => {
    const { bindSession } = await import('../server/session-binding');
    await bindSession('sess-ttl', 'identity-A', 42);
    const stored = await probe.get('mcp:session:sess-ttl');
    const ttl = await probe.ttl('mcp:session:sess-ttl');
    expect(stored).toBe('identity-A');
    // TTL fluctuates slightly between set and read — be generous.
    expect(ttl).toBeGreaterThan(35);
    expect(ttl).toBeLessThanOrEqual(42);
  });

  it('releaseSession removes the binding', async () => {
    const { bindSession, releaseSession, verifySession } =
      await import('../server/session-binding');
    await bindSession('sess-release', 'identity-A', 60);
    await releaseSession('sess-release');
    expect(await verifySession('sess-release', 'identity-A')).toBe(false);
    expect(await probe.get('mcp:session:sess-release')).toBeNull();
  });

  it('evaluateMessageOwnership returns pass when identity matches the live binding', async () => {
    const { bindSession, evaluateMessageOwnership } =
      await import('../server/session-binding');
    await bindSession('sess-pass', 'identity-A', 60);
    const r = await evaluateMessageOwnership(
      'POST',
      '/api/message',
      'sess-pass',
      'identity-A',
    );
    expect(r).toEqual({ kind: 'pass' });
  });

  it('evaluateMessageOwnership returns 403 when caller is a different identity', async () => {
    const { bindSession, evaluateMessageOwnership } =
      await import('../server/session-binding');
    await bindSession('sess-attacker', 'identity-owner', 60);
    const r = await evaluateMessageOwnership(
      'POST',
      '/api/message',
      'sess-attacker',
      'identity-attacker',
    );
    expect(r.kind).toBe('reject');
    if (r.kind === 'reject') expect(r.status).toBe(403);
  });

  it('evaluateMessageOwnership returns 403 for a sessionId with no binding', async () => {
    const { evaluateMessageOwnership } =
      await import('../server/session-binding');
    const r = await evaluateMessageOwnership(
      'POST',
      '/api/message',
      'sess-never-bound',
      'identity-A',
    );
    expect(r.kind).toBe('reject');
    if (r.kind === 'reject') expect(r.status).toBe(403);
  });

  it('binding expires after its TTL (short TTL sanity check)', async () => {
    const { bindSession, verifySession } =
      await import('../server/session-binding');
    await bindSession('sess-expiry', 'identity-A', 1);
    expect(await verifySession('sess-expiry', 'identity-A')).toBe(true);
    await new Promise((r) => setTimeout(r, 1_200));
    expect(await verifySession('sess-expiry', 'identity-A')).toBe(false);
  });
});
