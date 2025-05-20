import { Analytics } from '@segment/analytics-node';
import { ANALYTICS_WRITE_KEY } from '../constants.js';
import { CurrentUserInfoResponse } from '@neondatabase/api-client';

let analytics: Analytics | undefined;
type User = Pick<CurrentUserInfoResponse, 'id' | 'name' | 'email'>;
export const initAnalytics = () => {
  if (ANALYTICS_WRITE_KEY) {
    analytics = new Analytics({
      writeKey: ANALYTICS_WRITE_KEY,
      host: 'https://track.neon.tech',
    });
  }
};

export const identify = (
  user: User | null,
  params: Omit<Parameters<Analytics['identify']>[0], 'userId' | 'anonymousId'>,
) => {
  if (user) {
    analytics?.identify({
      ...params,
      userId: user.id,
      traits: {
        name: user.name,
        email: user.email,
      },
    });
  } else {
    analytics?.identify({
      ...params,
      anonymousId: 'anonymous',
    });
  }
};

export const track = (params: Parameters<Analytics['track']>[0]) => {
  analytics?.track(params);
};
