import { describe, expect, it } from 'vitest';
import { sanitizeGeneratedResult } from '../tools/generated/sanitize';

describe('sanitizeGeneratedResult', () => {
  it('keeps connectionString on workflow results and strips leftover credentials', () => {
    const sanitized = sanitizeGeneratedResult('createProjectAndConnect', {
      project: { id: 'proj-1', name: 'demo' },
      connectionString: 'postgresql://neondb_owner:secret@host/neondb',
      connection_uris: [
        {
          connection_uri: 'postgresql://neondb_owner:secret@host/neondb',
        },
      ],
      roles: [{ name: 'neondb_owner', password: 'secret' }],
    });

    expect(sanitized).toEqual({
      project: { id: 'proj-1', name: 'demo' },
      connectionString: 'postgresql://neondb_owner:secret@host/neondb',
      roles: [{ name: 'neondb_owner' }],
    });
  });

  it('keeps connectionString on createBranchWithCompute', () => {
    const sanitized = sanitizeGeneratedResult('createBranchWithCompute', {
      branch: { id: 'br-1' },
      connectionString: 'postgresql://neondb_owner:secret@host/neondb',
      connection_uris: [
        { connection_uri: 'postgresql://neondb_owner:secret@host/neondb' },
      ],
      roles: [{ name: 'neondb_owner', password: 'secret' }],
    });

    expect(sanitized).toEqual({
      branch: { id: 'br-1' },
      connectionString: 'postgresql://neondb_owner:secret@host/neondb',
      roles: [{ name: 'neondb_owner' }],
    });
  });

  it('keeps a password on role create and reset', () => {
    const data = {
      role: { name: 'app', password: 'secret' },
    };
    expect(sanitizeGeneratedResult('createProjectBranchRole', data)).toEqual(
      data,
    );
    expect(
      sanitizeGeneratedResult('resetProjectBranchRolePassword', data),
    ).toEqual(data);
  });

  it('strips Auth provider secrets', () => {
    const sanitized = sanitizeGeneratedResult('createNeonAuth', {
      base_url: 'https://auth.example',
      jwks_url: 'https://auth.example/jwks',
      secret_server_key: 'secret',
      pub_client_key: 'pub',
    });
    expect(sanitized).toEqual({
      base_url: 'https://auth.example',
      jwks_url: 'https://auth.example/jwks',
      pub_client_key: 'pub',
    });
  });

  it('strips OAuth client_secret from a provider write', () => {
    const sanitized = sanitizeGeneratedResult(
      'addBranchNeonAuthOauthProvider',
      {
        id: 'github',
        client_id: 'id',
        client_secret: 'secret',
      },
    );
    expect(sanitized).toEqual({
      id: 'github',
      client_id: 'id',
    });
  });

  it('strips an SMTP password from an email-provider update', () => {
    const sanitized = sanitizeGeneratedResult('updateNeonAuthEmailProvider', {
      email_provider: 'standard',
      password: 'smtp-secret',
      host: 'smtp.example',
    });
    expect(sanitized).toEqual({
      email_provider: 'standard',
      host: 'smtp.example',
    });
  });

  it('strips a stored password from a role GET', () => {
    const sanitized = sanitizeGeneratedResult('getProjectBranchRole', {
      role: { name: 'app', password: 'secret', protected: false },
    });
    expect(sanitized).toEqual({
      role: { name: 'app', protected: false },
    });
  });
});
