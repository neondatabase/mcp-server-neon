import { NextRequest, NextResponse } from 'next/server';
import { model } from '../../../mcp/oauth/model';
import { revokeGrantForClient } from '../../../mcp/oauth/grant-revocation';
import { handleOAuthError } from '../../../lib/errors';
import { logger } from '../../../mcp/utils/logger';
import {
  authenticateClient,
  extractClientCredentials,
} from '../../../lib/oauth/client-credentials';

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type');
    if (!contentType?.includes('application/x-www-form-urlencoded')) {
      return NextResponse.json(
        { error: 'invalid_request', error_description: 'Invalid content type' },
        { status: 415 },
      );
    }

    const body = await request.text();
    const formData = new URLSearchParams(body);

    // Validate client
    const credentials = extractClientCredentials(request, formData);
    const { clientId } = credentials;
    if (!clientId) {
      return NextResponse.json(
        {
          error: 'invalid_request',
          error_description: 'client_id is required',
        },
        { status: 400 },
      );
    }

    const client = await model.getClient(clientId, '');
    if (!client) {
      // RFC 7009: Return 200 even for invalid client to prevent fishing
      return new NextResponse(null, { status: 200 });
    }

    if (!(await authenticateClient(client, credentials))) {
      return NextResponse.json(
        {
          error: 'invalid_client',
          error_description: 'Invalid client credentials',
        },
        { status: 401 },
      );
    }

    // Get token to revoke
    const token = formData.get('token');
    if (!token) {
      return NextResponse.json(
        { error: 'invalid_request', error_description: 'token is required' },
        { status: 400 },
      );
    }

    const tokenTypeHint = formData.get('token_type_hint');

    try {
      await revokeGrantForClient(token, client.id, tokenTypeHint);
    } catch (error) {
      logger.error('OAuth grant revocation did not complete', {
        clientId,
        errorName: error instanceof Error ? error.name : 'unknown',
      });

      return NextResponse.json(
        {
          error: 'temporarily_unavailable',
          error_description: 'Token revocation did not complete; please retry',
        },
        { status: 503, headers: { 'Retry-After': '30' } },
      );
    }

    // RFC 7009: Always return 200, even if token was not found
    return new NextResponse(null, { status: 200 });
  } catch (error: unknown) {
    return handleOAuthError(error, 'Token revocation error');
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
