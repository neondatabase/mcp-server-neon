import { parseResourceIdentifier } from '../../lib/oauth/protected-resource-metadata';
import { isReadOnly } from '../utils/read-only';

const GRANT_QUERY_KEYS = ['projectId', 'category', 'readonly'] as const;

export type ConsentMode = 'confirmation' | 'editable';

export function consentModeFromResource(
  resource: string | undefined,
): ConsentMode {
  if (!resource) {
    return 'editable';
  }
  const resourceUrl = parseResourceIdentifier(resource);
  const hasGrantParams = GRANT_QUERY_KEYS.some((key) =>
    resourceUrl.searchParams.has(key),
  );
  return hasGrantParams ? 'confirmation' : 'editable';
}

export function resourceReadOnlyHardCeiling(
  resource: string | undefined,
): boolean {
  if (!resource) {
    return false;
  }
  const resourceUrl = parseResourceIdentifier(resource);
  if (!resourceUrl.searchParams.has('readonly')) {
    return false;
  }
  return isReadOnly({
    queryParamValue: resourceUrl.searchParams.get('readonly'),
  });
}

export function preferenceReadOnly({
  authorizeReadOnly,
  headerValue,
}: {
  authorizeReadOnly: string | null;
  headerValue: string | null;
}): boolean {
  return isReadOnly({
    queryParamValue: authorizeReadOnly,
    headerValue,
  });
}
