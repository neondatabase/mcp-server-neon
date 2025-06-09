import { Analytics } from '@segment/analytics-node';
import { ANALYTICS_WRITE_KEY } from '../constants.js';
import {
  Api,
  AuthDetailsResponse,
  CurrentUserInfoResponse,
} from '@neondatabase/api-client';

let analytics: Analytics | undefined;
export type User = Pick<CurrentUserInfoResponse, 'id' | 'name' | 'email'>;
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

/**
 * Util for identifying the user based on the auth method. If the api key belongs to an organization, identify the organization instead of user details.
 */
export const identifyApiKey = async (
  auth: AuthDetailsResponse,
  neonClient: Api<unknown>,
  params: Omit<Parameters<Analytics['identify']>[0], 'userId' | 'anonymousId'>,
) => {
  if (auth.auth_method === 'api_key_org') {
    const { data: org } = await neonClient.getOrganization(auth.account_id);
    const user = {
      id: auth.account_id,
      name: org.name,
      email: '',
    };
    identify(user, params);
    return user;
  }
  const { data: user } = await neonClient.getCurrentUserInfo();
  identify(user, params);
  return user;
};
