import { NeonDbError } from '@neondatabase/serverless';
import { describe, expect, it } from 'vitest';
import { handleToolError, isServerError } from '../server/errors';

describe('spend-cap Postgres connection denial', () => {
  it('preserves SQLSTATE and the backend marker with billing guidance', () => {
    const error = Object.assign(new NeonDbError('Compute is restricted'), {
      code: '57P03',
      detail: 'SPEND_CAP_EXCEEDED',
    });

    const result = handleToolError(error, {}, undefined, {
      clientName: 'billing-test',
      clientApplication: 'unknown',
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('57P03');
    expect(JSON.stringify(result.content)).toContain('SPEND_CAP_EXCEEDED');
    expect(JSON.stringify(result.content)).toContain('Organization Billing');
    expect(isServerError(error)).toBe(false);
  });

  it('does not classify an unrelated 57P03 as a spend-cap denial', () => {
    const error = Object.assign(new NeonDbError('Compute is starting'), {
      code: '57P03',
      detail: 'Please wait',
    });

    const result = handleToolError(error, {}, undefined, {
      clientName: 'billing-test',
      clientApplication: 'unknown',
    });

    expect(JSON.stringify(result.content)).not.toContain(
      'Organization Billing',
    );
  });
});
