import { describe, expect, it } from 'vitest';
import { compactListedJsonSchema } from '../tools/listed-schema';

describe('compactListedJsonSchema', () => {
  it('drops $schema', () => {
    expect(
      compactListedJsonSchema({
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
      }),
    ).toEqual({ type: 'object' });
  });

  it('drops int64 sentinel bounds and keeps real ones', () => {
    expect(
      compactListedJsonSchema({
        type: 'integer',
        minimum: 0,
        maximum: Number.MAX_SAFE_INTEGER,
      }),
    ).toEqual({ type: 'integer', minimum: 0 });
    expect(
      compactListedJsonSchema({
        type: 'integer',
        minimum: 1,
        maximum: 400,
      }),
    ).toEqual({ type: 'integer', minimum: 1, maximum: 400 });
  });

  it('drops pattern when format is already set', () => {
    expect(
      compactListedJsonSchema({
        type: 'string',
        format: 'date-time',
        pattern: '^[0-9]{4}-',
      }),
    ).toEqual({ type: 'string', format: 'date-time' });
  });

  it('keeps pattern when there is no format', () => {
    expect(
      compactListedJsonSchema({
        type: 'string',
        pattern: '^[a-z0-9-]{1,60}$',
      }),
    ).toEqual({
      type: 'string',
      pattern: '^[a-z0-9-]{1,60}$',
    });
  });

  it('keeps property descriptions', () => {
    expect(
      compactListedJsonSchema({
        type: 'string',
        enum: ['table-sizes'],
        description:
          'Which diagnostic to run:\n`table-sizes`: Size of each table',
      }),
    ).toEqual({
      type: 'string',
      enum: ['table-sizes'],
      description:
        'Which diagnostic to run:\n`table-sizes`: Size of each table',
    });
  });
});
