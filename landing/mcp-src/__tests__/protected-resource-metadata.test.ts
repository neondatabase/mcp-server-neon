import { describe, it, expect } from 'vitest';
import {
  PROTECTED_RESOURCE_METADATA_PATH,
  buildResourceMetadataUrlForResourceRequest,
  deriveResourceIdentifierFromMetadataRequest,
  getHostLevelResourceIdentifier,
  parseResourceIdentifier,
} from '../../lib/oauth/protected-resource-metadata';

describe('protected resource metadata helpers', () => {
  it('returns host-level resource identifier', () => {
    expect(
      getHostLevelResourceIdentifier('https://preview-mcp.neon.tech/'),
    ).toBe('https://preview-mcp.neon.tech');
  });

  it('derives path and query resource identifier from metadata endpoint', () => {
    const metadataRequest =
      'https://preview-mcp.neon.tech/.well-known/oauth-protected-resource/mcp?readonly=true&projectId=proj-123';

    expect(
      deriveResourceIdentifierFromMetadataRequest(
        metadataRequest,
        'https://preview-mcp.neon.tech',
      ),
    ).toBe(
      'https://preview-mcp.neon.tech/mcp?readonly=true&projectId=proj-123',
    );
  });

  it('returns host-level identifier for host-level metadata endpoint', () => {
    expect(
      deriveResourceIdentifierFromMetadataRequest(
        'https://preview-mcp.neon.tech/.well-known/oauth-protected-resource',
        'https://preview-mcp.neon.tech',
      ),
    ).toBe('https://preview-mcp.neon.tech');
  });

  it('builds metadata URL for resource requests with query params', () => {
    expect(
      buildResourceMetadataUrlForResourceRequest(
        'https://preview-mcp.neon.tech/mcp?readonly=true',
        'https://preview-mcp.neon.tech',
      ),
    ).toBe(
      `${'https://preview-mcp.neon.tech'}${PROTECTED_RESOURCE_METADATA_PATH}/mcp?readonly=true`,
    );
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
