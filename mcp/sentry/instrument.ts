import { getClient, init, type NodeOptions } from '@sentry/node';
import { SENTRY_DSN } from '../constants';
import { copySessionAttributes, tagEventWithSession } from './session';
import pkg from '../../package.json';

type SpanJSON = Parameters<NonNullable<NodeOptions['beforeSendSpan']>>[0];

function withoutTargetQuery(span: SpanJSON): SpanJSON {
  const target = span.data['http.target'];
  if (typeof target !== 'string' || !target.includes('?')) return span;
  return {
    ...span,
    data: { ...span.data, 'http.target': target.slice(0, target.indexOf('?')) },
  };
}

init({
  dsn: SENTRY_DSN,
  environment: process.env.NODE_ENV,
  release: pkg.version,
  tracesSampleRate: 1.0,
  enableLogs: true,
  beforeSend: tagEventWithSession,

  // Replaces what sendDefaultPii would collect for HTTP requests. The OAuth
  // routes carry client credentials in Authorization, refresh tokens and PKCE
  // verifiers in the body, and authorization codes in the query string.
  // Request headers are off entirely: events attach every header but cookies
  // and IP headers, whatever the deny list says.
  dataCollection: {
    cookies: false,
    httpHeaders: { request: false, response: { deny: ['set-cookie'] } },
    httpBodies: [],
    urlQueryParams: false,
  },
  // Next.js's own spans keep the query in `http.target`.
  beforeSendSpan: withoutTargetQuery,

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
    // PostgreSQL connection terminated (stale serverless connections)
    /Connection terminated unexpectedly/i,
  ],
});

getClient()?.on('spanStart', copySessionAttributes);
