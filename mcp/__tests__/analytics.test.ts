import { beforeEach, describe, expect, it, vi } from 'vitest';

const analyticsSpies = vi.hoisted(() => ({
  closeAndFlush: vi.fn().mockResolvedValue(undefined),
  flush: vi.fn().mockResolvedValue(undefined),
  identify: vi.fn(),
  track: vi.fn(),
}));

vi.mock('@segment/analytics-node', () => ({
  Analytics: class {
    closeAndFlush = analyticsSpies.closeAndFlush;
    flush = analyticsSpies.flush;
    identify = analyticsSpies.identify;
    track = analyticsSpies.track;
  },
}));

const { flushAnalytics, track } = await import('../analytics/analytics');

describe('analytics delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps accepting events after a serverless flush', async () => {
    track({
      userId: 'user-1',
      event: 'server_init',
      properties: { authMethod: 'oauth' },
    });
    await flushAnalytics();

    track({
      userId: 'user-1',
      event: 'tool_call',
      properties: { authMethod: 'oauth', tool_name: 'run_sql' },
    });
    await flushAnalytics();

    expect(analyticsSpies.track).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ event: 'server_init' }),
    );
    expect(analyticsSpies.track).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ event: 'tool_call' }),
    );
    expect(analyticsSpies.flush).toHaveBeenCalledTimes(2);
    expect(analyticsSpies.closeAndFlush).not.toHaveBeenCalled();
  });
});
