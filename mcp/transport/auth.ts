import {
  bearerAuthChallengeResponse,
  OAuthError,
  OAuthErrorCode,
} from '@modelcontextprotocol/server';
import { Clock, Effect, Option, Result, Schema } from 'effect';
import { resolveGrantFromSearchParams } from '../utils/grant-context';
import { logger } from '../utils/logger';
import { isReadOnly } from '../utils/read-only';
import { fetchAccountDetails } from './api-key';
import { lookupOAuthToken, oauthAuthInfo } from './oauth-token';
import type { AuthenticatedAuthInfo } from './oauth-token';
import type { ApiKeyRecord } from '../oauth/kv-store';
import { TokenStoreUnavailable } from './token-store-unavailable';

export { tokenStoreUnavailableResponse } from './token-store-unavailable';

/** The bearer is missing, unknown, or expired; the client must authenticate. */
class McpAuthRejected extends Schema.TaggedError<
  McpAuthRejected,
  { readonly brand: unique symbol }
>()('McpAuthRejected', {
  description: Schema.String,
  /** Verification broke rather than the bearer being wrong; the span fails. */
  serverFault: Schema.Boolean,
  cause: Schema.optional(Schema.Unknown),
}) {}

/** The 401 an MCP client reads to start OAuth discovery. */
export const authChallengeResponse = (
  { description }: McpAuthRejected,
  resourceMetadataUrl: string,
): Response =>
  bearerAuthChallengeResponse(
    new OAuthError(OAuthErrorCode.InvalidToken, description),
    { resourceMetadataUrl },
  );

// The grant and read-only mode come from the connection URL and headers.
const apiKeyAuthInfo = (
  req: Request,
  bearerToken: string,
  { authMethod, account }: ApiKeyRecord,
): AuthenticatedAuthInfo => {
  const { searchParams } = new URL(req.url);

  return {
    token: bearerToken,
    scopes: ['*'], // API keys get all scopes
    clientId: 'api-key', // Literal string
    extra: {
      authMethod,
      account,
      apiKey: bearerToken,
      readOnly: isReadOnly({
        queryParamValue: searchParams.get('readonly'),
        headerValue: req.headers.get('x-read-only'),
      }),
      grant: resolveGrantFromSearchParams(searchParams),
      transport: 'stream',
      userAgent: req.headers.get('user-agent') ?? undefined,
    },
  };
};

const rejected = (description: string) =>
  Effect.fail(McpAuthRejected.make({ description, serverFault: false }));

// The client still gets the 401 it always did, but the failure is the server's.
const brokeVerifying = (description: string, cause: unknown) =>
  Effect.fail(McpAuthRejected.make({ description, serverFault: true, cause }));

/** Token verification with two paths: stored OAuth tokens, then API keys. */
const verifyToken = Effect.fn('McpAuth.verifyToken')(function* (
  req: Request,
  bearerToken: string,
) {
  const userAgent = req.headers.get('user-agent') ?? undefined;
  const lookup = yield* Effect.result(lookupOAuthToken(bearerToken));

  if (Result.isSuccess(lookup) && Option.isSome(lookup.success)) {
    logger.info('OAuth token found', {
      clientId: lookup.success.value.client.id,
    });

    return oauthAuthInfo(lookup.success.value, bearerToken, userAgent);
  }

  logger.info('Trying API key verification path');

  const apiKeyRecord = yield* fetchAccountDetails(bearerToken).pipe(
    Effect.catchTag('ApiKeyVerificationUnavailable', ({ cause }) =>
      brokeVerifying('No authorization provided', cause),
    ),
  );

  if (apiKeyRecord === null) {
    return Option.none();
  }

  // Our access tokens are Neon OAuth tokens, so they also pass the API-key
  // check. Their grant and scope live only in the token store; building them
  // from the URL here would drop what the user chose at consent.
  if (apiKeyRecord === 'oauth') {
    const tokenLookupFailed = Result.isFailure(lookup);

    logger.warn('OAuth bearer reached the API key path; refusing URL grant', {
      tokenLookupFailed,
    });

    return tokenLookupFailed
      ? yield* TokenStoreUnavailable.make({})
      : Option.none();
  }

  return Option.some(apiKeyAuthInfo(req, bearerToken, apiKeyRecord));
});

const bearerTokenOf = (req: Request): string | undefined => {
  const [type, token] = req.headers.get('Authorization')?.split(' ') ?? [];

  return type?.toLowerCase() === 'bearer' ? token : undefined;
};

const authentication = Effect.fnUntraced(function* (req: Request) {
  const bearerToken = bearerTokenOf(req);

  logger.info('verifyToken called', {
    hasBearerToken: bearerToken !== undefined && bearerToken !== '',
    bearerTokenLength: bearerToken?.length ?? 0,
    userAgent: req.headers.get('user-agent') ?? undefined,
  });

  if (bearerToken === undefined || bearerToken === '') {
    return yield* rejected('No authorization provided');
  }

  const authInfo = yield* verifyToken(req, bearerToken).pipe(
    Effect.catchDefect((defect) => {
      logger.error('Unexpected error authenticating bearer token', {
        error: defect,
      });

      return brokeVerifying('Invalid token', defect);
    }),
  );

  if (Option.isNone(authInfo)) {
    return yield* rejected('No authorization provided');
  }

  const { expiresAt } = authInfo.value;
  const now = yield* Clock.currentTimeMillis;

  if (expiresAt !== undefined && expiresAt < now / 1000) {
    return yield* rejected('Token has expired');
  }

  return authInfo.value;
});

const isCallerRejection = (error: unknown): error is McpAuthRejected =>
  error instanceof McpAuthRejected && !error.serverFault;

/**
 * The authenticated caller of an MCP request. Fails with `McpAuthRejected`
 * where the client must authenticate again, and `TokenStoreUnavailable` where
 * it should retry. A missing, unknown, or expired bearer keeps the span ok.
 */
export const authenticate = (req: Request) =>
  authentication(req).pipe(
    Effect.map(Result.succeed),
    Effect.catchIf(isCallerRejection, (rejection) =>
      Effect.annotateCurrentSpan({
        'error.type': rejection._tag,
        'mcp.auth.rejection': rejection.description,
      }).pipe(Effect.as(Result.fail(rejection))),
    ),
    Effect.withSpan('McpAuth.authenticate'),
    Effect.flatMap(Effect.fromResult),
  );
