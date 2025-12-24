import { NextResponse } from 'next/server';
import { SERVER_HOST } from '@/lib/config';

export async function GET() {
  return NextResponse.json({
    resource: SERVER_HOST,
    authorization_servers: [SERVER_HOST],
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
