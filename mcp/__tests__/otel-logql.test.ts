/**
 * Unit tests for the OTel logs helper layer: LogQL builder, severity mapping,
 * and Loki-envelope flattening.
 */

import { describe, it, expect } from 'vitest';
import { buildLogQL } from '../otel/logql';
import { severityAtOrAbovePattern } from '../otel/severity';
import { flattenLokiResponse } from '../otel/format';
import type { LokiQueryResponse } from '../otel/types';

describe('buildLogQL', () => {
  it('defaults to the function entity type', () => {
    expect(buildLogQL({})).toBe('{entity_type="function"}');
  });

  it('honours an explicit source', () => {
    expect(buildLogQL({ entityType: 'storage' })).toBe(
      '{entity_type="storage"}',
    );
  });

  it('combines multiple selector matchers', () => {
    expect(buildLogQL({ entityType: 'function', serviceName: 'api' })).toBe(
      '{entity_type="function", service_name="api"}',
    );
  });

  it('expands minSeverity to a severity_text regex matcher', () => {
    expect(buildLogQL({ minSeverity: 'error' })).toBe(
      '{entity_type="function", severity_text=~"(?i)(ERROR|FATAL)[0-9]*"}',
    );
  });

  it('prefers an exact severityText over minSeverity', () => {
    expect(buildLogQL({ severityText: 'WARN', minSeverity: 'error' })).toBe(
      '{entity_type="function", severity_text="WARN"}',
    );
  });

  it('appends a body line filter', () => {
    expect(buildLogQL({ bodyContains: 'connection refused' })).toBe(
      '{entity_type="function"} |= "connection refused"',
    );
  });

  it('escapes quotes and backslashes in values', () => {
    expect(buildLogQL({ serviceName: 'a"b\\c' })).toBe(
      '{entity_type="function", service_name="a\\"b\\\\c"}',
    );
  });

  it('adds a trace_id matcher for correlation', () => {
    expect(buildLogQL({ traceId: 'abc123' })).toContain('trace_id="abc123"');
  });

  it('throws when an empty entity type leaves no selector matcher', () => {
    expect(() => buildLogQL({ entityType: '' })).toThrow(
      /at least one stream-selector filter/,
    );
  });
});

describe('severityAtOrAbovePattern', () => {
  it('includes the level and everything above it', () => {
    expect(severityAtOrAbovePattern('warn')).toBe(
      '(?i)(WARN|ERROR|FATAL)[0-9]*',
    );
  });

  it('covers all levels at trace', () => {
    expect(severityAtOrAbovePattern('trace')).toBe(
      '(?i)(TRACE|DEBUG|INFO|WARN|ERROR|FATAL)[0-9]*',
    );
  });

  it('is just fatal at the top', () => {
    expect(severityAtOrAbovePattern('fatal')).toBe('(?i)(FATAL)[0-9]*');
  });
});

describe('flattenLokiResponse', () => {
  const response: LokiQueryResponse = {
    status: 'success',
    data: {
      resultType: 'streams',
      result: [
        {
          stream: {
            service_name: 'api',
            severity_text: 'ERROR',
            entity_type: 'function',
          },
          values: [
            ['1700000000000000000', 'first'],
            ['1700000002000000000', 'third'],
          ],
        },
        {
          stream: { service_name: 'worker', severity_text: 'INFO' },
          values: [['1700000001000000000', 'second']],
        },
      ],
    },
  };

  it('flattens streams and sorts newest-first across streams', () => {
    const { records, truncated } = flattenLokiResponse(response, 100);
    expect(records.map((r) => r.body)).toEqual(['third', 'second', 'first']);
    expect(truncated).toBe(false);
  });

  it('lifts stream labels onto each record and converts ns → ISO UTC', () => {
    const { records } = flattenLokiResponse(response, 100);
    const first = records.find((r) => r.body === 'first')!;
    expect(first.serviceName).toBe('api');
    expect(first.severity).toBe('ERROR');
    expect(first.entityType).toBe('function');
    expect(first.timestamp).toBe('2023-11-14T22:13:20.000Z');
  });

  it('respects the limit after merging streams', () => {
    const { records } = flattenLokiResponse(response, 2);
    expect(records).toHaveLength(2);
    expect(records.map((r) => r.body)).toEqual(['third', 'second']);
  });

  it('marks truncated when the backend returns warnings', () => {
    const { truncated, warnings } = flattenLokiResponse(
      { ...response, warnings: ['results truncated: hit the maximum'] },
      100,
    );
    expect(truncated).toBe(true);
    expect(warnings).toHaveLength(1);
  });
});
