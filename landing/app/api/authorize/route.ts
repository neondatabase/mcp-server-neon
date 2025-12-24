import { NextRequest, NextResponse } from 'next/server';
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
  client: { client_name?: string; client_uri?: string; [key: string]: unknown },
  state: string,
) => {
  const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Authorize Application</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a0a;
      color: #fff;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      padding: 20px;
      box-sizing: border-box;
    }
    .container {
      background: #1a1a1a;
      border: 1px solid #333;
      border-radius: 12px;
      padding: 32px;
      max-width: 400px;
      width: 100%;
    }
    h1 {
      font-size: 24px;
      margin: 0 0 8px 0;
    }
    .client-name {
      color: #00e599;
      font-weight: 600;
    }
    p {
      color: #888;
      margin: 16px 0;
      line-height: 1.5;
    }
    .permissions {
      background: #111;
      border-radius: 8px;
      padding: 16px;
      margin: 24px 0;
    }
    .permissions h3 {
      margin: 0 0 12px 0;
      font-size: 14px;
      color: #888;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .permissions ul {
      margin: 0;
      padding: 0 0 0 20px;
      color: #ccc;
    }
    .permissions li {
      margin: 8px 0;
    }
    .buttons {
      display: flex;
      gap: 12px;
      margin-top: 24px;
    }
    button {
      flex: 1;
      padding: 12px 24px;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 500;
      cursor: pointer;
      border: none;
    }
    .approve {
      background: #00e599;
      color: #000;
    }
    .approve:hover {
      background: #00cc88;
    }
    .deny {
      background: #333;
      color: #fff;
    }
    .deny:hover {
      background: #444;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Authorize <span class="client-name">${client.client_name || 'Application'}</span></h1>
    <p>This application wants to access your Neon account.</p>

    <div class="permissions">
      <h3>Permissions requested</h3>
      <ul>
        <li>Read and manage your projects</li>
        <li>Read and manage your organizations</li>
        <li>Access your account information</li>
      </ul>
    </div>

    <form method="POST" action="/api/authorize">
      <input type="hidden" name="state" value="${state}" />
      <div class="buttons">
        <button type="button" class="deny" onclick="window.close()">Deny</button>
        <button type="submit" class="approve">Authorize</button>
      </div>
    </form>
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
