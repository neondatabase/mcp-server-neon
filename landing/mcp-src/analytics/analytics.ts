import { Analytics } from "@segment/analytics-node";
import { ANALYTICS_WRITE_KEY } from "../constants";
import { AuthContext } from "../types/auth";

type Account = AuthContext["extra"]["account"];

// Auto-initialize analytics at module load time (for serverless compatibility)
// flushAt: 1 ensures events are sent immediately (required for serverless)
const analytics: Analytics | undefined = ANALYTICS_WRITE_KEY
  ? new Analytics({
      writeKey: ANALYTICS_WRITE_KEY,
      host: "https://track.neon.tech",
      flushAt: 1,
    })
  : undefined;

/**
 * Flush all pending analytics events.
 * Call this before returning from short-lived serverless functions.
 */
export const flushAnalytics = async (): Promise<void> => {
  await analytics?.closeAndFlush();
};

export const identify = (
  account: Account | null,
  params: Omit<Parameters<Analytics["identify"]>[0], "userId" | "anonymousId">,
) => {
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
      anonymousId: "anonymous",
    });
  }
};

export const track = (params: Parameters<Analytics["track"]>[0]) => {
  analytics?.track(params);
};
