import { NextResponse } from "next/server";
import { logger } from "../mcp-src/utils/logger";

type OAuthErrorResponse = {
  error: string;
  error_description?: string;
};

/**
 * Handles errors from OAuth flows and returns appropriate HTTP responses.
 * - ResponseBodyError (openid-client) with 4xx → 400
 * - ResponseBodyError with 5xx → 502 (bad gateway)
 * - Network errors → 502 (upstream unavailable)
 * - JSON parse errors → 400 (bad request)
 * - Other errors → 500 (internal server error)
 */
export function handleOAuthError(
  error: unknown,
  context: string,
): NextResponse<OAuthErrorResponse> {
  const message = error instanceof Error ? error.message : "Unknown error";
  logger.error(`${context}:`, { message, error });

  // ResponseBodyError from openid-client (upstream OAuth errors)
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code: string }).code === "RESPONSE_BODY_ERROR"
  ) {
    const oauthError = error as {
      error?: string;
      error_description?: string;
      status?: number;
    };
    const upstreamStatus = oauthError.status ?? 500;
    const responseStatus = upstreamStatus >= 500 ? 502 : 400;

    return NextResponse.json(
      {
        error: oauthError.error ?? "upstream_error",
        error_description: oauthError.error_description,
      },
      { status: responseStatus },
    );
  }

  // Network errors
  if (error instanceof TypeError && message.includes("fetch")) {
    return NextResponse.json(
      {
        error: "upstream_unavailable",
        error_description: "Failed to connect to authorization server",
      },
      { status: 502 },
    );
  }

  // JSON parse errors
  if (error instanceof SyntaxError && message.includes("JSON")) {
    return NextResponse.json(
      {
        error: "invalid_request",
        error_description: "Invalid JSON in request body",
      },
      { status: 400 },
    );
  }

  // Internal server errors
  return NextResponse.json(
    { error: "server_error", error_description: "Internal server error" },
    { status: 500 },
  );
}
