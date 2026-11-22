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

// Segment returns at once from a flush that starts while another runs, before
// the caller's event is sent. Each caller's flush starts after the previous one
// settles, so it starts after that caller's event was queued and waits for it.
const serializeFlushes = (client: Analytics) => {
  let previous: Promise<void> = Promise.resolve();

  return async () => {
    previous = previous.then(
      async () => client.flush(),
      async () => client.flush(),
    );

    return previous;
  };
};

const flush = analytics && serializeFlushes(analytics);

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
