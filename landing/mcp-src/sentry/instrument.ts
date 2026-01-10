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

  // Ignore transient network/SSL errors that aren't actionable
  ignoreErrors: [
    // SSL/TLS handshake failures (transient network issues)
    /EPROTO.*ssl/i,
    /tlsv1 alert decrypt error/i,
    /SSL routines.*ssl3_read_bytes/i,
    /SSL alert number 51/i,
    // Connection reset/abort errors (client disconnects)
    /ECONNRESET/,
    /socket hang up/i,
    /Client network socket disconnected before secure TLS connection/i,
    /^aborted$/i,
  ],
});
