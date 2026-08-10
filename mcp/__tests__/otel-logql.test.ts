/**
 * Unit tests for the LogQL renderer and severity mapping behind the `query`
 * field query_logs reports back.
 */

import { describe, it, expect } from 'vitest';
import { buildLogQL } from '../otel/logql';
import { severityAtOrAbovePattern } from '../otel/severity';

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
