import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { COOKIE_SECRET } from '../../../lib/config';
import { verifyAndDecodeState } from '../../../lib/oauth/state';
import { matchesRedirectUri } from '../../../lib/oauth/redirect-uri';
import { model } from '../../../mcp-src/oauth/model';
import { logger } from '../../../mcp-src/utils/logger';
import {
  resolveGrantFromResourceUri,
  type GrantContext,
} from '../../../mcp-src/utils/grant-context';
import { ConsentForm } from './ConsentForm';
import type { ConsentFormProps, ConsentSignedPayload } from './types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const metadata: Metadata = {
  title: 'Authorization request | Neon MCP',
  robots: { index: false, follow: false },
};

type SearchParams = {
  state?: string | string[];
};

const firstValue = (
  value: string | string[] | undefined,
): string | undefined => {
  if (Array.isArray(value)) return value[0];
  return value;
};

/**
 * OAuth consent page.
 *
 * Renders the rich React-based authorization request UI. The route is
 * navigated to via 302 from `GET /api/authorize` after that handler has
 * already validated the requesting client, redirect URI, and resource
 * parameter, then signed an envelope with the parsed authorize request.
 *
 * This page re-validates the envelope server-side before rendering so a
 * tampered or stale `state` query param fails fast instead of producing
 * an interactive consent screen that the Server Action would reject
 * after the user clicks Approve.
 */
export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const resolved = await searchParams;
  const signedState = firstValue(resolved.state);
  if (!signedState) {
    logger.warn('consent_page.missing_state');
    notFound();
  }

  const payload = await verifyAndDecodeState<ConsentSignedPayload>(
    signedState,
    COOKIE_SECRET,
  );
  if (!payload) {
    logger.warn('consent_page.invalid_state');
    notFound();
  }

  const client = await model.getClient(payload.authRequest.clientId, '');
  if (!client) {
    logger.warn('consent_page.client_not_found', {
      clientId: payload.authRequest.clientId,
    });
    notFound();
  }

  if (
    !payload.authRequest.redirectUri ||
    !matchesRedirectUri(payload.authRequest.redirectUri, client.redirect_uris)
  ) {
    logger.warn('consent_page.redirect_uri_mismatch', {
      clientId: payload.authRequest.clientId,
      redirectUri: payload.authRequest.redirectUri,
    });
    notFound();
  }

  // The grant the *client* asked for via the resource URI. The user is
  // allowed to narrow within these bounds but never to widen them. We
  // fall back to a permissive grant when the client did not constrain
  // themselves — in that case the user can pick whatever subset they
  // want.
  let resourceGrant: GrantContext = { projectId: null, scopes: null };
  try {
    resourceGrant = resolveGrantFromResourceUri(payload.authRequest.resource);
  } catch {
    // Ignore — GET /api/authorize already rejects malformed resource URIs.
    // If we somehow got here with a bad resource, treat it as fully open
    // and trust the GET handler's earlier validation.
  }

  const props: ConsentFormProps = {
    signedState,
    client: {
      name: client.client_name ?? 'A new MCP client',
      website: client.client_uri ?? null,
      redirectUris: client.redirect_uris ?? [],
    },
    initial: {
      readOnly: payload.defaultReadOnly,
      categories: resourceGrant.scopes,
      projectId: resourceGrant.projectId,
    },
    locks: {
      // The MCP client capped the available categories via its resource
      // URI. The user can narrow within this set; the form will hide
      // the "all categories" branch in that case.
      categoriesLockedToSubsetOf: resourceGrant.scopes,
      // The client pinned a single project. Keep it visible but
      // read-only — narrowing only.
      projectIdLocked: resourceGrant.projectId !== null,
      // The client (or registration headers, or query param) demanded
      // read-only mode. The user can keep it; widening to write is not
      // permitted.
      forceReadOnly:
        payload.defaultReadOnly && payload.requestedScope.length === 1,
    },
  };

  return <ConsentForm {...props} />;
}
