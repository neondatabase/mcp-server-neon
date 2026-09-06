import { NextRequest, NextResponse } from 'next/server';
import he from 'he';
import { model } from '../../../mcp/oauth/model';
import { upstreamAuth } from '../../../lib/oauth/client';
import { handleOAuthError } from '../../../lib/errors';
import {
  isReadOnly,
  hasWriteScope,
  SCOPE_DEFINITIONS,
  SUPPORTED_SCOPES,
} from '../../../mcp/utils/read-only';
import { logger } from '../../../mcp/utils/logger';
import {
  matchesRedirectUri,
  isDangerousRedirectUri,
  isLoopbackHost,
} from '../../../lib/oauth/redirect-uri';
import { isAuthorizePostOriginAllowed } from '../../../lib/oauth/authorize-origin';
import {
  AuthorizeStateConfigError,
  AuthorizeStateError,
  signAuthorizeState,
  verifyAuthorizeState,
  type DownstreamAuthRequest,
} from '../../../lib/oauth/authorize-state';
import {
  DEFAULT_GRANT,
  resolveGrantFromResourceUri,
  type GrantContext,
} from '../../../mcp/utils/grant-context';

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

/**
 * Renders the scope selection UI.
 * Read access is always granted. Write access is always shown as an option.
 */
function renderScopeSection(
  requestedScopes: string[],
  defaultReadOnly: boolean,
): string {
  const writeChecked =
    !defaultReadOnly &&
    (requestedScopes.length === 0 || hasWriteScope(requestedScopes));

  // Read access is always granted (hidden input ensures it's submitted)
  let html = `<input type="hidden" name="scopes" value="read" />`;

  html += `
    <div class="scope-item scope-granted">
      <span class="scope-check">✓</span>
      <div class="scope-info">
        <span class="scope-label">${he.escape(SCOPE_DEFINITIONS.read.label)}</span>
        <span class="scope-description">${he.escape(SCOPE_DEFINITIONS.read.description)}</span>
      </div>
    </div>
  `;

  html += `
    <label class="scope-item scope-option">
      <input
        type="checkbox"
        name="scopes"
        value="write"
        ${writeChecked ? 'checked' : ''}
        class="scope-checkbox"
      />
      <div class="scope-info">
        <span class="scope-label">${he.escape(SCOPE_DEFINITIONS.write.label)}</span>
        <span class="scope-description">${he.escape(SCOPE_DEFINITIONS.write.description)}</span>
      </div>
    </label>
  `;

  return html;
}

// Generate approval dialog HTML
const renderApprovalDialog = (
  client: {
    client_name?: string;
    client_uri?: string;
    redirect_uris?: string[];
    [key: string]: unknown;
  },
  state: string,
  requestedScopes: string[],
  defaultReadOnly: boolean,
  redirectUri: string,
) => {
  const claimedName = he.escape(client.client_name || 'A new MCP Client');
  let headline = 'Authorize a local application';
  try {
    const parsed = new URL(redirectUri);
    if (!isLoopbackHost(parsed.hostname)) {
      headline = `Authorize ${he.escape(parsed.hostname)}`;
    }
  } catch {
    headline = 'Authorization Request';
  }
  const website = client.client_uri ? he.escape(client.client_uri) : undefined;
  const redirectUris = client.redirect_uris;

  const websiteHtml = website
    ? `
          <div class="client-detail">
            <div class="detail-label">Website:</div>
            <div class="detail-value small">
              <a href="${website}" target="_blank" rel="noopener noreferrer">${website}</a>
            </div>
          </div>`
    : '';

  const redirectUrisHtml =
    redirectUris && redirectUris.length > 0
      ? `
          <div class="client-detail">
            <div class="detail-label">Redirect URIs:</div>
            <div class="detail-value small">
              ${redirectUris.map((uri) => `<div>${he.escape(uri)}</div>`).join('')}
            </div>
          </div>`
      : '';

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${headline} | Neon MCP</title>
  <style>
    :root {
      --primary-color: #0070f3;
      --error-color: #f44336;
      --text-color: #dedede;
      --text-color-secondary: #949494;
      --background-color: #1c1c1c;
      --border-color: #2a2929;
      --card-shadow: 0 0px 12px 0px rgb(0 230 153 / 0.3);
      --link-color: rgb(0 230 153 / 1);
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica,
        Arial, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol';
      line-height: 1.6;
      color: var(--text-color);
      background-color: var(--background-color);
      margin: 0;
      padding: 0;
    }

    .container {
      max-width: 600px;
      margin: 2rem auto;
      padding: 1rem;
    }

    .precard {
      padding: 2rem;
      text-align: center;
    }

    .card {
      background-color: #0a0c09e6;
      border-radius: 8px;
      box-shadow: var(--card-shadow);
      padding: 2rem;
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 1.5rem;
      color: var(--text-color);
      text-decoration: none;
    }

    .logo {
      width: 48px;
      height: 48px;
      margin-right: 1rem;
      border-radius: 8px;
      object-fit: contain;
    }

    .alert {
      margin: 0;
      font-size: 1.5rem;
      font-weight: 400;
      margin: 1rem 0;
      text-align: center;
    }

    .description {
      color: var(--text-color-secondary);
    }

    .client-info {
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 1rem 1rem 0.5rem;
      margin-bottom: 1.5rem;
    }

    .client-detail {
      display: flex;
      margin-bottom: 0.5rem;
      align-items: baseline;
    }

    .detail-label {
      font-weight: 500;
      min-width: 120px;
    }

    .detail-value {
      font-family: SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono',
        'Courier New', monospace;
      word-break: break-all;
    }

    .detail-value a {
      color: inherit;
      text-decoration: underline;
    }

    .detail-value.small {
      font-size: 0.8em;
    }

    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 1rem;
      margin-top: 2rem;
    }

    .button {
      padding: 0.65rem 1rem;
      border-radius: 6px;
      font-weight: 500;
      cursor: pointer;
      border: none;
      font-size: 1rem;
    }

    .button-primary {
      background-color: rgb(0 229 153 / 1);
      color: rgb(26 26 26 / 1);
    }

    .button-secondary {
      background-color: transparent;
      border: 1px solid rgb(73 75 80 / 1);
      color: var(--text-color);
    }

    .scope-section {
      margin: 1.5rem 0;
      padding-top: 1rem;
      border-top: 1px solid var(--border-color);
    }

    .scope-section-title {
      font-weight: 500;
      margin-bottom: 1rem;
      color: var(--text-color);
    }

    .scope-item {
      display: flex;
      align-items: flex-start;
      padding: 0.75rem;
      border: 1px solid var(--border-color);
      border-radius: 8px;
      margin-bottom: 0.5rem;
    }

    .scope-option {
      cursor: pointer;
      transition: border-color 0.2s, background-color 0.2s;
    }

    .scope-option:hover {
      border-color: rgba(0, 230, 153, 0.5);
      background-color: rgba(0, 230, 153, 0.05);
    }

    .scope-granted {
      background-color: rgba(0, 230, 153, 0.05);
      border-color: rgba(0, 230, 153, 0.3);
    }

    .scope-check {
      color: rgb(0, 229, 153);
      font-size: 1rem;
      margin-right: 0.75rem;
      margin-top: 2px;
      flex-shrink: 0;
    }

    .scope-checkbox {
      width: 18px;
      height: 18px;
      margin-right: 0.75rem;
      margin-top: 2px;
      accent-color: rgb(0, 229, 153);
      cursor: pointer;
      flex-shrink: 0;
    }

    .scope-info {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .scope-label {
      font-weight: 500;
      color: var(--text-color);
    }

    .scope-description {
      font-size: 0.875rem;
      color: var(--text-color-secondary);
    }

    @media (max-width: 640px) {
      .container {
        margin: 1rem auto;
        padding: 0.5rem;
      }

      .card {
        padding: 1.5rem;
      }

      .client-detail {
        flex-direction: column;
      }

      .detail-label {
        min-width: unset;
        margin-bottom: 0.25rem;
      }

      .actions {
        flex-direction: column;
      }

      .button {
        width: 100%;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="precard">
      <a class="header" href="/" target="_blank">
        <img src="https://neon.com/brand/neon-logomark-dark-color.svg" alt="Neon MCP" class="logo">
      </a>
    </div>
    <div class="card">
      <h2 class="alert"><strong>${headline}</strong></h2>
      <div class="client-info">
        <div class="client-detail">
          <div class="detail-label">Claimed name:</div>
          <div class="detail-value">${claimedName}</div>
        </div>${websiteHtml}${redirectUrisHtml}
      </div>
      <p class="description">
        This MCP client is requesting to be authorized on Neon MCP Server.
        If you approve, you will be redirected to complete the authentication.
      </p>
      <form method="POST" action="/api/authorize" id="authorize-form">
        <input type="hidden" name="state" value="${he.escape(state)}" />
        <div class="scope-section">
          <div class="scope-section-title">Permissions:</div>
          ${renderScopeSection(requestedScopes, defaultReadOnly)}
        </div>
        <div class="actions">
          <button type="button" class="button button-secondary" onclick="window.history.back()">Cancel</button>
          <button type="submit" class="button button-primary">Approve</button>
        </div>
      </form>
    </div>
  </div>
  <script>
    function updateUrlScope() {
      var writeCheckbox = document.querySelector('.scope-checkbox');
      var scopes = ['read'];
      if (writeCheckbox && writeCheckbox.checked) {
        scopes.push('write');
      }
      var url = new URL(window.location.href);
      url.searchParams.set('scope', scopes.join(' '));
      window.history.replaceState({}, '', url.toString());
    }

    var writeCheckbox = document.querySelector('.scope-checkbox');
    if (writeCheckbox) {
      writeCheckbox.addEventListener('change', updateUrlScope);
    }
  </script>
</body>
</html>
`;
  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html' },
  });
};

function redirectUriRejection(
  clientId: string,
  providedRedirectUri: string,
  registeredRedirectUris: string[],
  reason: 'dangerous_scheme' | 'mismatch',
): NextResponse {
  logger.warn('Invalid redirect URI', {
    clientId,
    providedRedirectUri,
    registeredRedirectUris,
    reason,
  });
  return NextResponse.json(
    {
      error: 'invalid_request',
      error_description: 'Invalid redirect URI',
    },
    { status: 400 },
  );
}

function mapAuthorizeError(error: unknown, context: string): NextResponse {
  if (error instanceof AuthorizeStateConfigError) {
    logger.error(context, { error: error.message });
    return NextResponse.json(
      {
        error: 'server_error',
        error_description: 'COOKIE_SECRET is not set',
      },
      { status: 500 },
    );
  }
  if (error instanceof AuthorizeStateError) {
    return NextResponse.json(
      {
        error: 'invalid_request',
        error_description: error.message,
      },
      { status: 400 },
    );
  }
  return handleOAuthError(error, context);
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

    if (requestParams.redirectUri === undefined) {
      return redirectUriRejection(
        requestParams.clientId,
        requestParams.redirectUri,
        client.redirect_uris,
        'mismatch',
      );
    }
    if (isDangerousRedirectUri(requestParams.redirectUri)) {
      return redirectUriRejection(
        requestParams.clientId,
        requestParams.redirectUri,
        client.redirect_uris,
        'dangerous_scheme',
      );
    }
    if (!matchesRedirectUri(requestParams.redirectUri, client.redirect_uris)) {
      return redirectUriRejection(
        requestParams.clientId,
        requestParams.redirectUri,
        client.redirect_uris,
        'mismatch',
      );
    }

    await model.saveClientAuthContext(clientId, {
      grant: resourceGrant,
      scope: effectiveScopes,
      readOnly: !hasWriteScope(effectiveScopes),
    });

    return renderApprovalDialog(
      client,
      signAuthorizeState({
        payload: requestParams,
        maxScope: effectiveScopes,
      }),
      effectiveScopes,
      defaultReadOnly,
      requestParams.redirectUri,
    );
  } catch (error: unknown) {
    return mapAuthorizeError(error, 'Authorization error');
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!isAuthorizePostOriginAllowed(request)) {
      return NextResponse.json(
        {
          error: 'invalid_request',
          error_description: 'Invalid origin',
        },
        { status: 400 },
      );
    }

    const formData = await request.formData();
    const stateValue = formData.get('state');
    const selectedScopes = formData
      .getAll('scopes')
      .filter((value): value is string => typeof value === 'string');

    if (typeof stateValue !== 'string' || stateValue.length === 0) {
      return NextResponse.json(
        {
          error: 'invalid_request',
          error_description: 'Invalid state',
        },
        { status: 400 },
      );
    }

    const { payload: requestParams, maxScope } =
      verifyAuthorizeState(stateValue);

    const client = await model.getClient(requestParams.clientId, '');
    if (!client) {
      return NextResponse.json(
        {
          error: 'invalid_client',
          error_description: 'Invalid client ID',
        },
        { status: 400 },
      );
    }

    if (isDangerousRedirectUri(requestParams.redirectUri)) {
      return redirectUriRejection(
        requestParams.clientId,
        requestParams.redirectUri,
        client.redirect_uris,
        'dangerous_scheme',
      );
    }
    if (!matchesRedirectUri(requestParams.redirectUri, client.redirect_uris)) {
      return redirectUriRejection(
        requestParams.clientId,
        requestParams.redirectUri,
        client.redirect_uris,
        'mismatch',
      );
    }

    const validScopes = selectedScopes.filter((scope) =>
      SUPPORTED_SCOPES.some((supported) => supported === scope),
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

    const grantWrite =
      validScopes.includes('write') && maxScope.includes('write');
    const grantedScopes = resolveGrantedScopes({
      requestedScopes: maxScope,
      grantWrite,
    });
    if (!grantedScopes.every((scope) => maxScope.includes(scope))) {
      return NextResponse.json(
        {
          error: 'invalid_scope',
          error_description: 'Requested scopes exceed the consent grant',
        },
        { status: 400 },
      );
    }

    requestParams.scope = grantedScopes;
    const grant = requestParams.resource
      ? resolveGrantFromResourceUri(requestParams.resource)
      : { ...DEFAULT_GRANT };
    await model.saveClientAuthContext(requestParams.clientId, {
      grant,
      scope: grantedScopes,
      readOnly: !hasWriteScope(grantedScopes),
    });

    const updatedState = signAuthorizeState({
      payload: requestParams,
      maxScope: grantedScopes,
    });
    const authUrl = await upstreamAuth(updatedState);
    return NextResponse.redirect(authUrl.href);
  } catch (error: unknown) {
    return mapAuthorizeError(error, 'Authorization error');
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
