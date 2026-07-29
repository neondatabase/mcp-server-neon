import { init } from '@sentry/node';
import { SENTRY_DSN } from '../constants';
import pkg from '../../package.json';
import { beforeSend } from './classify';

init({
  dsn: SENTRY_DSN,
  environment: process.env.NODE_ENV,
  release: pkg.version,
  tracesSampleRate: 1.0,

  // Setting this option to true will send default PII data to Sentry.
  // For example, automatic IP address collection on events
  sendDefaultPii: true,

  // Noise policy lives in `classify`, not here. `ignoreErrors` can only match error
  // text, and it only ever sees the outermost exception of a `cause` chain — so it
  // silently stopped filtering anything once the Neon SDK began wrapping transport
  // faults. `beforeSend` gets the thrown object, so the decision can read `kind` and
  // `reason` instead of guessing at wording.
  beforeSend,
});
