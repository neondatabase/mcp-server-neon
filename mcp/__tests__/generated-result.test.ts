import { describe, expect, it } from 'vitest';
import { sanitizeGeneratedResult } from '../tools/generated/sanitize';

describe('sanitizeGeneratedResult', () => {
  it('strips connection_uris and role passwords from a create-project body', () => {
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

  it('strips the same credential fields from a create-branch body', () => {
    const sanitized = sanitizeGeneratedResult('createProjectBranch', {
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

  it('strips a stored password from a role GET', () => {
    const sanitized = sanitizeGeneratedResult('getProjectBranchRole', {
      role: { name: 'app', password: 'secret', protected: false },
    });
    expect(sanitized).toEqual({
      role: { name: 'app', protected: false },
    });
  });
});
