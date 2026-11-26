import { isSpecType } from '@modelcontextprotocol/server';
import type { Implementation } from '@modelcontextprotocol/server';
import { Effect } from 'effect';
import { HttpServerResponse } from 'effect/http';
import pkg from '../package.json';
import registryEntry from '../server.json';
import { assert } from './assert';

export const SERVER_CARD_MEDIA_TYPE = 'application/mcp-server-card+json';
export const AI_CATALOG_MEDIA_TYPE = 'application/ai-catalog+json';

const SERVER_CARD_SCHEMA =
  'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json';

const SERVER_CARD_PATH = '/mcp/server-card';

const serverInfo = {
  name: 'mcp-server-neon',
  title: registryEntry.title,
  version: pkg.version,
  description: registryEntry.description,
  websiteUrl: registryEntry.websiteUrl,
  icons: registryEntry.icons,
};

assert(
  isSpecType.Implementation(serverInfo),
  'server.json title, description, websiteUrl, or icons is not a valid MCP Implementation',
);

export const SERVER_INFO: Implementation = serverInfo;

export function buildServerCard(serverHost: string) {
  const [remote] = registryEntry.remotes;

  return {
    $schema: SERVER_CARD_SCHEMA,
    name: registryEntry.name,
    version: pkg.version,
    title: registryEntry.title,
    description: registryEntry.description,
    websiteUrl: registryEntry.websiteUrl,
    repository: registryEntry.repository,
    icons: registryEntry.icons,
    remotes: [
      {
        type: remote.type,
        url: `${serverHost}/mcp`,
        headers: remote.headers,
      },
    ],
  };
}

export function buildAiCatalog(serverHost: string) {
  return {
    specVersion: '1.0',
    entries: [
      {
        identifier: 'urn:air:neon.com:mcp:mcp',
        type: SERVER_CARD_MEDIA_TYPE,
        url: `${serverHost}${SERVER_CARD_PATH}`,
      },
    ],
  };
}

// Discovery documents are public and read by browser-based clients before
// they connect, so they allow any origin.
const DISCOVERY_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET',
  'Access-Control-Allow-Headers': 'Content-Type, If-None-Match',
};

export function discoveryResponse(body: unknown, contentType: string) {
  return HttpServerResponse.text(JSON.stringify(body), {
    contentType,
    headers: {
      ...DISCOVERY_CORS_HEADERS,
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

export const discoveryPreflight = Effect.succeed(
  HttpServerResponse.empty({ status: 204, headers: DISCOVERY_CORS_HEADERS }),
);
