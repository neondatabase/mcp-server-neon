import { describe, expect, it } from 'vitest';
import { NeonDbError } from '@neondatabase/serverless';
import {
  rethrowInspectError,
  runDiagnostic,
} from '../tools/handlers/inspect-database';

// Field values recorded from `@neondatabase/serverless` against a live Neon endpoint.
const postgresError = () =>
  Object.assign(new NeonDbError('column "x" does not exist'), {
    severity: 'ERROR',
    code: '42703',
  });
const rejectedConnection = () =>
  Object.assign(
    new NeonDbError(
      'This IP address 203.0.113.7 is not allowed to connect to this endpoint.',
    ),
    { severity: '', code: '' },
  );
const httpStatusError = () =>
  new NeonDbError('Server error (HTTP status 402): {"message":"quota"}');

const thrownBy = async (run: () => Promise<unknown>) =>
  run().then(
    () => undefined,
    (error: unknown) => error,
  );

describe('runDiagnostic', () => {
  it('reports a query Postgres rejected as a diagnostic failure', async () => {
    const cause = postgresError();
    const error = await thrownBy(() =>
      runDiagnostic('table-sizes', () => Promise.reject(cause)),
    );

    expect(error).not.toBeInstanceOf(NeonDbError);
    expect(error).toHaveProperty(
      'message',
      'The "table-sizes" diagnostic failed against Postgres: column "x" does not exist',
    );
    expect(error).toHaveProperty('cause', cause);
  });

  it.each([
    ['a rejected connection', rejectedConnection],
    ['an HTTP status error', httpStatusError],
  ])('passes %s through as a database error', async (_label, make) => {
    const cause = make();
    const error = await thrownBy(() =>
      runDiagnostic('table-sizes', () => Promise.reject(cause)),
    );

    expect(error).toBe(cause);
  });
});

describe('rethrowInspectError', () => {
  it('keeps a database error a database error when adding the hint', () => {
    const cause = rejectedConnection();
    let error: unknown;
    try {
      rethrowInspectError(cause, `${cause.message} (database neondb)`);
    } catch (thrown) {
      error = thrown;
    }

    expect(error).toBeInstanceOf(NeonDbError);
    expect(error).toHaveProperty(
      'message',
      `${cause.message} (database neondb)`,
    );
    expect(error).toHaveProperty('cause', cause);
  });

  it('keeps a diagnostic failure a plain error when adding the hint', () => {
    const cause = new Error('The "table-sizes" diagnostic failed');
    let error: unknown;
    try {
      rethrowInspectError(cause, `${cause.message} (database neondb)`);
    } catch (thrown) {
      error = thrown;
    }

    expect(error).not.toBeInstanceOf(NeonDbError);
    expect(error).toHaveProperty('cause', cause);
  });
});
