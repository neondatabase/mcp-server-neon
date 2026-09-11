import { hasWriteScope } from '../utils/read-only';

function defaultRequestedScopes(scope: string[]): string[] {
  return scope.length > 0 ? scope : ['read', 'write'];
}

export function oauthWriteAllowed(scope: string[]): boolean {
  return hasWriteScope(defaultRequestedScopes(scope));
}

export function isWriteChecked({
  requestedScopes,
  defaultReadOnly,
}: {
  requestedScopes: string[];
  defaultReadOnly: boolean;
}): boolean {
  return !defaultReadOnly && oauthWriteAllowed(requestedScopes);
}

export function issuedOauthScopes({
  requestedScopes,
  grantWrite,
}: {
  requestedScopes: string[];
  grantWrite: boolean;
}): string[] {
  const requested = defaultRequestedScopes(requestedScopes);
  const granted = ['read'];
  if (!grantWrite) {
    return granted;
  }
  granted.push('write');
  if (requested.includes('*')) {
    granted.push('*');
  }
  return granted;
}
