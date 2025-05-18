import { init } from '@sentry/node';
import { SENTRY_DSN } from '../constants.js';
import { getPackageJson } from '../server/api.js';

init({
  dsn: SENTRY_DSN,
  environment: process.env.NODE_ENV,
  release: getPackageJson().version,

  // Setting this option to true will send default PII data to Sentry.
  // For example, automatic IP address collection on events
  sendDefaultPii: true,
});
