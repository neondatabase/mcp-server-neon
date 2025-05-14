import { Analytics } from '@segment/analytics-node';
import { ANALYTICS_WRITE_KEY } from '../constants.js';

let analytics: Analytics | undefined;

export const initAnalytics = () => {
  analytics = new Analytics({
    writeKey: ANALYTICS_WRITE_KEY,
    host: 'https://track.neon.tech',
  });
};

export const identify = (params: Parameters<Analytics['identify']>[0]) => {
  analytics?.identify(params);
};

export const track = (params: Parameters<Analytics['track']>[0]) => {
  analytics?.track(params);
};
