import {
  NeonApiError,
  NeonError,
  NeonNetworkError,
  NeonNotFoundError,
} from '@neon/sdk';
import type { ErrorEvent, EventHint } from '@sentry/node';
import { describe, expect, it } from 'vitest';
import { beforeSend, classify } from '../sentry/classify';

describe('Neon transport faults', () => {
  it('groups by reason and downgrades, without dropping', () => {
    const error = new NeonNetworkError(
      'Network error: no response received from the Neon API (ECONNRESET).',
      { reason: 'ECONNRESET' },
    );

    expect(classify(error)).toEqual({
      report: true,
      level: 'warning',
      fingerprint: ['neon-transport', 'ECONNRESET'],
      rule: 'neon-transport:ECONNRESET',
    });
  });

  it('gives an unrecognised reason its own group instead of suppressing it', () => {
    // The regression this module exists for: a novel transport failure must open a
    // new Sentry issue rather than land silently in an existing bucket.
    const known = classify(
      new NeonNetworkError('…(ECONNRESET).', { reason: 'ECONNRESET' }),
    );
    const novel = classify(
      new NeonNetworkError('…(fetch failed).', { reason: 'fetch failed' }),
    );

    expect(novel.report).toBe(true);
    expect(novel.fingerprint).not.toEqual(known.fingerprint);
    expect(novel.fingerprint).toEqual(['neon-transport', 'fetch failed']);
  });

  it('does not depend on the message wording', () => {
    // Pre-1.4.0 SDKs produced no reason and a fixed sentence. The rule must still fire.
    const legacy = new NeonNetworkError(
      'Network error: no response received from the Neon API.',
    );

    expect(classify(legacy).report).toBe(true);
    expect(classify(legacy).fingerprint?.[0]).toBe('neon-transport');
  });

  it('recognises a transport fault from a duplicate copy of the SDK', () => {
    // Two @neon/sdk copies in one tree break `instanceof`, and it fails by falling
    // through to the default rule — silently disabling the filter.
    const foreign = Object.assign(new Error('boom'), {
      kind: 'network',
      reason: 'ETIMEDOUT',
    });

    expect(classify(foreign).rule).toBe('neon-transport:ETIMEDOUT');
  });
});

describe('Neon API errors', () => {
  it('reports a 5xx at full level with no grouping override', () => {
    const error = new NeonApiError('Neon API request failed with status 520.', {
      status: 520,
    });

    expect(classify(error)).toEqual({ report: true, rule: 'default' });
  });

  it('reports a 404 normally rather than treating it as noise', () => {
    const error = new NeonNotFoundError('project not found', { status: 404 });

    expect(classify(error).report).toBe(true);
    expect(classify(error).level).toBeUndefined();
  });

  it('reports a client-kind SDK error normally', () => {
    expect(classify(new NeonError('bad argument', 'client')).rule).toBe(
      'default',
    );
  });
});

describe('errors raised outside our code', () => {
  it('drops a bare aborted, the one case ignoreErrors also dropped', () => {
    expect(classify(new Error('aborted'))).toEqual({
      report: false,
      rule: 'client-disconnect:aborted',
    });
  });

  it.each([
    ['EPIPE: broken pipe, write', 'client-disconnect:epipe'],
    ['write EPIPE', 'client-disconnect:epipe'],
    ['read ECONNRESET', 'transport:econnreset'],
    ['socket hang up', 'transport:socket-hang-up'],
    ['read ETIMEDOUT', 'transport:etimedout'],
    ['getaddrinfo ENOTFOUND console.neon.tech', 'transport:enotfound'],
    [
      'Client network socket disconnected before secure TLS connection was established',
      'tls:client-disconnect',
    ],
    ['write EPROTO A0B1:error:0A000119:SSL routines', 'tls:eproto'],
    ['Connection terminated unexpectedly', 'postgres:connection-terminated'],
  ])('keeps %j visible but grouped', (message, rule) => {
    const d = classify(new Error(message));

    expect(d.report).toBe(true);
    expect(d.level).toBe('warning');
    expect(d.rule).toBe(rule);
  });
});

describe('nothing that used to be reported becomes silent', () => {
  // The previous `ignoreErrors` list, verbatim. Anything it did NOT drop was visible
  // in Sentry, and this refactor must not delete it as a side effect.
  const previouslyDropped = [
    'write EPROTO ... ssl handshake',
    'tlsv1 alert decrypt error',
    'error:1408F10B:SSL routines:ssl3_read_bytes:x',
    'SSL alert number 51',
    'read ECONNRESET',
    'socket hang up',
    'Client network socket disconnected before secure TLS connection was established',
    'aborted',
    'Connection terminated unexpectedly',
  ];

  it.each(previouslyDropped)(
    '%j stays droppable or grouped, never louder',
    (m) => {
      const d = classify(new Error(m));
      expect(d.report === false || d.level === 'warning').toBe(true);
    },
  );

  it.each([
    'write EPIPE',
    'EPIPE: broken pipe, write',
    'Failed to fetch GitHub content: 404 Not Found',
    'Disconnects client',
    'Cannot find module xtend/mutable',
  ])('%j is still reported', (m) => {
    expect(classify(new Error(m)).report).toBe(true);
  });
});

describe('everything else', () => {
  it.each([
    new Error('Migration not found: f3135f2b'),
    new TypeError('x is not a function'),
    new Error(''),
  ])('reports %s untouched', (error) => {
    expect(classify(error)).toEqual({ report: true, rule: 'default' });
  });

  it('reports a non-Error value rather than swallowing it', () => {
    expect(classify('a thrown string')).toEqual({
      report: true,
      rule: 'default',
    });
    expect(classify(undefined)).toEqual({ report: true, rule: 'default' });
  });
});

describe('beforeSend', () => {
  const send = (error: unknown) =>
    beforeSend(
      { level: 'error' } as ErrorEvent,
      {
        originalException: error,
      } as EventHint,
    );

  it('applies level and fingerprint to the outgoing event', () => {
    const event = send(
      new NeonNetworkError('…(ECONNRESET).', { reason: 'ECONNRESET' }),
    );

    expect(event?.level).toBe('warning');
    expect(event?.fingerprint).toEqual(['neon-transport', 'ECONNRESET']);
  });

  it('returns null for a dropped error', () => {
    expect(send(new Error('aborted'))).toBeNull();
  });

  it('leaves an unmatched error untouched', () => {
    const event = send(new Error('Migration not found: f3135f2b'));

    expect(event?.level).toBe('error');
    expect(event?.fingerprint).toBeUndefined();
  });
});
