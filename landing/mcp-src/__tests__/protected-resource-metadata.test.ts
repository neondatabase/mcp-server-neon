import { describe, it, expect } from 'vitest';
import {
  PROTECTED_RESOURCE_METADATA_PATH,
  buildResourceMetadataUrlForResourceRequest,
  deriveResourceIdentifierFromMetadataRequest,
  getHostLevelResourceIdentifier,
  getHostLevelResourceIdentifierFromRequest,
  parseResourceIdentifier,
} from '../../lib/oauth/protected-resource-metadata';

describe('protected resource metadata helpers', () => {
  it('returns host-level resource identifier', () => {
    expect(
      getHostLevelResourceIdentifier('https://preview-mcp.neon.tech/'),
    ).toBe('https://preview-mcp.neon.tech');
  });

  it('derives path and query resource identifier from metadata endpoint', () => {
    const metadataRequest = new Request(
      'http://localhost:3100/.well-known/oauth-protected-resource/mcp?readonly=true&projectId=proj-123',
      {
        headers: {
          host: 'localhost:3100',
        },
      },
    );

    expect(
      deriveResourceIdentifierFromMetadataRequest(
        metadataRequest,
        'https://preview-mcp.neon.tech',
      ),
    ).toBe('https://localhost:3100/mcp?readonly=true&projectId=proj-123');
  });

  it('returns host-level identifier for host-level metadata endpoint', () => {
    const metadataRequest = new Request(
      'http://localhost:3100/.well-known/oauth-protected-resource',
      {
        headers: {
          host: 'localhost:3100',
        },
      },
    );

    expect(
      deriveResourceIdentifierFromMetadataRequest(
        metadataRequest,
        'https://preview-mcp.neon.tech',
      ),
    ).toBe('https://localhost:3100');
  });

  it('builds metadata URL for resource requests with query params', () => {
    const resourceRequest = new Request(
      'http://localhost:3100/mcp?readonly=true',
      {
        headers: {
          host: 'localhost:3100',
        },
      },
    );

    expect(
      buildResourceMetadataUrlForResourceRequest(
        resourceRequest,
        'https://preview-mcp.neon.tech',
      ),
    ).toBe(
      `${'https://localhost:3100'}${PROTECTED_RESOURCE_METADATA_PATH}/mcp?readonly=true`,
    );
  });

  it('uses forwarded host/proto instead of SERVER_HOST fallback', () => {
    const request = new Request(
      'http://internal:8080/.well-known/oauth-protected-resource/mcp?readonly=true',
      {
        headers: {
          host: 'internal:8080',
          'x-forwarded-host': 'preview-mcp.neon.tech',
          'x-forwarded-proto': 'https',
        },
      },
    );

    expect(
      deriveResourceIdentifierFromMetadataRequest(
        request,
        'https://mcp.neon.tech:3000',
      ),
    ).toBe('https://preview-mcp.neon.tech/mcp?readonly=true');
  });

  it('uses incoming host/port when request authority differs from SERVER_HOST', () => {
    const request = new Request(
      'http://localhost:3100/.well-known/oauth-protected-resource/mcp?readonly=true',
      {
        headers: {
          host: 'localhost:3100',
        },
      },
    );

    expect(
      deriveResourceIdentifierFromMetadataRequest(
        request,
        'https://localhost:3000',
      ),
    ).toBe('https://localhost:3100/mcp?readonly=true');
  });

  it('returns host-level resource from incoming request authority', () => {
    const request = new Request(
      'http://localhost:3100/.well-known/oauth-protected-resource',
      {
        headers: {
          host: 'localhost:3100',
        },
      },
    );

    expect(
      getHostLevelResourceIdentifierFromRequest(
        request,
        'https://localhost:3000',
      ),
    ).toBe('https://localhost:3100');
  });

  it('rejects non-https resource identifiers', () => {
    expect(() =>
      parseResourceIdentifier('http://preview-mcp.neon.tech/mcp'),
    ).toThrow('OAuth resource URI must use HTTPS');
  });

  it('rejects resource identifiers with fragments', () => {
    expect(() =>
      parseResourceIdentifier('https://preview-mcp.neon.tech/mcp#fragment'),
    ).toThrow('OAuth resource URI must not include a fragment');
  });
});
