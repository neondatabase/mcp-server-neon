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

  it('drops the RFC3339 regex next to format date-time', () => {
    expect(
      compactListedJsonSchema({
        type: 'string',
        format: 'date-time',
        pattern:
          '^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z))$',
      }),
    ).toEqual({ type: 'string', format: 'date-time' });
  });

  it('keeps a non-RFC3339 pattern next to format date-time', () => {
    expect(
      compactListedJsonSchema({
        type: 'string',
        format: 'date-time',
        pattern: '^[0-9]{4}-',
      }),
    ).toEqual({
      type: 'string',
      format: 'date-time',
      pattern: '^[0-9]{4}-',
    });
  });

  it('keeps pattern when format is uuid, email, or byte', () => {
    expect(
      compactListedJsonSchema({
        type: 'string',
        format: 'uuid',
        pattern: '^[0-9a-f-]{36}$',
      }),
    ).toEqual({
      type: 'string',
      format: 'uuid',
      pattern: '^[0-9a-f-]{36}$',
    });
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
