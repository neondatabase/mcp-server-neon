import { describe, expect, it } from 'vitest';
import {
  confirmationApproval,
  confirmationCeiling,
  editableCeiling,
  parseConsentPost,
} from '../oauth/consent-approval';
import { DEFAULT_GRANT } from '../utils/grant-context';

function form(entries: Array<[string, string]>): FormData {
  const data = new FormData();
  for (const [name, value] of entries) {
    data.append(name, value);
  }
  return data;
}

describe('confirmationApproval', () => {
  const grant = {
    projectId: 'proj-example',
    scopes: ['querying'] as const,
  };

  it('keeps writes when the URL is writable and OAuth asked for write', () => {
    const approval = confirmationApproval({
      resourceGrant: { projectId: grant.projectId, scopes: [...grant.scopes] },
      requestScopes: ['read', 'write'],
      resourceReadOnlyHard: false,
      preferenceReadOnly: false,
    });
    expect(approval.writeGranted).toBe(true);
    expect(approval.scopes).toEqual(['read', 'write']);
  });

  it('forces read when the resource is readonly=true even if the client asked for write', () => {
    const approval = confirmationApproval({
      resourceGrant: { projectId: grant.projectId, scopes: [...grant.scopes] },
      requestScopes: ['read', 'write'],
      resourceReadOnlyHard: true,
      preferenceReadOnly: false,
    });
    expect(approval.writeGranted).toBe(false);
    expect(approval.scopes).toEqual(['read']);
  });

  it('forces read when OAuth asked for read only', () => {
    const approval = confirmationApproval({
      resourceGrant: { projectId: grant.projectId, scopes: [...grant.scopes] },
      requestScopes: ['read'],
      resourceReadOnlyHard: false,
      preferenceReadOnly: false,
    });
    expect(approval.writeGranted).toBe(false);
    expect(approval.scopes).toEqual(['read']);
  });

  it('keeps * only when write is actually granted', () => {
    expect(
      confirmationApproval({
        resourceGrant: DEFAULT_GRANT,
        requestScopes: ['read', 'write', '*'],
        resourceReadOnlyHard: false,
        preferenceReadOnly: false,
      }).scopes,
    ).toEqual(['read', 'write', '*']);
    expect(
      confirmationApproval({
        resourceGrant: DEFAULT_GRANT,
        requestScopes: ['read', 'write', '*'],
        resourceReadOnlyHard: true,
        preferenceReadOnly: false,
      }).scopes,
    ).toEqual(['read']);
  });

  it('lets a read-only preference reduce a writable URL', () => {
    const approval = confirmationApproval({
      resourceGrant: DEFAULT_GRANT,
      requestScopes: ['read', 'write'],
      resourceReadOnlyHard: false,
      preferenceReadOnly: true,
    });
    expect(approval.writeGranted).toBe(false);
  });
});

describe('parseConsentPost', () => {
  it('cancels without inspecting grant fields', () => {
    expect(
      parseConsentPost({
        form: form([
          ['state', 'abc'],
          ['action', 'cancel'],
          ['projectMode', 'one'],
          ['projectId', ''],
          ['scopes', 'write'],
        ]),
        mode: 'editable',
        ceiling: editableCeiling(['read', 'write']),
      }),
    ).toEqual({ action: 'cancel' });
  });

  it('rejects confirmation posts that include editor fields', () => {
    const parsed = parseConsentPost({
      form: form([
        ['action', 'approve'],
        ['scopes', 'write'],
      ]),
      mode: 'confirmation',
      ceiling: confirmationCeiling({
        resourceGrant: DEFAULT_GRANT,
        requestScopes: ['read'],
        resourceReadOnlyHard: false,
      }),
    });
    expect(parsed.action).toBe('invalid');
  });

  it('rejects confirmation posts that include a hidden mode field', () => {
    const parsed = parseConsentPost({
      form: form([
        ['action', 'approve'],
        ['mode', 'editable'],
      ]),
      mode: 'confirmation',
      ceiling: confirmationCeiling({
        resourceGrant: DEFAULT_GRANT,
        requestScopes: ['read', 'write'],
        resourceReadOnlyHard: false,
      }),
    });
    expect(parsed.action).toBe('invalid');
  });

  it('accepts a confirmation approve with only action', () => {
    expect(
      parseConsentPost({
        form: form([['action', 'approve']]),
        mode: 'confirmation',
        ceiling: confirmationCeiling({
          resourceGrant: DEFAULT_GRANT,
          requestScopes: ['read', 'write'],
          resourceReadOnlyHard: false,
        }),
      }),
    ).toEqual({ action: 'approve', confirmation: true });
  });

  it('accepts an editable all-project all-category read approval', () => {
    const parsed = parseConsentPost({
      form: form([
        ['action', 'approve'],
        ['projectMode', 'all'],
        ['scopes', 'read'],
        ['category', 'projects'],
        ['category', 'branches'],
        ['category', 'endpoints'],
        ['category', 'snapshots'],
        ['category', 'schema'],
        ['category', 'querying'],
        ['category', 'neon_auth'],
        ['category', 'data_api'],
        ['category', 'observability'],
        ['category', 'docs'],
        ['category', 'functions'],
        ['category', 'storage'],
      ]),
      mode: 'editable',
      ceiling: editableCeiling(['read', 'write']),
    });
    expect(parsed).toEqual({
      action: 'approve',
      confirmation: false,
      selection: {
        grant: { projectId: null, scopes: null },
        grantWrite: false,
      },
    });
  });

  it('persists no categories as an empty list', () => {
    const parsed = parseConsentPost({
      form: form([
        ['action', 'approve'],
        ['projectMode', 'all'],
        ['scopes', 'read'],
      ]),
      mode: 'editable',
      ceiling: editableCeiling(['read', 'write']),
    });
    expect(parsed).toMatchObject({
      action: 'approve',
      confirmation: false,
      selection: {
        grant: { projectId: null, scopes: [] },
        grantWrite: false,
      },
    });
  });

  it('accepts one project and a category subset with writes', () => {
    const parsed = parseConsentPost({
      form: form([
        ['action', 'approve'],
        ['projectMode', 'one'],
        ['projectId', ' proj-example '],
        ['category', 'querying'],
        ['category', 'schema'],
        ['scopes', 'read'],
        ['scopes', 'write'],
      ]),
      mode: 'editable',
      ceiling: editableCeiling(['read', 'write']),
    });
    expect(parsed).toEqual({
      action: 'approve',
      confirmation: false,
      selection: {
        grant: {
          projectId: 'proj-example',
          scopes: ['querying', 'schema'],
        },
        grantWrite: true,
      },
    });
  });

  it('re-renders a missing project ID as a field error', () => {
    const parsed = parseConsentPost({
      form: form([
        ['action', 'approve'],
        ['projectMode', 'one'],
        ['projectId', '   '],
        ['scopes', 'read'],
      ]),
      mode: 'editable',
      ceiling: editableCeiling(['read', 'write']),
    });
    expect(parsed.action).toBe('invalid');
    if (parsed.action !== 'invalid' || parsed.error.kind !== 'field') {
      throw new Error('expected field error');
    }
    expect(parsed.error.field).toBe('projectId');
  });

  it('ignores a leftover project ID when All projects is selected', () => {
    const parsed = parseConsentPost({
      form: form([
        ['action', 'approve'],
        ['projectMode', 'all'],
        ['projectId', 'proj-leftover'],
        ['scopes', 'read'],
      ]),
      mode: 'editable',
      ceiling: editableCeiling(['read', 'write']),
    });
    expect(parsed).toEqual({
      action: 'approve',
      confirmation: false,
      selection: {
        grant: { projectId: null, scopes: [] },
        grantWrite: false,
      },
    });
  });

  it('rejects a forged write when the OAuth ceiling is read-only', () => {
    const parsed = parseConsentPost({
      form: form([
        ['action', 'approve'],
        ['projectMode', 'all'],
        ['scopes', 'read'],
        ['scopes', 'write'],
      ]),
      mode: 'editable',
      ceiling: editableCeiling(['read']),
    });
    expect(parsed).toEqual({
      action: 'invalid',
      error: {
        kind: 'invalid_scope',
        description: 'Write access was not requested',
      },
    });
  });

  it('rejects * from the form', () => {
    const parsed = parseConsentPost({
      form: form([
        ['action', 'approve'],
        ['projectMode', 'all'],
        ['scopes', 'read'],
        ['scopes', '*'],
      ]),
      mode: 'editable',
      ceiling: editableCeiling(['read', 'write', '*']),
    });
    expect(parsed.action).toBe('invalid');
  });

  it('rejects unknown categories and duplicate scalars', () => {
    expect(
      parseConsentPost({
        form: form([
          ['action', 'approve'],
          ['projectMode', 'all'],
          ['category', 'not-a-category'],
          ['scopes', 'read'],
        ]),
        mode: 'editable',
        ceiling: editableCeiling(['read', 'write']),
      }).action,
    ).toBe('invalid');

    const duplicates = new FormData();
    duplicates.append('action', 'approve');
    duplicates.append('projectMode', 'all');
    duplicates.append('projectMode', 'one');
    duplicates.append('scopes', 'read');
    expect(
      parseConsentPost({
        form: duplicates,
        mode: 'editable',
        ceiling: editableCeiling(['read', 'write']),
      }).action,
    ).toBe('invalid');
  });

  it('rejects a file-valued field', () => {
    const data = new FormData();
    data.append('action', 'approve');
    data.append('projectMode', 'all');
    data.append('scopes', 'read');
    data.append('projectId', new File(['x'], 'x.txt'));
    expect(
      parseConsentPost({
        form: data,
        mode: 'editable',
        ceiling: editableCeiling(['read', 'write']),
      }).action,
    ).toBe('invalid');
  });
});
