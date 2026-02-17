import { describe, it, expect } from 'vitest';
import {
  enforceProtectedBranches,
  GrantViolationError,
} from '../tools/grant-enforcement';
import type { GrantContext } from '../utils/grant-context';
import { DEFAULT_GRANT } from '../utils/grant-context';

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
  it('does nothing when protectedBranches is null', () => {
    expect(() =>
      enforceProtectedBranches(grant(), 'delete_branch', {
        branchId: 'main',
      }),
    ).not.toThrow();
  });

  it('does nothing when protectedBranches is empty', () => {
    expect(() =>
      enforceProtectedBranches(
        grant({ protectedBranches: [] }),
        'delete_branch',
        { branchId: 'main' },
      ),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// enforceProtectedBranches – non-sensitive tools
// ---------------------------------------------------------------------------
describe('enforceProtectedBranches – non-sensitive tools', () => {
  const protectedGrant = grant({
    protectedBranches: ['main', 'prod'],
  });

  it('allows describe_project (not branch-sensitive)', () => {
    expect(() =>
      enforceProtectedBranches(protectedGrant, 'describe_project', {
        projectId: 'proj-1',
      }),
    ).not.toThrow();
  });

  it('allows list_projects (not branch-sensitive)', () => {
    expect(() =>
      enforceProtectedBranches(protectedGrant, 'list_projects', {}),
    ).not.toThrow();
  });

  it('allows create_branch (not branch-sensitive)', () => {
    expect(() =>
      enforceProtectedBranches(protectedGrant, 'create_branch', {
        projectId: 'proj-1',
        branchName: 'main',
      }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// enforceProtectedBranches – branch-sensitive tools
// ---------------------------------------------------------------------------
describe('enforceProtectedBranches – branch-sensitive tools (protected)', () => {
  const protectedGrant = grant({
    protectedBranches: ['main', 'master', 'prod', 'production'],
  });

  it('throws for delete_branch targeting a protected branch', () => {
    expect(() =>
      enforceProtectedBranches(protectedGrant, 'delete_branch', {
        branchId: 'main',
      }),
    ).toThrow(GrantViolationError);
  });

  it('throws for reset_from_parent targeting a protected branch', () => {
    expect(() =>
      enforceProtectedBranches(protectedGrant, 'reset_from_parent', {
        branchIdOrName: 'prod',
      }),
    ).toThrow(GrantViolationError);
  });

  it('throws for run_sql targeting a protected branch', () => {
    expect(() =>
      enforceProtectedBranches(protectedGrant, 'run_sql', {
        branchId: 'production',
      }),
    ).toThrow(GrantViolationError);
  });

  it('throws for run_sql_transaction targeting a protected branch', () => {
    expect(() =>
      enforceProtectedBranches(protectedGrant, 'run_sql_transaction', {
        branchId: 'master',
      }),
    ).toThrow(GrantViolationError);
  });

  it('throws for complete_database_migration targeting a protected parent branch', () => {
    expect(() =>
      enforceProtectedBranches(protectedGrant, 'complete_database_migration', {
        parentBranchId: 'main',
      }),
    ).toThrow(GrantViolationError);
  });

  it('throws for complete_query_tuning targeting a protected branch', () => {
    expect(() =>
      enforceProtectedBranches(protectedGrant, 'complete_query_tuning', {
        branchId: 'prod',
      }),
    ).toThrow(GrantViolationError);
  });

  it('error message includes branch name and tool name', () => {
    try {
      enforceProtectedBranches(protectedGrant, 'delete_branch', {
        branchId: 'main',
      });
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(GrantViolationError);
      const msg = (error as GrantViolationError).message;
      expect(msg).toContain('main');
      expect(msg).toContain('delete_branch');
    }
  });
});

// ---------------------------------------------------------------------------
// Case-insensitive matching
// ---------------------------------------------------------------------------
describe('enforceProtectedBranches – case-insensitive', () => {
  const protectedGrant = grant({
    protectedBranches: ['Main', 'PROD'],
  });

  it('matches case-insensitively (lowercase branch vs uppercase protected)', () => {
    expect(() =>
      enforceProtectedBranches(protectedGrant, 'delete_branch', {
        branchId: 'main',
      }),
    ).toThrow(GrantViolationError);
  });

  it('matches case-insensitively (uppercase branch vs mixed-case protected)', () => {
    expect(() =>
      enforceProtectedBranches(protectedGrant, 'run_sql', {
        branchId: 'PROD',
      }),
    ).toThrow(GrantViolationError);
  });
});

// ---------------------------------------------------------------------------
// Non-protected branches pass through
// ---------------------------------------------------------------------------
describe('enforceProtectedBranches – non-protected branches', () => {
  const protectedGrant = grant({
    protectedBranches: ['main', 'prod'],
  });

  it('allows delete_branch on non-protected branch', () => {
    expect(() =>
      enforceProtectedBranches(protectedGrant, 'delete_branch', {
        branchId: 'feature-branch',
      }),
    ).not.toThrow();
  });

  it('allows run_sql on non-protected branch', () => {
    expect(() =>
      enforceProtectedBranches(protectedGrant, 'run_sql', {
        branchId: 'dev-branch',
      }),
    ).not.toThrow();
  });

  it('allows when branchId arg is missing', () => {
    expect(() =>
      enforceProtectedBranches(protectedGrant, 'run_sql', {
        projectId: 'proj-1',
      }),
    ).not.toThrow();
  });

  it('allows when branchId arg is empty string', () => {
    expect(() =>
      enforceProtectedBranches(protectedGrant, 'run_sql', {
        branchId: '',
      }),
    ).not.toThrow();
  });

  it('allows when branchId arg is not a string', () => {
    expect(() =>
      enforceProtectedBranches(protectedGrant, 'run_sql', {
        branchId: 123,
      }),
    ).not.toThrow();
  });

  it('allows complete_database_migration on non-protected parent branch', () => {
    expect(() =>
      enforceProtectedBranches(protectedGrant, 'complete_database_migration', {
        parentBranchId: 'feature-branch',
      }),
    ).not.toThrow();
  });

  it('allows complete_query_tuning on non-protected branch', () => {
    expect(() =>
      enforceProtectedBranches(protectedGrant, 'complete_query_tuning', {
        branchId: 'dev-branch',
      }),
    ).not.toThrow();
  });
});
