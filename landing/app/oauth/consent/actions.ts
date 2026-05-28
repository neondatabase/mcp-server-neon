'use server';

import { redirect } from 'next/navigation';
import { COOKIE_SECRET } from '../../../lib/config';
import { upstreamAuth } from '../../../lib/oauth/client';
import { updateApprovedClientsCookie } from '../../../lib/oauth/cookies';
import { matchesRedirectUri } from '../../../lib/oauth/redirect-uri';
import { verifyAndDecodeState } from '../../../lib/oauth/state';
import { model } from '../../../mcp-src/oauth/model';
import {
  DEFAULT_GRANT,
  resolveGrantFromResourceUri,
  SCOPE_CATEGORIES,
  type GrantContext,
  type ScopeCategory,
} from '../../../mcp-src/utils/grant-context';
import { hasWriteScope } from '../../../mcp-src/utils/read-only';
import { logger } from '../../../mcp-src/utils/logger';
import type { ConsentSignedPayload } from './types';

const VALID_CATEGORY_SET: ReadonlySet<string> = new Set(SCOPE_CATEGORIES);

/**
 * Maximum age of a signed consent envelope, in milliseconds. The signed
 * state is cheap to regenerate (the browser just hits GET /api/authorize
 * again) so we keep this short to bound the replay window if a signed
 * state ever leaks through a referrer header.
 */
const STATE_TTL_MS = 30 * 60 * 1000;

type AuthRequestPayload = ConsentSignedPayload['authRequest'];

const sanitizeCategories = (raw: string[]): ScopeCategory[] =>
  Array.from(
    new Set(raw.filter((c): c is ScopeCategory => VALID_CATEGORY_SET.has(c))),
  );

/**
 * Build the final grant context from the user's form input, applying the
 * narrowing-only policy: the user may further restrict whatever the MCP
 * client originally requested via the resource URI, but never widen.
 */
const computeFinalGrant = ({
  resourceGrant,
  userCategories,
  userProjectId,
  selectedAll,
}: {
  resourceGrant: GrantContext;
  userCategories: ScopeCategory[];
  userProjectId: string | null;
  selectedAll: boolean;
}): GrantContext => {
  // Project ID: if the client pinned one, force the user's value to match.
  // If the client did not pin one, accept whatever the user typed.
  const projectId = resourceGrant.projectId ?? userProjectId;

  // Categories: when the client capped the category set, intersect the
  // user's selection with that cap. When the user picked "all categories"
  // and the client allows it, set scopes to null to mean "everything".
  let scopes: ScopeCategory[] | null;
  if (resourceGrant.scopes !== null) {
    const allowed = new Set<ScopeCategory>(resourceGrant.scopes);
    scopes = userCategories.filter((c) => allowed.has(c));
  } else if (selectedAll) {
    scopes = null;
  } else {
    scopes = userCategories;
  }

  return { projectId, scopes };
};

const buildErrorRedirectUrl = (
  redirectUri: string,
  state: string | undefined,
  error: string,
  description?: string,
): string => {
  const url = new URL(redirectUri);
  url.searchParams.set('error', error);
  if (description) url.searchParams.set('error_description', description);
  if (state) url.searchParams.set('state', state);
  return url.toString();
};

const verifyPayload = async (
  signedState: string | null,
): Promise<ConsentSignedPayload | null> => {
  const payload = await verifyAndDecodeState<ConsentSignedPayload>(
    signedState,
    COOKIE_SECRET,
  );
  if (!payload) return null;
  if (
    typeof payload.iat !== 'number' ||
    Date.now() - payload.iat > STATE_TTL_MS
  ) {
    return null;
  }
  return payload;
};

const reconstructUpstreamState = (
  authRequest: AuthRequestPayload,
  effectiveScope: string[],
): string => {
  // Preserve the legacy unsigned base64 envelope shape that
  // `app/callback/route.ts` expects to decode after the upstream OAuth
  // round-trip. The upstream `state` is opaque to Hydra; we just need the
  // callback decoder to match.
  const updated: AuthRequestPayload = {
    ...authRequest,
    scope: effectiveScope,
  };
  return btoa(JSON.stringify(updated));
};

export async function approveConsent(formData: FormData): Promise<void> {
  const signedState = formData.get('signedState');
  if (typeof signedState !== 'string') {
    logger.warn('consent_action.approve.missing_state');
    redirect('/oauth/consent/error?reason=missing_state');
  }

  const payload = await verifyPayload(signedState);
  if (!payload) {
    logger.warn('consent_action.approve.invalid_state');
    redirect('/oauth/consent/error?reason=invalid_state');
  }

  const client = await model.getClient(payload.authRequest.clientId, '');
  if (!client) {
    logger.warn('consent_action.approve.client_not_found', {
      clientId: payload.authRequest.clientId,
    });
    redirect('/oauth/consent/error?reason=invalid_client');
  }

  if (
    !payload.authRequest.redirectUri ||
    !matchesRedirectUri(payload.authRequest.redirectUri, client.redirect_uris)
  ) {
    logger.warn('consent_action.approve.redirect_mismatch', {
      clientId: payload.authRequest.clientId,
    });
    redirect('/oauth/consent/error?reason=invalid_redirect');
  }

  const userCategories = sanitizeCategories(
    formData.getAll('categories').map(String),
  );
  const userProjectId =
    typeof formData.get('projectId') === 'string'
      ? (formData.get('projectId') as string).trim() || null
      : null;
  const selectedAll = formData.get('categoriesAll') === 'true';
  const userReadOnly = formData.get('readonly') === 'true';

  // Narrowing-only on the OAuth scope axis: when the client requested
  // read-only (or the registration headers mandated it) the user cannot
  // widen back to write. When the client requested `read write` (or no
  // scope at all) the user picks freely via the `readonly` toggle.
  const writeAvailable = !(
    payload.defaultReadOnly &&
    payload.requestedScope.length === 1 &&
    payload.requestedScope[0] === 'read'
  );
  const effectiveScope: string[] =
    writeAvailable && !userReadOnly ? ['read', 'write'] : ['read'];

  let resourceGrant: GrantContext = { ...DEFAULT_GRANT };
  try {
    resourceGrant = resolveGrantFromResourceUri(payload.authRequest.resource);
  } catch {
    // Ignore — GET /api/authorize already rejects malformed resource URIs.
  }

  const finalGrant = computeFinalGrant({
    resourceGrant,
    userCategories,
    userProjectId,
    selectedAll,
  });

  await model.saveClientAuthContext(payload.authRequest.clientId, {
    grant: finalGrant,
    scope: effectiveScope,
    readOnly: !hasWriteScope(effectiveScope),
  });

  await updateApprovedClientsCookie(
    payload.authRequest.clientId,
    COOKIE_SECRET,
  );

  const upstreamState = reconstructUpstreamState(
    payload.authRequest,
    effectiveScope,
  );
  const authUrl = await upstreamAuth(upstreamState);
  logger.info('consent_action.approve.success', {
    clientId: payload.authRequest.clientId,
    scope: effectiveScope,
    readOnly: !hasWriteScope(effectiveScope),
    grantScopes: finalGrant.scopes,
    grantHasProjectId: finalGrant.projectId !== null,
  });
  redirect(authUrl.href);
}

export async function cancelConsent(formData: FormData): Promise<void> {
  const signedState = formData.get('signedState');
  if (typeof signedState !== 'string') {
    redirect('/oauth/consent/error?reason=missing_state');
  }

  const payload = await verifyPayload(signedState);
  if (!payload) {
    redirect('/oauth/consent/error?reason=invalid_state');
  }

  const client = await model.getClient(payload.authRequest.clientId, '');
  if (
    !client ||
    !matchesRedirectUri(payload.authRequest.redirectUri, client.redirect_uris)
  ) {
    redirect('/oauth/consent/error?reason=invalid_redirect');
  }

  const target = buildErrorRedirectUrl(
    payload.authRequest.redirectUri,
    payload.authRequest.state || undefined,
    'access_denied',
    'User denied the authorization request',
  );
  logger.info('consent_action.cancel', {
    clientId: payload.authRequest.clientId,
  });
  redirect(target);
}
