import { describe, expect, it } from 'vitest';
import { sanitizeGeneratedResult } from '../tools/generated/sanitize';

describe('sanitizeGeneratedResult', () => {
  it('strips connection_uris and role passwords from a create-project body', () => {
    const sanitized = sanitizeGeneratedResult({
      project: { id: 'proj-1', name: 'demo' },
      connection_uris: [
        {
          connection_uri: 'postgresql://neondb_owner:secret@host/neondb',
        },
      ],
      roles: [{ name: 'neondb_owner', password: 'secret' }],
      branch: { id: 'br-1' },
    });

    expect(sanitized).toEqual({
      project: { id: 'proj-1', name: 'demo' },
      roles: [{ name: 'neondb_owner' }],
      branch: { id: 'br-1' },
    });
  });

  it('strips the same credential fields from a create-branch body', () => {
    const sanitized = sanitizeGeneratedResult({
      branch: { id: 'br-1' },
      connection_uris: [
        { connection_uri: 'postgresql://neondb_owner:secret@host/neondb' },
      ],
      roles: [{ name: 'neondb_owner', password: 'secret' }],
    });

    expect(sanitized).toEqual({
      branch: { id: 'br-1' },
      roles: [{ name: 'neondb_owner' }],
    });
  });

  it('keeps a role-create password on the role object', () => {
    const data = {
      role: { name: 'app', password: 'secret' },
    };
    expect(sanitizeGeneratedResult(data)).toEqual(data);
  });
});
