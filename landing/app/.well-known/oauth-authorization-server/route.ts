import { NextResponse } from "next/server";
import { SERVER_HOST } from "@/lib/config";
import { SUPPORTED_SCOPES } from "@/mcp-src/utils/read-only";

const SUPPORTED_GRANT_TYPES = ["authorization_code", "refresh_token"];
const SUPPORTED_RESPONSE_TYPES = ["code"];
const SUPPORTED_AUTH_METHODS = [
  "client_secret_post",
  "client_secret_basic",
  "none",
];
const SUPPORTED_CODE_CHALLENGE_METHODS = ["S256"];

export async function GET() {
  return NextResponse.json({
    issuer: SERVER_HOST,
    authorization_endpoint: `${SERVER_HOST}/api/authorize`,
    token_endpoint: `${SERVER_HOST}/api/token`,
    registration_endpoint: `${SERVER_HOST}/api/register`,
    revocation_endpoint: `${SERVER_HOST}/api/revoke`,
    response_types_supported: SUPPORTED_RESPONSE_TYPES,
    response_modes_supported: ["query"],
    grant_types_supported: SUPPORTED_GRANT_TYPES,
    token_endpoint_auth_methods_supported: SUPPORTED_AUTH_METHODS,
    registration_endpoint_auth_methods_supported: SUPPORTED_AUTH_METHODS,
    revocation_endpoint_auth_methods_supported: SUPPORTED_AUTH_METHODS,
    code_challenge_methods_supported: SUPPORTED_CODE_CHALLENGE_METHODS,
    scopes_supported: SUPPORTED_SCOPES,
  });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}
