import { NextRequest, NextResponse } from 'next/server';
import { model } from '../../../mcp-src/oauth/model';
import { generateRandomString } from '../../../mcp-src/oauth/utils';
import { logger } from '../../../mcp-src/utils/logger';
import type { Client } from 'oauth2-server';

const SUPPORTED_GRANT_TYPES = ['authorization_code', 'refresh_token'];
const SUPPORTED_RESPONSE_TYPES = ['code'];

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();

    logger.info('request to register client: ', {
      name: payload.client_name,
      client_uri: payload.client_uri,
    });

    if (payload.client_name === undefined) {
      return NextResponse.json(
        { code: 'invalid_request', error: 'client_name is required' },
        { status: 400 },
      );
    }

    if (payload.redirect_uris === undefined) {
      return NextResponse.json(
        { code: 'invalid_request', error: 'redirect_uris is required' },
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
          code: 'invalid_request',
          error:
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
          code: 'invalid_request',
          error:
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
    logger.info('new client registered', {
      clientId,
      client_name: payload.client_name,
      redirect_uris: payload.redirect_uris,
      client_uri: payload.client_uri,
    });

    return NextResponse.json({
      client_id: clientId,
      client_secret: clientSecret,
      client_name: payload.client_name,
      redirect_uris: payload.redirect_uris,
      token_endpoint_auth_method: client.tokenEndpointAuthMethod,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('failed to register client:', {
      message,
      error,
    });
    return NextResponse.json(
      { code: 'server_error', error: message },
      { status: 500 },
    );
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
