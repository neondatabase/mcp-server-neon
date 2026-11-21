import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http';
import { ServerConfig } from '../../config';
import { landingMarkdownResponse } from '../../landing';
import { CLIENT_ASSERTION_SIGNING_ALGORITHMS } from '../../oauth/client-assertion';
import {
  deriveResourceIdentifierFromMetadataRequest,
  getHostLevelResourceIdentifierFromRequest,
  parseResourceIdentifier,
} from '../../oauth/protected-resource-metadata';
import {
  AI_CATALOG_MEDIA_TYPE,
  buildAiCatalog,
  buildServerCard,
  discoveryPreflight,
  discoveryResponse,
  SERVER_CARD_MEDIA_TYPE,
} from '../../server-metadata';
import { SCOPE_CATEGORIES } from '../../../mcp/utils/grant-context';
import { SUPPORTED_SCOPES } from '../../../mcp/utils/read-only';

const SUPPORTED_AUTH_METHODS = [
  'client_secret_post',
  'client_secret_basic',
  'none',
];

const CLIENT_AUTH_METHODS = [...SUPPORTED_AUTH_METHODS, 'private_key_jwt'];

const OAUTH_METADATA_PREFLIGHT_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const oauthMetadataPreflight = Effect.succeed(
  HttpServerResponse.empty({
    status: 204,
    headers: OAUTH_METADATA_PREFLIGHT_HEADERS,
  }),
);

const authorizationServerMetadata = Effect.gen(function* () {
  const { serverHost } = yield* ServerConfig;

  return HttpServerResponse.jsonUnsafe({
    issuer: serverHost,
    authorization_endpoint: `${serverHost}/api/authorize`,
    token_endpoint: `${serverHost}/api/token`,
    registration_endpoint: `${serverHost}/api/register`,
    client_id_metadata_document_supported: true,
    revocation_endpoint: `${serverHost}/api/revoke`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: CLIENT_AUTH_METHODS,
    token_endpoint_auth_signing_alg_values_supported:
      CLIENT_ASSERTION_SIGNING_ALGORITHMS,
    registration_endpoint_auth_methods_supported: SUPPORTED_AUTH_METHODS,
    revocation_endpoint_auth_methods_supported: CLIENT_AUTH_METHODS,
    revocation_endpoint_auth_signing_alg_values_supported:
      CLIENT_ASSERTION_SIGNING_ALGORITHMS,
    code_challenge_methods_supported: ['S256'],
    authorization_response_iss_parameter_supported: true,
    scopes_supported: SUPPORTED_SCOPES,
    'x-neon-scope-categories': SCOPE_CATEGORIES,
  });
}).pipe(Effect.withSpan('Discovery.authorizationServerMetadata'));

const PROTECTED_RESOURCE_METADATA_BASE =
  '/.well-known/oauth-protected-resource';

// The router registers the base path with its `/*` wildcard, so one handler
// serves both: the host-level document, and documents for a resource path.
const protectedResourceMetadata = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const webRequest = yield* HttpServerRequest.toWeb(request);
  const { pathname } = new URL(webRequest.url);

  const resource =
    pathname === PROTECTED_RESOURCE_METADATA_BASE
      ? getHostLevelResourceIdentifierFromRequest(webRequest)
      : deriveResourceIdentifierFromMetadataRequest(webRequest);

  return HttpServerResponse.jsonUnsafe({
    resource,
    authorization_servers: [parseResourceIdentifier(resource).origin],
    bearer_methods_supported: ['header'],
    resource_documentation: 'https://neon.com/docs/ai/neon-mcp-server',
  });
}).pipe(Effect.withSpan('Discovery.protectedResourceMetadata'));

const landingMarkdown = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const webRequest = yield* HttpServerRequest.toWeb(request);

  return HttpServerResponse.fromWeb(landingMarkdownResponse(webRequest));
}).pipe(Effect.withSpan('Discovery.landingMarkdown'));

const discoveryDocument = (build: () => object, contentType: string) =>
  Effect.sync(() => discoveryResponse(build(), contentType));

export const DiscoveryRoutes = Layer.mergeAll(
  HttpRouter.add(
    'GET',
    '/.well-known/oauth-authorization-server',
    authorizationServerMetadata,
  ),
  HttpRouter.add(
    'OPTIONS',
    '/.well-known/oauth-authorization-server',
    oauthMetadataPreflight,
  ),
  HttpRouter.add(
    'GET',
    `${PROTECTED_RESOURCE_METADATA_BASE}/*`,
    protectedResourceMetadata,
  ),
  HttpRouter.add(
    'OPTIONS',
    `${PROTECTED_RESOURCE_METADATA_BASE}/*`,
    oauthMetadataPreflight,
  ),
  HttpRouter.add(
    'GET',
    '/mcp/server-card',
    discoveryDocument(buildServerCard, SERVER_CARD_MEDIA_TYPE).pipe(
      Effect.withSpan('Discovery.serverCard'),
    ),
  ),
  // SEP-1649 first placed the Server Card here, and directory scanners still
  // probe this path before /mcp/server-card.
  HttpRouter.add(
    'GET',
    '/.well-known/mcp.json',
    discoveryDocument(buildServerCard, 'application/json').pipe(
      Effect.withSpan('Discovery.serverCard'),
    ),
  ),
  HttpRouter.add(
    'GET',
    '/.well-known/ai-catalog.json',
    discoveryDocument(buildAiCatalog, AI_CATALOG_MEDIA_TYPE).pipe(
      Effect.withSpan('Discovery.aiCatalog'),
    ),
  ),
  // The landing page as Markdown, whatever the `Accept`. The route file exports
  // only GET and HEAD, and the router has no HEAD method.
  HttpRouter.add('*', '/mcp.md', landingMarkdown),
  HttpRouter.add('OPTIONS', '/mcp/server-card', discoveryPreflight),
  HttpRouter.add('OPTIONS', '/.well-known/mcp.json', discoveryPreflight),
  HttpRouter.add('OPTIONS', '/.well-known/ai-catalog.json', discoveryPreflight),
);
