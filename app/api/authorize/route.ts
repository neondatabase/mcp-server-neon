import { NextRequest, NextResponse } from 'next/server';
import { model } from '../../../mcp/oauth/model';
import { upstreamAuth } from '../../../lib/oauth/client';
import { handleOAuthError } from '../../../lib/errors';
import {
  isReadOnly,
  hasWriteScope,
  SUPPORTED_SCOPES,
} from '../../../mcp/utils/read-only';
import { logger } from '../../../mcp/utils/logger';
import { matchesRedirectUri } from '../../../lib/oauth/redirect-uri';
import {
  DEFAULT_GRANT,
  resolveGrantFromResourceUri,
  type GrantContext,
} from '../../../mcp/utils/grant-context';
import { renderConsentHtml } from '../../../mcp/oauth/consent-dialog';

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

function resolveGrantedScopes({
  requestedScopes,
  grantWrite,
}: {
  requestedScopes: string[];
  grantWrite: boolean;
}): string[] {
  const requested =
    requestedScopes.length > 0 ? requestedScopes : ['read', 'write'];
  const granted = ['read'];
  if (!grantWrite) {
    return granted;
  }
  granted.push('write');
  // Legacy wildcard clients treat omission as a partial grant.
  if (requested.includes('*')) {
    granted.push('*');
  }
  return granted;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const requestParams = parseAuthRequest(searchParams);
    // Parse resource URI early so malformed values fail at authorize time.
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
    const grantWrite = !defaultReadOnly && hasWriteScope(requestedScopes);
    const effectiveScopes = resolveGrantedScopes({
      requestedScopes,
      grantWrite,
    });

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

    const html = renderConsentHtml({
      client,
      state: btoa(JSON.stringify(requestParams)),
      requestedScopes: effectiveScopes,
      defaultReadOnly,
      readOnlyRequestedByConnection: isReadOnly({
        queryParamValue: resourceReadOnlyQueryParam,
      }),
      grant: resourceGrant,
    });
    return new NextResponse(html, {
      headers: { 'Content-Type': 'text/html' },
    });
  } catch (error: unknown) {
    return handleOAuthError(error, 'Authorization error');
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const state = formData.get('state') as string;
    const selectedScopes = formData.getAll('scopes') as string[];

    if (!state) {
      return NextResponse.json(
        {
          error: 'invalid_request',
          error_description: 'Invalid state',
        },
        { status: 400 },
      );
    }

    // Filter to only valid scopes (read is always included via hidden input)
    const validScopes = selectedScopes.filter((s) =>
      SUPPORTED_SCOPES.includes(s as (typeof SUPPORTED_SCOPES)[number]),
    );
    if (validScopes.length === 0) {
      return NextResponse.json(
        {
          error: 'invalid_scope',
          error_description: 'No valid scopes selected',
        },
        { status: 400 },
      );
    }

    const requestParams = JSON.parse(atob(state)) as DownstreamAuthRequest;
    const grantWrite = hasWriteScope(validScopes);
    const grantedScopes = resolveGrantedScopes({
      requestedScopes: requestParams.scope,
      grantWrite,
    });

    requestParams.scope = grantedScopes;
    const grant = requestParams.resource
      ? resolveGrantFromResourceUri(requestParams.resource)
      : { ...DEFAULT_GRANT };
    await model.saveClientAuthContext(requestParams.clientId, {
      grant,
      scope: grantedScopes,
      readOnly: !hasWriteScope(grantedScopes),
    });

    // Re-encode state with updated scopes
    const updatedState = btoa(JSON.stringify(requestParams));
    const authUrl = await upstreamAuth(updatedState);
    return NextResponse.redirect(authUrl.href);
  } catch (error: unknown) {
    return handleOAuthError(error, 'Authorization error');
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
