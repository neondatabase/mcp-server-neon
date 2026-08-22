import { describe, expect, it } from 'vitest';
import { sanitizeGeneratedResult } from '../tools/generated/sanitize';

describe('sanitizeGeneratedResult', () => {
  it('keeps connectionString on createAndConnect results and strips leftover credentials', () => {
    const sanitized = sanitizeGeneratedResult('projects.createAndConnect', {
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

  it('keeps connectionString on createWithCompute', () => {
    const sanitized = sanitizeGeneratedResult('branches.createWithCompute', {
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
    expect(sanitizeGeneratedResult('postgres.roles.create', data)).toEqual(
      data,
    );
    expect(
      sanitizeGeneratedResult('postgres.roles.resetPassword', data),
    ).toEqual(data);
  });

  it('strips Auth provider secrets', () => {
    const sanitized = sanitizeGeneratedResult('auth.create', {
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
    const sanitized = sanitizeGeneratedResult('auth.oauthProviders.add', {
      id: 'github',
      client_id: 'id',
      client_secret: 'secret',
    });
    expect(sanitized).toEqual({
      id: 'github',
      client_id: 'id',
    });
  });

  it('strips a stored password from a role GET', () => {
    const sanitized = sanitizeGeneratedResult('postgres.roles.get', {
      role: { name: 'app', password: 'secret', protected: false },
    });
    expect(sanitized).toEqual({
      role: { name: 'app', protected: false },
    });
  });
});
