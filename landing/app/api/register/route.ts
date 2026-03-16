import { NextRequest, NextResponse } from 'next/server';
import { model } from '../../../mcp-src/oauth/model';
import { generateRandomString } from '../../../mcp-src/oauth/utils';
import { handleOAuthError } from '../../../lib/errors';
import { logger } from '../../../mcp-src/utils/logger';
import type { Client } from 'oauth2-server';

const SUPPORTED_GRANT_TYPES = ['authorization_code', 'refresh_token'];
const SUPPORTED_RESPONSE_TYPES = ['code'];

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    const requestHeaders: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      requestHeaders[key.toLowerCase()] = value;
    });

    logger.info('request to register client', {
      name: payload.client_name,
      client_uri: payload.client_uri,
      grantHeaders: {
        xNeonReadOnly: requestHeaders['x-neon-read-only'],
        xReadOnly: requestHeaders['x-read-only'],
        xNeonProjectId: requestHeaders['x-neon-project-id'],
        xNeonScopes: requestHeaders['x-neon-scopes'],
      },
    });

    if (payload.client_name === undefined) {
      logger.warn('Client registration validation failed', {
        reason: 'client_name_missing',
      });
      return NextResponse.json(
        {
          error: 'invalid_request',
          error_description: 'client_name is required',
        },
        { status: 400 },
      );
    }

    if (payload.redirect_uris === undefined) {
      logger.warn('Client registration validation failed', {
        reason: 'redirect_uris_missing',
      });
      return NextResponse.json(
        {
          error: 'invalid_request',
          error_description: 'redirect_uris is required',
        },
        { status: 400 },
      );
    }

    if (
      payload.grant_types === undefined ||
      !payload.grant_types.every((grant: string) =>
        SUPPORTED_GRANT_TYPES.includes(grant),
      )
    ) {
      logger.warn('Client registration validation failed', {
        reason: 'grant_types_invalid',
      });
      return NextResponse.json(
        {
          error: 'invalid_request',
          error_description:
            'grant_types is required and must only include supported grant types',
        },
        { status: 400 },
      );
    }

    if (
      payload.response_types === undefined ||
      !payload.response_types.every((responseType: string) =>
        SUPPORTED_RESPONSE_TYPES.includes(responseType),
      )
    ) {
      logger.warn('Client registration validation failed', {
        reason: 'response_types_invalid',
      });
      return NextResponse.json(
        {
          error: 'invalid_request',
          error_description:
            'response_types is required and must only include supported response types',
        },
        { status: 400 },
      );
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

    await model.saveClient(client);
    await model.saveClientRegisterHeaders(clientId, requestHeaders);

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

    return NextResponse.json(responseBody);
  } catch (error: unknown) {
    logger.error('caught error in register handler', {
      error,
      errorType: typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
    });
    return handleOAuthError(error, 'Client registration error');
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
