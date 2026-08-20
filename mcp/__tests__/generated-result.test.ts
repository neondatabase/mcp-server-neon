import { describe, expect, it } from 'vitest';
import { sanitizeGeneratedResult } from '../tools/generated/sanitize';

describe('sanitizeGeneratedResult', () => {
  it('strips connection_uris and role passwords from createProject', () => {
    const sanitized = sanitizeGeneratedResult('createProject', {
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

  it('leaves other operations unchanged', () => {
    const data = {
      connection_uris: [{ connection_uri: 'postgresql://keep' }],
    };
    expect(sanitizeGeneratedResult('getProject', data)).toBe(data);
  });
});
