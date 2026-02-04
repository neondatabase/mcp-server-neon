import { NextRequest, NextResponse } from 'next/server';
import { model } from '../../../mcp-src/oauth/model';
import { generateRandomString } from '../../../mcp-src/oauth/utils';
import { handleOAuthError } from '../../../lib/errors';
import { logger } from '../../../mcp-src/utils/logger';
import type { Client } from 'oauth2-server';

const SUPPORTED_GRANT_TYPES = ['authorization_code', 'refresh_token'];
const SUPPORTED_RESPONSE_TYPES = ['code'];

export async function POST(request: NextRequest) {
  logger.debug('POST handler entered', { url: request.url });
  try {
    const payload = await request.json();

    logger.info('request to register client', {
      name: payload.client_name,
      client_uri: payload.client_uri,
    });

    if (payload.client_name === undefined) {
      return NextResponse.json(
        {
          error: 'invalid_request',
          error_description: 'client_name is required',
        },
        { status: 400 },
      );
    }

    if (payload.redirect_uris === undefined) {
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

    logger.debug('before model.saveClient', { clientId: client.id });
    await model.saveClient(client);
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

    logger.debug('about to create NextResponse.json', {
      responseBodyKeys: Object.keys(responseBody),
      clientId,
      hasClientSecret: !!responseBody.client_secret,
    });

    let response: NextResponse;
    try {
      logger.debug('calling NextResponse.json');
      response = NextResponse.json(responseBody);
      logger.debug('NextResponse.json succeeded', {
        responseType: typeof response,
        responseStatus: response?.status,
        isResponse: response instanceof Response,
      });
    } catch (jsonError) {
      logger.error('NextResponse.json threw error', {
        error: jsonError instanceof Error ? jsonError.message : String(jsonError),
        stack: jsonError instanceof Error ? jsonError.stack : undefined,
      });
      throw jsonError;
    }

    logger.debug('about to return response', {
      responseExists: !!response,
      responseType: typeof response,
    });

    return response;
  } catch (error: unknown) {
    logger.debug('catch block entered', {
      errorType: typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorName: error instanceof Error ? error.name : undefined,
    });
    logger.error('caught error in register handler', {
      error,
      errorType: typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
    });
    const errorResponse = handleOAuthError(error, 'Client registration error');
    logger.debug('returning from catch block', {
      errorResponseExists: !!errorResponse,
      errorResponseType: typeof errorResponse,
    });
    return errorResponse;
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
