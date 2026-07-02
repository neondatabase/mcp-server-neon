import { NextResponse } from 'next/server';
import {
  getHostLevelResourceIdentifierFromRequest,
  parseResourceIdentifier,
} from '@/lib/oauth/protected-resource-metadata';

export async function GET(request: Request) {
  const resource = getHostLevelResourceIdentifierFromRequest(request);
  const parsedResource = parseResourceIdentifier(resource);

  return NextResponse.json({
    resource,
    authorization_servers: [parsedResource.origin],
    bearer_methods_supported: ['header'],
    resource_documentation: 'https://neon.com/docs/ai/neon-mcp-server',
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
