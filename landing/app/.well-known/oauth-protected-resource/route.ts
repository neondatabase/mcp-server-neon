import { NextResponse } from 'next/server';

const SERVER_HOST = process.env.SERVER_HOST ?? 'https://mcp.neon.tech';
const UPSTREAM_OAUTH_HOST =
  process.env.UPSTREAM_OAUTH_HOST ?? 'https://oauth2.neon.tech';

export async function GET() {
  return NextResponse.json({
    resource: SERVER_HOST,
    authorization_servers: [UPSTREAM_OAUTH_HOST],
    bearer_methods_supported: ['header'],
    resource_documentation: 'https://neon.tech/docs/mcp',
  });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
