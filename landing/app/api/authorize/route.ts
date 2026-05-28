import { NextRequest, NextResponse } from 'next/server';
import { model } from '../../../mcp-src/oauth/model';
import { upstreamAuth } from '../../../lib/oauth/client';
import {
  isClientAlreadyApproved,
  updateApprovedClientsCookie,
} from '../../../lib/oauth/cookies';
import { COOKIE_SECRET } from '../../../lib/config';
import { handleOAuthError } from '../../../lib/errors';
import {
  isReadOnly,
  hasWriteScope,
  SUPPORTED_SCOPES,
} from '../../../mcp-src/utils/read-only';
import { logger } from '../../../mcp-src/utils/logger';
import { matchesRedirectUri } from '../../../lib/oauth/redirect-uri';
import {
  DEFAULT_GRANT,
  grantsAreEquivalent,
  resolveGrantFromResourceUri,
  type GrantContext,
} from '../../../mcp-src/utils/grant-context';
import { signState } from '../../../lib/oauth/state';
import type { ConsentSignedPayload } from '../../oauth/consent/types';

export type DownstreamAuthRequest = {
  responseType: string;
  clientId: string;
  redirectUri: string;
  scope: string[];
  state: string;
  resource?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
};

const resolveQueryParamReadOnly = (
  searchParams: URLSearchParams,
  resource: string | undefined,
): string | null => {
  const directReadOnly = searchParams.get('readonly');
  if (directReadOnly !== null) {
    return directReadOnly;
  }
  if (!resource) {
    return null;
  }
  return new URL(resource).searchParams.get('readonly');
};

const parseAuthRequest = (
  searchParams: URLSearchParams,
): DownstreamAuthRequest => {
  const responseType = searchParams.get('response_type') || '';
  const clientId = searchParams.get('client_id') || '';
  const redirectUri = searchParams.get('redirect_uri') || '';
  const scope = searchParams.get('scope') || '';
  const state = searchParams.get('state') || '';
  const resource = searchParams.get('resource') || undefined;
  const codeChallenge = searchParams.get('code_challenge') || undefined;
  const codeChallengeMethod =
    searchParams.get('code_challenge_method') || 'plain';

  return {
    responseType,
    clientId,
    redirectUri,
    scope: scope.split(' ').filter(Boolean),
    state,
    resource,
    codeChallenge,
    codeChallengeMethod,
  };
};

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const requestParams = parseAuthRequest(searchParams);

    let resourceGrant: GrantContext = { ...DEFAULT_GRANT };
    let resourceReadOnlyQueryParam: string | null = null;
    try {
      resourceGrant = resolveGrantFromResourceUri(requestParams.resource);
      resourceReadOnlyQueryParam = resolveQueryParamReadOnly(
        searchParams,
        requestParams.resource,
      );
    } catch {
      return NextResponse.json(
        {
          error: 'invalid_target',
          error_description: 'Invalid resource parameter',
        },
        { status: 400 },
      );
    }

    const clientId = requestParams.clientId;
    const client = await model.getClient(clientId, '');

    logger.info('Authorize request', {
      clientId,
      redirectUri: requestParams.redirectUri,
      responseType: requestParams.responseType,
      scope: requestParams.scope,
    });

    const savedRegisterHeaders = await model.getClientRegisterHeaders(clientId);
    const savedHeaders = savedRegisterHeaders?.headers ?? {};

    const defaultReadOnly = isReadOnly({
      queryParamValue: resourceReadOnlyQueryParam,
      headerValue:
        request.headers.get('x-read-only') ?? savedHeaders['x-read-only'],
    });
    const requestedScopes =
      requestParams.scope.length > 0 ? requestParams.scope : ['read', 'write'];
    const effectiveScopes = defaultReadOnly
      ? ['read']
      : hasWriteScope(requestedScopes)
        ? ['read', 'write']
        : ['read'];

    if (!client) {
      logger.warn('Client not found', { clientId });
      return NextResponse.json(
        {
          error: 'invalid_client',
          error_description: 'Invalid client ID',
        },
        { status: 400 },
      );
    }

    if (
      requestParams.responseType === undefined ||
      !client.response_types.includes(requestParams.responseType)
    ) {
      logger.warn('Invalid response type', {
        clientId,
        providedResponseType: requestParams.responseType,
        supportedResponseTypes: client.response_types,
      });
      return NextResponse.json(
        {
          error: 'unsupported_response_type',
          error_description: 'Invalid response type',
        },
        { status: 400 },
      );
    }

    if (
      requestParams.redirectUri === undefined ||
      !matchesRedirectUri(requestParams.redirectUri, client.redirect_uris)
    ) {
      logger.warn('Invalid redirect URI', {
        clientId: requestParams.clientId,
        providedRedirectUri: requestParams.redirectUri,
        registeredRedirectUris: client.redirect_uris,
      });
      return NextResponse.json(
        {
          error: 'invalid_request',
          error_description: 'Invalid redirect URI',
        },
        { status: 400 },
      );
    }

    await model.saveClientAuthContext(clientId, {
      grant: resourceGrant,
      scope: effectiveScopes,
      readOnly: !hasWriteScope(effectiveScopes),
    });

    // Re-show policy: even if a cookie says this client was approved
    // before, force consent again whenever the grant *shape* the client is
    // currently asking for differs from the shape stored at last approval.
    // This prevents an attacker from reusing a stale approval cookie to
    // silently expand or change the agent's authorization surface.
    if (await isClientAlreadyApproved(client.id, COOKIE_SECRET)) {
      const storedContext = await model.getClientAuthContext(clientId);
      if (
        storedContext &&
        grantsAreEquivalent(storedContext.grant, resourceGrant)
      ) {
        requestParams.scope = effectiveScopes;
        await updateApprovedClientsCookie(clientId, COOKIE_SECRET);
        const authUrl = await upstreamAuth(btoa(JSON.stringify(requestParams)));
        return NextResponse.redirect(authUrl.href);
      }
    }

    // Build the HMAC-signed envelope that hands the parsed authorize
    // request to /oauth/consent without trusting form input on the way
    // back. The page verifies with COOKIE_SECRET and rejects on
    // mismatch. See landing/lib/oauth/state.ts for the format.
    const consentPayload: ConsentSignedPayload = {
      authRequest: requestParams,
      requestedScope: effectiveScopes.filter((s) =>
        SUPPORTED_SCOPES.includes(s as (typeof SUPPORTED_SCOPES)[number]),
      ),
      defaultReadOnly,
      iat: Date.now(),
    };
    const signedState = await signState(consentPayload, COOKIE_SECRET);

    const consentUrl = new URL('/oauth/consent', request.nextUrl.origin);
    consentUrl.searchParams.set('state', signedState);
    return NextResponse.redirect(consentUrl.href);
  } catch (error: unknown) {
    return handleOAuthError(error, 'Authorization error');
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
