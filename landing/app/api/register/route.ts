import { NextRequest, NextResponse } from 'next/server';
import { model } from '../../../mcp-src/oauth/model';
import { generateRandomString } from '../../../mcp-src/oauth/utils';
import { handleOAuthError } from '../../../lib/errors';
import { logger } from '../../../mcp-src/utils/logger';
import type { Client } from 'oauth2-server';

const SUPPORTED_GRANT_TYPES = ['authorization_code', 'refresh_token'];
const SUPPORTED_RESPONSE_TYPES = ['code'];
const DEBUG_RUN_ID = 'register-project-id-500';

function getRequestHeadersObject(request: NextRequest): Record<string, string> {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  return headers;
}

function emitAgentDebugLog(payload: {
  hypothesisId: string;
  location: string;
  message: string;
  data: Record<string, unknown>;
}) {
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/3825217b-2560-43d0-8a8b-fb137ff631ed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      runId: DEBUG_RUN_ID,
      hypothesisId: payload.hypothesisId,
      location: payload.location,
      message: payload.message,
      data: payload.data,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
}

export async function POST(request: NextRequest) {
  let exitPath = 'uninitialized';
  let exitStatus: number | null = null;
  try {
    // #region agent log
    emitAgentDebugLog({
      hypothesisId: 'H1',
      location: 'app/api/register/route.ts:POST:entry',
      message: 'register POST handler entered',
      data: { method: request.method, hasBody: true },
    });
    // #endregion

    const payload = await request.json();
    const requestHeaders = getRequestHeadersObject(request);
    // #region agent log
    emitAgentDebugLog({
      hypothesisId: 'H2',
      location: 'app/api/register/route.ts:POST:after_json',
      message: 'parsed register payload and headers',
      data: {
        payloadKeys: Object.keys(payload ?? {}),
        headerCount: Object.keys(requestHeaders).length,
        hasProjectHeader: 'x-neon-project-id' in requestHeaders,
      },
    });
    // #endregion

    logger.info('request to register client', {
      name: payload.client_name,
      client_uri: payload.client_uri,
      headers: requestHeaders,
    });

    if (payload.client_name === undefined) {
      const response = NextResponse.json(
        {
          error: 'invalid_request',
          error_description: 'client_name is required',
        },
        { status: 400 },
      );
      logger.debug('register validation failed', {
        reason: 'client_name_missing',
        status: response.status,
      });
      exitPath = 'validation_client_name';
      exitStatus = response.status;
      return response;
    }

    if (payload.redirect_uris === undefined) {
      const response = NextResponse.json(
        {
          error: 'invalid_request',
          error_description: 'redirect_uris is required',
        },
        { status: 400 },
      );
      logger.debug('register validation failed', {
        reason: 'redirect_uris_missing',
        status: response.status,
      });
      exitPath = 'validation_redirect_uris';
      exitStatus = response.status;
      return response;
    }

    if (
      payload.grant_types === undefined ||
      !payload.grant_types.every((grant: string) =>
        SUPPORTED_GRANT_TYPES.includes(grant),
      )
    ) {
      const response = NextResponse.json(
        {
          error: 'invalid_request',
          error_description:
            'grant_types is required and must only include supported grant types',
        },
        { status: 400 },
      );
      logger.debug('register validation failed', {
        reason: 'grant_types_invalid',
        status: response.status,
      });
      exitPath = 'validation_grant_types';
      exitStatus = response.status;
      return response;
    }

    if (
      payload.response_types === undefined ||
      !payload.response_types.every((responseType: string) =>
        SUPPORTED_RESPONSE_TYPES.includes(responseType),
      )
    ) {
      const response = NextResponse.json(
        {
          error: 'invalid_request',
          error_description:
            'response_types is required and must only include supported response types',
        },
        { status: 400 },
      );
      logger.debug('register validation failed', {
        reason: 'response_types_invalid',
        status: response.status,
      });
      exitPath = 'validation_response_types';
      exitStatus = response.status;
      return response;
    }

    const clientId = generateRandomString(8);
    const clientSecret = generateRandomString(32);
    const client: Client = {
      ...payload,
      id: clientId,
      secret: clientSecret,
      tokenEndpointAuthMethod:
        (payload.token_endpoint_auth_method as string) ?? 'client_secret_post',
      registrationDate: Math.floor(Date.now() / 1000),
    };

    logger.debug('before model.saveClient', { clientId: client.id });
    // #region agent log
    emitAgentDebugLog({
      hypothesisId: 'H3',
      location: 'app/api/register/route.ts:POST:before_save',
      message: 'about to persist client and registration headers',
      data: {
        clientId,
        tokenEndpointAuthMethod: client.tokenEndpointAuthMethod,
      },
    });
    // #endregion
    await model.saveClient(client);
    await model.saveClientRegisterHeaders(clientId, requestHeaders);
    logger.debug('after model.saveClient completed', { clientId: client.id });

    logger.info('new client registered', {
      clientId,
      client_name: payload.client_name,
      redirect_uris: payload.redirect_uris,
      client_uri: payload.client_uri,
    });

    const responseBody = {
      client_id: clientId,
      client_secret: clientSecret,
      client_name: payload.client_name,
      redirect_uris: payload.redirect_uris,
      token_endpoint_auth_method: client.tokenEndpointAuthMethod,
    };

    logger.info('returning registration response', {
      clientId,
      tokenEndpointAuthMethod: responseBody.token_endpoint_auth_method,
    });

    const response = NextResponse.json(responseBody);
    logger.debug('register response built', {
      responseKind: 'NextResponse',
      status: response.status,
      hasContentType: !!response.headers.get('content-type'),
      contentType: response.headers.get('content-type'),
    });
    // #region agent log
    emitAgentDebugLog({
      hypothesisId: 'H1',
      location: 'app/api/register/route.ts:POST:success_return',
      message: 'returning successful register response',
      data: {
        status: response.status,
        responseHasContentType: !!response.headers.get('content-type'),
      },
    });
    // #endregion
    exitPath = 'success';
    exitStatus = response.status;
    return response;
  } catch (error: unknown) {
    logger.error('caught error in register handler', {
      error,
      errorType: typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
    });
    const errorResponse = handleOAuthError(error, 'Client registration error');
    logger.debug('register error response built', {
      responseKind: 'NextResponse',
      status: errorResponse.status,
      hasContentType: !!errorResponse.headers.get('content-type'),
      contentType: errorResponse.headers.get('content-type'),
    });
    // #region agent log
    emitAgentDebugLog({
      hypothesisId: 'H4',
      location: 'app/api/register/route.ts:POST:catch_return',
      message: 'returning error response from catch block',
      data: {
        status: errorResponse.status,
        errorMessage: error instanceof Error ? error.message : String(error),
      },
    });
    // #endregion
    exitPath = 'catch';
    exitStatus = errorResponse.status;
    return errorResponse;
  } finally {
    // #region agent log
    emitAgentDebugLog({
      hypothesisId: 'H1',
      location: 'app/api/register/route.ts:POST:finally',
      message: 'register POST handler exiting',
      data: { exitPath, exitStatus },
    });
    // #endregion
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers':
        'Content-Type, Authorization, X-Neon-Read-Only, x-read-only',
    },
  });
}
