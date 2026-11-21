import { Analytics } from '@segment/analytics-node';
import { ANALYTICS_HOST, ANALYTICS_WRITE_KEY } from '../constants';
import { AuthContext } from '../types/auth';
import { logger } from '../utils/logger';

type Account = AuthContext['extra']['account'];

export type TrackParams = Parameters<Analytics['track']>[0];

export type IdentifyAccount = Account | null;

export type IdentifyParams = Omit<
  Parameters<Analytics['identify']>[0],
  'userId' | 'anonymousId'
>;

// Auto-initialize analytics at module load time (for serverless compatibility)
// flushAt: 1 ensures events are sent immediately (required for serverless)
const analytics: Analytics | undefined =
  process.env.NEON_MCP_DISABLE_ANALYTICS !== '1' && ANALYTICS_WRITE_KEY
    ? new Analytics({
        writeKey: ANALYTICS_WRITE_KEY,
        host: ANALYTICS_HOST,
        flushAt: 1,
      })
    : undefined;

// Segment drops an event once its retries are exhausted and flush() still
// resolves, so this listener is the only trace of the lost event.
analytics?.on('error', (error) => {
  logger.warn('Analytics delivery failed', {
    code: error.code,
    reason: error.reason instanceof Error ? error.reason.message : undefined,
  });
});

// Segment returns at once from a flush that starts while another runs, so
// callers share the running one, which waits for every queued event.
const shareRunningFlush = (client: Analytics) => {
  let running: Promise<void> | undefined = undefined;

  return async () => {
    running ??= client.flush().finally(() => {
      running = undefined;
    });

    return running;
  };
};

const flush = analytics && shareRunningFlush(analytics);

/**
 * Flush all pending analytics events.
 * Call this before returning from short-lived serverless functions.
 */
export const flushAnalytics = async (): Promise<void> => {
  await flush?.();
};

export const identify = (account: IdentifyAccount, params: IdentifyParams) => {
  if (account) {
    analytics?.identify({
      ...params,
      userId: account.id,
      traits: {
        name: account.name,
        email: account.email,
        isOrg: account.isOrg,
      },
    });
  } else {
    analytics?.identify({
      ...params,
      anonymousId: 'anonymous',
    });
  }
};

export const track = (params: TrackParams) => {
  analytics?.track(params);
};
