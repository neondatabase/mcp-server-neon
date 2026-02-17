import { describe, it, expect } from 'vitest';
import {
  enforceProtectedBranches,
  GrantViolationError,
} from '../tools/grant-enforcement';
import type { GrantContext } from '../utils/grant-context';
import { DEFAULT_GRANT } from '../utils/grant-context';
import type { Api } from '@neondatabase/api-client';

function grant(overrides: Partial<GrantContext> = {}): GrantContext {
  return { ...DEFAULT_GRANT, ...overrides };
}

// ---------------------------------------------------------------------------
// GrantViolationError
// ---------------------------------------------------------------------------
describe('GrantViolationError', () => {
  it('is an instance of Error', () => {
    const err = new GrantViolationError('test');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(GrantViolationError);
  });

  it('has name "GrantViolationError"', () => {
    const err = new GrantViolationError('msg');
    expect(err.name).toBe('GrantViolationError');
  });
});

// ---------------------------------------------------------------------------
// enforceProtectedBranches – no protection
// ---------------------------------------------------------------------------
describe('enforceProtectedBranches – no protection', () => {
  it('does nothing when protectedBranches is null', async () => {
    await expect(
      enforceProtectedBranches(grant(), 'delete_branch', {
        branchId: 'main',
      }),
    ).resolves.toBeUndefined();
  });

  it('does nothing when protectedBranches is empty', async () => {
    await expect(
      enforceProtectedBranches(
        grant({ protectedBranches: [] }),
        'delete_branch',
        { branchId: 'main' },
      ),
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// enforceProtectedBranches – non-sensitive tools
// ---------------------------------------------------------------------------
describe('enforceProtectedBranches – non-sensitive tools', () => {
  const protectedGrant = grant({
    protectedBranches: ['main', 'prod'],
  });

  it('allows describe_project (not branch-sensitive)', async () => {
    await expect(
      enforceProtectedBranches(protectedGrant, 'describe_project', {
        projectId: 'proj-1',
      }),
    ).resolves.toBeUndefined();
  });

  it('allows list_projects (not branch-sensitive)', async () => {
    await expect(
      enforceProtectedBranches(protectedGrant, 'list_projects', {}),
    ).resolves.toBeUndefined();
  });

  it('allows create_branch (not branch-sensitive)', async () => {
    await expect(
      enforceProtectedBranches(protectedGrant, 'create_branch', {
        projectId: 'proj-1',
        branchName: 'main',
      }),
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// enforceProtectedBranches – branch-sensitive tools
// ---------------------------------------------------------------------------
describe('enforceProtectedBranches – branch-sensitive tools (protected)', () => {
  const protectedGrant = grant({
    protectedBranches: ['main', 'master', 'prod', 'production'],
  });

  it('throws for delete_branch targeting a protected branch', async () => {
    await expect(
      enforceProtectedBranches(protectedGrant, 'delete_branch', {
        branchId: 'main',
      }),
    ).rejects.toThrow(GrantViolationError);
  });

  it('throws for reset_from_parent targeting a protected branch', async () => {
    await expect(
      enforceProtectedBranches(protectedGrant, 'reset_from_parent', {
        branchIdOrName: 'prod',
      }),
    ).rejects.toThrow(GrantViolationError);
  });

  it('throws for run_sql targeting a protected branch', async () => {
    await expect(
      enforceProtectedBranches(protectedGrant, 'run_sql', {
        branchId: 'production',
      }),
    ).rejects.toThrow(GrantViolationError);
  });

  it('throws for run_sql_transaction targeting a protected branch', async () => {
    await expect(
      enforceProtectedBranches(protectedGrant, 'run_sql_transaction', {
        branchId: 'master',
      }),
    ).rejects.toThrow(GrantViolationError);
  });

  it('throws for complete_database_migration targeting a protected parent branch', async () => {
    await expect(
      enforceProtectedBranches(protectedGrant, 'complete_database_migration', {
        parentBranchId: 'main',
      }),
    ).rejects.toThrow(GrantViolationError);
  });

  it('throws for complete_query_tuning targeting a protected branch', async () => {
    await expect(
      enforceProtectedBranches(protectedGrant, 'complete_query_tuning', {
        branchId: 'prod',
      }),
    ).rejects.toThrow(GrantViolationError);
  });

  it('error message includes branch name and tool name', async () => {
    await expect(
      enforceProtectedBranches(protectedGrant, 'delete_branch', {
        branchId: 'main',
      }),
    ).rejects.toThrow(/main/);
    await expect(
      enforceProtectedBranches(protectedGrant, 'delete_branch', {
        branchId: 'main',
      }),
    ).rejects.toThrow(/delete_branch/);
  });

  it('blocks when branch ID resolves to protected branch name', async () => {
    const neonClient = {
      listProjectBranches: async () => ({
        data: {
          branches: [
            {
              id: 'br-wispy-tree-12345',
              name: 'main',
            },
          ],
        },
      }),
    } as unknown as Api<unknown>;

    await expect(
      enforceProtectedBranches(
        grant({ protectedBranches: ['main', 'prod'] }),
        'run_sql',
        {
          projectId: 'proj-1',
          branchId: 'br-wispy-tree-12345',
        },
        neonClient,
      ),
    ).rejects.toThrow(GrantViolationError);
  });

  it('blocks when branch name resolves to protected branch ID', async () => {
    const neonClient = {
      listProjectBranches: async () => ({
        data: {
          branches: [
            {
              id: 'br-wispy-tree-12345',
              name: 'main',
            },
          ],
        },
      }),
    } as unknown as Api<unknown>;

    await expect(
      enforceProtectedBranches(
        grant({ protectedBranches: ['br-wispy-tree-12345'] }),
        'run_sql',
        {
          projectId: 'proj-1',
          branchId: 'main',
        },
        neonClient,
      ),
    ).rejects.toThrow(GrantViolationError);
  });

  it('blocks when protected list mixes name and id values', async () => {
    const neonClient = {
      listProjectBranches: async () => ({
        data: {
          branches: [
            {
              id: 'br-main-001',
              name: 'main',
            },
            {
              id: 'br-prod-002',
              name: 'production',
            },
          ],
        },
      }),
    } as unknown as Api<unknown>;

    await expect(
      enforceProtectedBranches(
        grant({ protectedBranches: ['main', 'br-prod-002'] }),
        'complete_query_tuning',
        {
          projectId: 'proj-1',
          branchId: 'production',
        },
        neonClient,
      ),
    ).rejects.toThrow(GrantViolationError);
  });
});

// ---------------------------------------------------------------------------
// Case-insensitive matching
// ---------------------------------------------------------------------------
describe('enforceProtectedBranches – case-insensitive', () => {
  const protectedGrant = grant({
    protectedBranches: ['Main', 'PROD'],
  });

  it('matches case-insensitively (lowercase branch vs uppercase protected)', async () => {
    await expect(
      enforceProtectedBranches(protectedGrant, 'delete_branch', {
        branchId: 'main',
      }),
    ).rejects.toThrow(GrantViolationError);
  });

  it('matches case-insensitively (uppercase branch vs mixed-case protected)', async () => {
    await expect(
      enforceProtectedBranches(protectedGrant, 'run_sql', {
        branchId: 'PROD',
      }),
    ).rejects.toThrow(GrantViolationError);
  });
});

// ---------------------------------------------------------------------------
// Non-protected branches pass through
// ---------------------------------------------------------------------------
describe('enforceProtectedBranches – non-protected branches', () => {
  const protectedGrant = grant({
    protectedBranches: ['main', 'prod'],
  });

  it('allows delete_branch on non-protected branch', async () => {
    await expect(
      enforceProtectedBranches(protectedGrant, 'delete_branch', {
        branchId: 'feature-branch',
      }),
    ).resolves.toBeUndefined();
  });

  it('allows run_sql on non-protected branch', async () => {
    await expect(
      enforceProtectedBranches(protectedGrant, 'run_sql', {
        branchId: 'dev-branch',
      }),
    ).resolves.toBeUndefined();
  });

  it('allows when branchId arg is missing', async () => {
    await expect(
      enforceProtectedBranches(protectedGrant, 'run_sql', {
        projectId: 'proj-1',
      }),
    ).resolves.toBeUndefined();
  });

  it('allows when branchId arg is empty string', async () => {
    await expect(
      enforceProtectedBranches(protectedGrant, 'run_sql', {
        branchId: '',
      }),
    ).resolves.toBeUndefined();
  });

  it('allows when branchId arg is not a string', async () => {
    await expect(
      enforceProtectedBranches(protectedGrant, 'run_sql', {
        branchId: 123,
      }),
    ).resolves.toBeUndefined();
  });

  it('allows complete_database_migration on non-protected parent branch', async () => {
    await expect(
      enforceProtectedBranches(protectedGrant, 'complete_database_migration', {
        parentBranchId: 'feature-branch',
      }),
    ).resolves.toBeUndefined();
  });

  it('allows complete_query_tuning on non-protected branch', async () => {
    await expect(
      enforceProtectedBranches(protectedGrant, 'complete_query_tuning', {
        branchId: 'dev-branch',
      }),
    ).resolves.toBeUndefined();
  });

  it('allows when branch is unknown to lookup and not directly protected', async () => {
    const neonClient = {
      listProjectBranches: async () => ({
        data: {
          branches: [
            {
              id: 'br-known-1',
              name: 'main',
            },
          ],
        },
      }),
    } as unknown as Api<unknown>;

    await expect(
      enforceProtectedBranches(
        grant({ protectedBranches: ['main'] }),
        'run_sql',
        {
          projectId: 'proj-1',
          branchId: 'br-unknown-9',
        },
        neonClient,
      ),
    ).resolves.toBeUndefined();
  });

  it('allows when projectId is missing (no lookup possible) and direct match fails', async () => {
    const neonClient = {
      listProjectBranches: async () => ({
        data: {
          branches: [],
        },
      }),
    } as unknown as Api<unknown>;

    await expect(
      enforceProtectedBranches(
        grant({ protectedBranches: ['main'] }),
        'run_sql',
        {
          branchId: 'br-main-001',
        },
        neonClient,
      ),
    ).resolves.toBeUndefined();
  });

  it('allows when neonClient is unavailable and direct match fails', async () => {
    await expect(
      enforceProtectedBranches(
        grant({ protectedBranches: ['main', 'prod'] }),
        'run_sql',
        {
          projectId: 'proj-1',
          branchId: 'br-main-001',
        },
      ),
    ).resolves.toBeUndefined();
  });
});

describe('enforceProtectedBranches – mixed identifiers and casing', () => {
  const neonClient = {
    listProjectBranches: async () => ({
      data: {
        branches: [
          {
            id: 'BR-MAIN-ABC',
            name: 'Main',
          },
          {
            id: 'br-prod-def',
            name: 'production',
          },
        ],
      },
    }),
  } as unknown as Api<unknown>;

  it('blocks id->name match case-insensitively', async () => {
    await expect(
      enforceProtectedBranches(
        grant({ protectedBranches: ['main'] }),
        'run_sql_transaction',
        {
          projectId: 'proj-1',
          branchId: 'br-main-abc',
        },
        neonClient,
      ),
    ).rejects.toThrow(GrantViolationError);
  });

  it('blocks name->id match case-insensitively', async () => {
    await expect(
      enforceProtectedBranches(
        grant({ protectedBranches: ['br-main-abc'] }),
        'run_sql_transaction',
        {
          projectId: 'proj-1',
          branchId: 'MAIN',
        },
        neonClient,
      ),
    ).rejects.toThrow(GrantViolationError);
  });

  it('blocks completion tools with mixed protected identifiers', async () => {
    await expect(
      enforceProtectedBranches(
        grant({ protectedBranches: ['br-prod-def', 'main'] }),
        'complete_database_migration',
        {
          projectId: 'proj-1',
          parentBranchId: 'production',
        },
        neonClient,
      ),
    ).rejects.toThrow(GrantViolationError);
  });
});
