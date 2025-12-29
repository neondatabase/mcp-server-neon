import { NextRequest, NextResponse } from 'next/server';
import he from 'he';
import { model } from '../../../mcp-src/oauth/model';
import { upstreamAuth } from '../../../lib/oauth/client';
import {
  isClientAlreadyApproved,
  updateApprovedClientsCookie,
} from '../../../lib/oauth/cookies';
import { COOKIE_SECRET } from '../../../lib/config';

export type DownstreamAuthRequest = {
  responseType: string;
  clientId: string;
  redirectUri: string;
  scope: string[];
  state: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
};

const parseAuthRequest = (
  searchParams: URLSearchParams,
): DownstreamAuthRequest => {
  const responseType = searchParams.get('response_type') || '';
  const clientId = searchParams.get('client_id') || '';
  const redirectUri = searchParams.get('redirect_uri') || '';
  const scope = searchParams.get('scope') || '';
  const state = searchParams.get('state') || '';
  const codeChallenge = searchParams.get('code_challenge') || undefined;
  const codeChallengeMethod =
    searchParams.get('code_challenge_method') || 'plain';

  return {
    responseType,
    clientId,
    redirectUri,
    scope: scope.split(' ').filter(Boolean),
    state,
    codeChallenge,
    codeChallengeMethod,
  };
};

// Generate approval dialog HTML
const renderApprovalDialog = (
  client: {
    client_name?: string;
    client_uri?: string;
    redirect_uris?: string[];
    [key: string]: unknown;
  },
  state: string,
) => {
  const clientName = he.escape(client.client_name || 'A new MCP Client');
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
  <title>${clientName} | Authorization Request</title>
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
        <img src="/logo.png" alt="Neon MCP" class="logo">
      </a>
    </div>
    <div class="card">
      <h2 class="alert"><strong>MCP Client Authorization Request</strong></h2>
      <div class="client-info">
        <div class="client-detail">
          <div class="detail-label">Name:</div>
          <div class="detail-value">${clientName}</div>
        </div>${websiteHtml}${redirectUrisHtml}
      </div>
      <p class="description">
        This MCP client is requesting to be authorized on Neon MCP Server.
        If you approve, you will be redirected to complete the authentication.
      </p>
      <form method="POST" action="/api/authorize">
        <input type="hidden" name="state" value="${he.escape(state)}" />
        <div class="actions">
          <button type="button" class="button button-secondary" onclick="window.history.back()">Cancel</button>
          <button type="submit" class="button button-primary">Approve</button>
        </div>
      </form>
    </div>
  </div>
</body>
</html>
`;
  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html' },
  });
};

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const requestParams = parseAuthRequest(searchParams);

  const clientId = requestParams.clientId;
  const client = await model.getClient(clientId, '');
  if (!client) {
    return NextResponse.json(
      { code: 'invalid_request', error: 'invalid client id' },
      { status: 400 },
    );
  }

  if (
    requestParams.responseType === undefined ||
    !client.response_types.includes(requestParams.responseType)
  ) {
    return NextResponse.json(
      { code: 'invalid_request', error: 'invalid response type' },
      { status: 400 },
    );
  }

  if (
    requestParams.redirectUri === undefined ||
    !client.redirect_uris.includes(requestParams.redirectUri)
  ) {
    return NextResponse.json(
      { code: 'invalid_request', error: 'invalid redirect uri' },
      { status: 400 },
    );
  }

  if (await isClientAlreadyApproved(client.id, COOKIE_SECRET)) {
    const authUrl = await upstreamAuth(btoa(JSON.stringify(requestParams)));
    return NextResponse.redirect(authUrl.href);
  }

  return renderApprovalDialog(client, btoa(JSON.stringify(requestParams)));
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const state = formData.get('state') as string;

  if (!state) {
    return NextResponse.json(
      { code: 'invalid_request', error: 'invalid state' },
      { status: 400 },
    );
  }

  const requestParams = JSON.parse(atob(state)) as DownstreamAuthRequest;
  await updateApprovedClientsCookie(requestParams.clientId, COOKIE_SECRET);

  const authUrl = await upstreamAuth(state);
  return NextResponse.redirect(authUrl.href);
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
