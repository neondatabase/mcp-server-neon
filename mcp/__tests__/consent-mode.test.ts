import { describe, expect, it } from 'vitest';
import {
  consentModeFromResource,
  preferenceReadOnly,
  resourceReadOnlyHardCeiling,
} from '../oauth/consent-mode';

describe('consentModeFromResource', () => {
  it('is editable when resource is omitted', () => {
    expect(consentModeFromResource(undefined)).toBe('editable');
  });

  it('is editable for a bare MCP URL', () => {
    expect(consentModeFromResource('https://mcp.neon.tech/mcp')).toBe(
      'editable',
    );
  });

  it('is editable when only an unrelated query is present', () => {
    expect(consentModeFromResource('https://mcp.neon.tech/mcp?foo=bar')).toBe(
      'editable',
    );
  });

  it('is confirmation when projectId is present', () => {
    expect(
      consentModeFromResource(
        'https://mcp.neon.tech/mcp?projectId=proj-example',
      ),
    ).toBe('confirmation');
  });

  it('is confirmation when category is present', () => {
    expect(
      consentModeFromResource('https://mcp.neon.tech/mcp?category=querying'),
    ).toBe('confirmation');
  });

  it('is confirmation for readonly=true', () => {
    expect(
      consentModeFromResource('https://mcp.neon.tech/mcp?readonly=true'),
    ).toBe('confirmation');
  });

  it('is confirmation for readonly=false', () => {
    expect(
      consentModeFromResource('https://mcp.neon.tech/mcp?readonly=false'),
    ).toBe('confirmation');
  });

  it('is confirmation for an empty grant parameter', () => {
    expect(consentModeFromResource('https://mcp.neon.tech/mcp?category=')).toBe(
      'confirmation',
    );
    expect(
      consentModeFromResource('https://mcp.neon.tech/mcp?projectId='),
    ).toBe('confirmation');
  });

  it('is confirmation for mixed known and unknown categories', () => {
    expect(
      consentModeFromResource(
        'https://mcp.neon.tech/mcp?category=querying,not-a-category',
      ),
    ).toBe('confirmation');
  });

  it('is confirmation for unknown-only categories', () => {
    expect(
      consentModeFromResource(
        'https://mcp.neon.tech/mcp?category=not-a-category',
      ),
    ).toBe('confirmation');
  });
});

describe('resourceReadOnlyHardCeiling', () => {
  it('is true only for a true resource readonly param', () => {
    expect(
      resourceReadOnlyHardCeiling('https://mcp.neon.tech/mcp?readonly=true'),
    ).toBe(true);
    expect(
      resourceReadOnlyHardCeiling('https://mcp.neon.tech/mcp?readonly=TRUE'),
    ).toBe(true);
    expect(
      resourceReadOnlyHardCeiling('https://mcp.neon.tech/mcp?readonly=false'),
    ).toBe(false);
    expect(resourceReadOnlyHardCeiling('https://mcp.neon.tech/mcp')).toBe(
      false,
    );
  });
});

describe('preferenceReadOnly', () => {
  it('uses the authorize query or registration header', () => {
    expect(
      preferenceReadOnly({
        authorizeReadOnly: 'true',
        headerValue: null,
      }),
    ).toBe(true);
    expect(
      preferenceReadOnly({
        authorizeReadOnly: null,
        headerValue: 'true',
      }),
    ).toBe(true);
    expect(
      preferenceReadOnly({
        authorizeReadOnly: 'false',
        headerValue: 'true',
      }),
    ).toBe(false);
  });
});
