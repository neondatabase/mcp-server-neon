import { init } from '@sentry/node';
import { SENTRY_DSN } from '../constants';
import pkg from '../../package.json';

init({
  dsn: SENTRY_DSN,
  environment: process.env.NODE_ENV,
  release: pkg.version,
  tracesSampleRate: 1.0,

  // Setting this option to true will send default PII data to Sentry.
  // For example, automatic IP address collection on events
  sendDefaultPii: true,
});
