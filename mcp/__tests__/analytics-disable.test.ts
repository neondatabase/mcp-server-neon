import { afterEach, describe, expect, it, vi } from 'vitest';

describe('NEON_MCP_DISABLE_ANALYTICS', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.doUnmock('@segment/analytics-node');
  });

  it('does not construct the Segment client when set to 1', async () => {
    vi.resetModules();
    vi.stubEnv('NEON_MCP_DISABLE_ANALYTICS', '1');
    const ctor = vi.fn();
    vi.doMock('@segment/analytics-node', () => ({
      Analytics: class {
        constructor() {
          ctor();
        }
        identify() {}
        track() {}
        flush() {
          return Promise.resolve();
        }
      },
    }));

    const { identify, track } = await import('../analytics/analytics');
    track({ userId: 'user-1', event: 'tool_call' });
    identify(
      { id: 'user-1', name: 'Ada', email: 'ada@example.com', isOrg: false },
      {},
    );

    expect(ctor).not.toHaveBeenCalled();
  });
});
