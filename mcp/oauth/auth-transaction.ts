import {
  SCOPE_CATEGORIES,
  type GrantContext,
  type ScopeCategory,
} from '../utils/grant-context';
import type { ConsentMode } from './consent-mode';
import {
  parseDownstreamAuthRequest,
  type DownstreamAuthRequest,
} from './downstream-auth-request';
import type { ConsentCeiling } from './consent-approval';

export type PendingAuthTransaction = {
  status: 'pending';
  id: string;
  browserSecretHash: string;
  expiresAt: Date;
  request: DownstreamAuthRequest;
  mode: ConsentMode;
  ceiling: ConsentCeiling;
  defaultReadOnly: boolean;
  resourceGrant: GrantContext;
  resourceReadOnlyHard: boolean;
};

export type ApprovedAuthTransaction = {
  status: 'approved';
  id: string;
  browserSecretHash: string;
  expiresAt: Date;
  request: DownstreamAuthRequest;
  mode: ConsentMode;
  ceiling: ConsentCeiling;
  defaultReadOnly: boolean;
  resourceGrant: GrantContext;
  resourceReadOnlyHard: boolean;
  approvedGrant: GrantContext;
  approvedScopes: string[];
};

export type AuthTransaction = PendingAuthTransaction | ApprovedAuthTransaction;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isScopeCategory(value: unknown): value is ScopeCategory {
  return (
    typeof value === 'string' &&
    SCOPE_CATEGORIES.some((category) => category === value)
  );
}

function parseGrantContext(value: unknown): GrantContext | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (value.projectId !== null && typeof value.projectId !== 'string') {
    return undefined;
  }
  if (value.scopes !== null) {
    if (!Array.isArray(value.scopes) || !value.scopes.every(isScopeCategory)) {
      return undefined;
    }
  }
  const unknownCategories = value.unknownCategories;
  if (
    unknownCategories !== undefined &&
    (!Array.isArray(unknownCategories) ||
      !unknownCategories.every((item) => typeof item === 'string'))
  ) {
    return undefined;
  }
  return {
    projectId: value.projectId,
    scopes: value.scopes,
    ...(unknownCategories && unknownCategories.length > 0
      ? { unknownCategories }
      : {}),
  };
}

function parseCeiling(value: unknown): ConsentCeiling | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (typeof value.writeAllowed !== 'boolean') {
    return undefined;
  }
  if (value.projectId !== null && typeof value.projectId !== 'string') {
    return undefined;
  }
  if (value.scopes !== null) {
    if (!Array.isArray(value.scopes) || !value.scopes.every(isScopeCategory)) {
      return undefined;
    }
  }
  return {
    writeAllowed: value.writeAllowed,
    projectId: value.projectId,
    scopes: value.scopes,
  };
}

function parseMode(value: unknown): ConsentMode | undefined {
  if (value === 'confirmation' || value === 'editable') {
    return value;
  }
  return undefined;
}

function parseDate(value: unknown): Date | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }
  return undefined;
}

function parseStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  if (!value.every((item) => typeof item === 'string')) {
    return undefined;
  }
  return value;
}

export function parseAuthTransaction(
  value: unknown,
): AuthTransaction | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (typeof value.id !== 'string') {
    return undefined;
  }
  if (typeof value.browserSecretHash !== 'string') {
    return undefined;
  }
  const expiresAt = parseDate(value.expiresAt);
  if (!expiresAt) {
    return undefined;
  }
  const request = parseDownstreamAuthRequest(value.request);
  if (!request) {
    return undefined;
  }
  const mode = parseMode(value.mode);
  if (!mode) {
    return undefined;
  }
  const ceiling = parseCeiling(value.ceiling);
  if (!ceiling) {
    return undefined;
  }
  if (typeof value.defaultReadOnly !== 'boolean') {
    return undefined;
  }
  const resourceGrant = parseGrantContext(value.resourceGrant);
  if (!resourceGrant) {
    return undefined;
  }
  if (typeof value.resourceReadOnlyHard !== 'boolean') {
    return undefined;
  }
  const base = {
    id: value.id,
    browserSecretHash: value.browserSecretHash,
    expiresAt,
    request,
    mode,
    ceiling,
    defaultReadOnly: value.defaultReadOnly,
    resourceGrant,
    resourceReadOnlyHard: value.resourceReadOnlyHard,
  };
  if (value.status === 'pending') {
    return { ...base, status: 'pending' };
  }
  if (value.status === 'approved') {
    const approvedGrant = parseGrantContext(value.approvedGrant);
    const approvedScopes = parseStringArray(value.approvedScopes);
    if (!approvedGrant || !approvedScopes) {
      return undefined;
    }
    return {
      ...base,
      status: 'approved',
      approvedGrant,
      approvedScopes,
    };
  }
  return undefined;
}
