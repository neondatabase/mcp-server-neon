import {
  SCOPE_CATEGORIES,
  type GrantContext,
  type ScopeCategory,
} from '../utils/grant-context';
import type { ConsentMode } from './consent-mode';
import { issuedOauthScopes, oauthWriteAllowed } from './issued-scopes';

const EDITOR_FIELD_NAMES = [
  'projectMode',
  'projectId',
  'category',
  'scopes',
  'mode',
  'resource',
  'client_id',
  'redirect_uri',
  'scope',
  'code_challenge',
  'code_challenge_method',
  'response_type',
] as const;

function isScopeCategory(value: string): value is ScopeCategory {
  return SCOPE_CATEGORIES.some((category) => category === value);
}

export type ConsentCeiling = {
  writeAllowed: boolean;
  projectId: string | null;
  scopes: ScopeCategory[] | null;
};

type ConfirmationApproval = {
  grant: GrantContext;
  scopes: string[];
  writeGranted: boolean;
};

export function confirmationApproval({
  resourceGrant,
  requestScopes,
  resourceReadOnlyHard,
}: {
  resourceGrant: GrantContext;
  requestScopes: string[];
  resourceReadOnlyHard: boolean;
}): ConfirmationApproval {
  const writeGranted =
    oauthWriteAllowed(requestScopes) && !resourceReadOnlyHard;
  return {
    grant: resourceGrant,
    scopes: issuedOauthScopes({
      requestedScopes: requestScopes,
      grantWrite: writeGranted,
    }),
    writeGranted,
  };
}

export function editableCeiling(requestScopes: string[]): ConsentCeiling {
  return {
    writeAllowed: oauthWriteAllowed(requestScopes),
    projectId: null,
    scopes: null,
  };
}

export function confirmationCeiling({
  resourceGrant,
  requestScopes,
  resourceReadOnlyHard,
}: {
  resourceGrant: GrantContext;
  requestScopes: string[];
  resourceReadOnlyHard: boolean;
}): ConsentCeiling {
  return {
    writeAllowed: oauthWriteAllowed(requestScopes) && !resourceReadOnlyHard,
    projectId: resourceGrant.projectId,
    scopes: resourceGrant.scopes,
  };
}

type EditableSelection = {
  grant: GrantContext;
  grantWrite: boolean;
};

type FormFieldError = {
  kind: 'field';
  field: 'projectId';
  message: string;
  selection: {
    projectMode: 'all' | 'one';
    projectId: string;
    categories: ScopeCategory[];
    grantWrite: boolean;
  };
};

type FormReject = {
  kind: 'invalid_request' | 'invalid_scope';
  description: string;
};

type ParsedConsentPost =
  | { action: 'cancel' }
  | { action: 'approve'; confirmation: true }
  | { action: 'approve'; confirmation: false; selection: EditableSelection }
  | { action: 'invalid'; error: FormFieldError | FormReject };

function formValues(form: FormData, name: string): unknown[] {
  return form.getAll(name);
}

function readScalarString(
  form: FormData,
  name: string,
): { ok: true; value: string | undefined } | { ok: false } {
  const values = formValues(form, name);
  if (values.length === 0) {
    return { ok: true, value: undefined };
  }
  if (values.length > 1) {
    return { ok: false };
  }
  const value = values[0];
  if (typeof value !== 'string') {
    return { ok: false };
  }
  return { ok: true, value };
}

function hasEditorFields(form: FormData): boolean {
  return EDITOR_FIELD_NAMES.some((name) => formValues(form, name).length > 0);
}

function parseCategories(
  form: FormData,
): { ok: true; categories: ScopeCategory[] } | { ok: false } {
  const values = formValues(form, 'category');
  const categories: ScopeCategory[] = [];
  const seen = new Set<ScopeCategory>();
  for (const value of values) {
    if (typeof value !== 'string') {
      return { ok: false };
    }
    if (!isScopeCategory(value)) {
      return { ok: false };
    }
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    categories.push(value);
  }
  return { ok: true, categories };
}

function grantFromEditableSelection({
  projectMode,
  projectId,
  categories,
}: {
  projectMode: 'all' | 'one';
  projectId: string;
  categories: ScopeCategory[];
}): GrantContext {
  const selectedProjectId = projectMode === 'one' ? projectId.trim() : null;
  const scopes =
    categories.length === 0
      ? []
      : categories.length === SCOPE_CATEGORIES.length
        ? null
        : categories;
  return {
    projectId: selectedProjectId,
    scopes,
  };
}

function selectionWithinCeiling(
  selection: EditableSelection,
  ceiling: ConsentCeiling,
): boolean {
  if (selection.grantWrite && !ceiling.writeAllowed) {
    return false;
  }
  if (ceiling.projectId !== null) {
    if (selection.grant.projectId !== ceiling.projectId) {
      return false;
    }
  }
  if (ceiling.scopes !== null) {
    const selected = selection.grant.scopes;
    if (selected === null) {
      return false;
    }
    const allowed = new Set(ceiling.scopes);
    if (selected.some((category) => !allowed.has(category))) {
      return false;
    }
  }
  return true;
}

export function parseConsentPost({
  form,
  mode,
  ceiling,
}: {
  form: FormData;
  mode: ConsentMode;
  ceiling: ConsentCeiling;
}): ParsedConsentPost {
  const actionField = readScalarString(form, 'action');
  if (!actionField.ok || actionField.value === undefined) {
    return {
      action: 'invalid',
      error: {
        kind: 'invalid_request',
        description: 'Invalid authorization action',
      },
    };
  }
  if (actionField.value === 'cancel') {
    return { action: 'cancel' };
  }
  if (actionField.value !== 'approve') {
    return {
      action: 'invalid',
      error: {
        kind: 'invalid_request',
        description: 'Invalid authorization action',
      },
    };
  }

  if (mode === 'confirmation') {
    if (hasEditorFields(form)) {
      return {
        action: 'invalid',
        error: {
          kind: 'invalid_request',
          description: 'This connection grant cannot be edited on this page',
        },
      };
    }
    return { action: 'approve', confirmation: true };
  }

  const projectModeField = readScalarString(form, 'projectMode');
  if (!projectModeField.ok || projectModeField.value === undefined) {
    return {
      action: 'invalid',
      error: {
        kind: 'invalid_request',
        description: 'Invalid project selection',
      },
    };
  }
  if (projectModeField.value !== 'all' && projectModeField.value !== 'one') {
    return {
      action: 'invalid',
      error: {
        kind: 'invalid_request',
        description: 'Invalid project selection',
      },
    };
  }

  const projectIdField = readScalarString(form, 'projectId');
  if (!projectIdField.ok) {
    return {
      action: 'invalid',
      error: {
        kind: 'invalid_request',
        description: 'Invalid project selection',
      },
    };
  }
  const projectId = projectIdField.value ?? '';
  if (projectModeField.value === 'one' && projectId.trim() === '') {
    const categoriesField = parseCategories(form);
    const scopesField = readScopeSelection(form);
    return {
      action: 'invalid',
      error: {
        kind: 'field',
        field: 'projectId',
        message: 'Enter the project ID this connection should use.',
        selection: {
          projectMode: 'one',
          projectId,
          categories: categoriesField.ok ? categoriesField.categories : [],
          grantWrite: scopesField.ok ? scopesField.grantWrite : false,
        },
      },
    };
  }

  const categoriesField = parseCategories(form);
  if (!categoriesField.ok) {
    return {
      action: 'invalid',
      error: {
        kind: 'invalid_request',
        description: 'Invalid tool categories',
      },
    };
  }

  const scopesField = readScopeSelection(form);
  if (!scopesField.ok) {
    return {
      action: 'invalid',
      error: scopesField.error,
    };
  }

  const selection: EditableSelection = {
    grant: grantFromEditableSelection({
      projectMode: projectModeField.value,
      projectId,
      categories: categoriesField.categories,
    }),
    grantWrite: scopesField.grantWrite,
  };

  if (!selectionWithinCeiling(selection, ceiling)) {
    return {
      action: 'invalid',
      error: {
        kind:
          scopesField.grantWrite && !ceiling.writeAllowed
            ? 'invalid_scope'
            : 'invalid_request',
        description:
          scopesField.grantWrite && !ceiling.writeAllowed
            ? 'Write access was not requested'
            : 'Requested grant exceeds the authorization ceiling',
      },
    };
  }

  return { action: 'approve', confirmation: false, selection };
}

function readScopeSelection(
  form: FormData,
): { ok: true; grantWrite: boolean } | { ok: false; error: FormReject } {
  const values = formValues(form, 'scopes');
  const scopes: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') {
      return {
        ok: false,
        error: {
          kind: 'invalid_request',
          description: 'Invalid scope selection',
        },
      };
    }
    if (value === '*') {
      return {
        ok: false,
        error: {
          kind: 'invalid_scope',
          description: 'Invalid scope selection',
        },
      };
    }
    if (value !== 'read' && value !== 'write') {
      return {
        ok: false,
        error: {
          kind: 'invalid_scope',
          description: 'Invalid scope selection',
        },
      };
    }
    scopes.push(value);
  }
  if (!scopes.includes('read')) {
    return {
      ok: false,
      error: {
        kind: 'invalid_scope',
        description: 'No valid scopes selected',
      },
    };
  }
  return { ok: true, grantWrite: scopes.includes('write') };
}
