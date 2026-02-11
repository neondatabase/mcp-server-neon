import { NextRequest, NextResponse } from "next/server";
import { model } from "../../../mcp-src/oauth/model";
import { handleOAuthError } from "../../../lib/errors";
import { logger } from "../../../mcp-src/utils/logger";

const extractClientCredentials = (
  request: NextRequest,
  formData: URLSearchParams,
) => {
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Basic ")) {
    const credentials = atob(authorization.replace(/^Basic\s+/i, ""));
    const [clientId, clientSecret] = credentials.split(":");
    return { clientId, clientSecret };
  }
  return {
    clientId: formData.get("client_id") ?? undefined,
    clientSecret: formData.get("client_secret") ?? undefined,
  };
};

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type");
    if (!contentType?.includes("application/x-www-form-urlencoded")) {
      return NextResponse.json(
        { error: "invalid_request", error_description: "Invalid content type" },
        { status: 415 },
      );
    }

    const body = await request.text();
    const formData = new URLSearchParams(body);

    // Validate client
    const { clientId, clientSecret } = extractClientCredentials(
      request,
      formData,
    );
    if (!clientId) {
      return NextResponse.json(
        {
          error: "invalid_request",
          error_description: "client_id is required",
        },
        { status: 400 },
      );
    }

    const client = await model.getClient(clientId, "");
    if (!client) {
      // RFC 7009: Return 200 even for invalid client to prevent fishing
      return new NextResponse(null, { status: 200 });
    }

    const isPublicClient = client.tokenEndpointAuthMethod === "none";
    if (!isPublicClient && clientSecret !== client.secret) {
      return NextResponse.json(
        {
          error: "invalid_client",
          error_description: "Invalid client credentials",
        },
        { status: 401 },
      );
    }

    // Get token to revoke
    const token = formData.get("token");
    if (!token) {
      return NextResponse.json(
        { error: "invalid_request", error_description: "token is required" },
        { status: 400 },
      );
    }

    const tokenTypeHint = formData.get("token_type_hint");

    // Try to revoke based on hint (optimization) or try both
    if (tokenTypeHint === "refresh_token" || !tokenTypeHint) {
      const refreshToken = await model.getRefreshToken(token);
      if (refreshToken) {
        // Delete both refresh token and associated access token
        const accessToken = await model.getAccessToken(
          refreshToken.accessToken,
        );
        if (accessToken && accessToken.client.id === client.id) {
          await model.deleteToken(accessToken);
        }
        await model.deleteRefreshToken(refreshToken);
        logger.info("Token revoked", { clientId, type: "refresh_token" });
        return new NextResponse(null, { status: 200 });
      }
    }

    if (tokenTypeHint === "access_token" || !tokenTypeHint) {
      const accessToken = await model.getAccessToken(token);
      if (accessToken && accessToken.client.id === client.id) {
        await model.deleteToken(accessToken);
        logger.info("Token revoked", { clientId, type: "access_token" });
      }
    }

    // RFC 7009: Always return 200, even if token was not found
    return new NextResponse(null, { status: 200 });
  } catch (error: unknown) {
    return handleOAuthError(error, "Token revocation error");
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}
