import { describe, expect, it } from 'vitest';
import { NeonApiError, NeonClientError } from '@neon/sdk';
import { NeonDbError } from '@neondatabase/serverless';
import { z } from 'zod';
import {
  InvalidArgumentError,
  isServerError,
  NotFoundError,
} from '../server/errors';

function zodError() {
  const parsed = z.object({ sql: z.string() }).safeParse({});
  if (parsed.success) throw new Error('expected a validation failure');
  return parsed.error;
}

describe('isServerError', () => {
  it.each([
    [
      'a statement Postgres rejected',
      Object.assign(new NeonDbError('syntax error at or near "SELEC"'), {
        code: '42601',
      }),
    ],
    ['invalid tool input', new InvalidArgumentError('bad slug')],
    ['a missing resource', new NotFoundError('no such doc')],
    ['schema validation', zodError()],
    ['an SDK client error', new NeonClientError('no parent branch')],
    ['a Neon API 4xx', new NeonApiError('Not Found', { status: 404 })],
  ])('is false for %s', (_case, error) => {
    expect(isServerError(error)).toBe(false);
  });

  it.each([
    [
      'an unreachable SQL endpoint',
      new NeonDbError('Error connecting to database: TypeError: fetch failed'),
    ],
    [
      'a SQL endpoint 5xx',
      new NeonDbError('Server error (HTTP status 502): bad gateway'),
    ],
    ['a Neon API 5xx', new NeonApiError('Unavailable', { status: 503 })],
    ['an unexpected exception', new TypeError('x is undefined')],
    ['a non-Error throw', 'boom'],
  ])('is true for %s', (_case, error) => {
    expect(isServerError(error)).toBe(true);
  });
});
