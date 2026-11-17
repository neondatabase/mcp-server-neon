import type { AuthInfo } from '@modelcontextprotocol/server';
import { Effect, Option, Schema } from 'effect';
import { z } from 'zod';
import { model } from '../oauth/model';
import type { AuthContext } from '../types/auth';
import type { AppContext } from '../types/context';
import { resolveGrantFromToken } from '../utils/grant-context';
import { SECRETS_HEADER, withRequestSecrets } from '../utils/secrets';
import type { GrantContext } from '../utils/grant-context';
import { logger } from '../utils/logger';
import { isReadOnly } from '../utils/read-only';

export type AuthenticatedAuthInfo = AuthInfo & {
  extra?: {
    apiKey?: string;
    authMethod?: AuthContext['extra']['authMethod'];
    account?: AuthContext['extra']['account'];
    readOnly?: boolean;
    grant?: GrantContext;
    client?: AuthContext['extra']['client'];
    transport?: AppContext['transport'];
    userAgent?: string;
  };
};

/** The OAuth token store could not be read. */
class TokenLookupFailed extends Schema.TaggedError<
  TokenLookupFailed,
  { readonly brand: unique symbol }
>()('TokenLookupFailed', { cause: Schema.Unknown }) {}

// The token route stores the grant chosen at consent next to the token.
type OAuthToken = NonNullable<
  Awaited<ReturnType<typeof model.getAccessToken>>
> & { grant?: GrantContext };

// The stored token's account and client fields, as the token route saves them.
const storedTokenFields = z.object({
  expires_at: z.number().nullish(),
  user: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string().nullish(),
    isOrg: z.boolean().nullish(),
  }),
  client: z.object({ client_name: z.string().nullish() }),
});

/** The stored token for a bearer; fails when the store cannot be read. */
export const lookupOAuthToken = (bearerToken: string) =>
  Effect.tryPromise({
    try: async () => model.getAccessToken(bearerToken),
    catch: (cause) => TokenLookupFailed.make({ cause }),
  }).pipe(
    Effect.map(Option.fromNullishOr),
    Effect.tapError(({ cause }) =>
      Effect.sync(() => {
        logger.warn('OAuth token lookup failed, trying API key path', {
          error: cause,
        });
      }),
    ),
  );

const readGrant = (token: OAuthToken): Option.Option<GrantContext> => {
  try {
    return Option.some(resolveGrantFromToken(token));
  } catch (error) {
    // A stored grant we cannot read must not fall through to the API-key
    // path, which would authenticate the same bearer without its grant.
    logger.error('OAuth token grant is invalid', {
      clientId: token.client.id,
      errorName: error instanceof Error ? error.name : 'unknown',
    });

    return Option.none();
  }
};

const toAuthInfo = ({
  token,
  fields: { expires_at: expiresAt, user, client },
  grant,
  bearerToken,
  userAgent,
}: {
  token: OAuthToken;
  fields: z.infer<typeof storedTokenFields>;
  grant: GrantContext;
  bearerToken: string;
  userAgent: string | undefined;
}): AuthenticatedAuthInfo => ({
  token: token.accessToken,
  scopes: Array.isArray(token.scope)
    ? token.scope
    : (token.scope?.split(' ') ?? ['read', 'write']),
  clientId: token.client.id,
  expiresAt:
    expiresAt === undefined || expiresAt === null || expiresAt === 0
      ? undefined
      : Math.floor(expiresAt / 1000),
  extra: {
    authMethod: 'oauth',
    account: {
      id: user.id,
      name: user.name,
      email: user.email ?? undefined,
      isOrg: user.isOrg ?? false,
    },
    apiKey: bearerToken,
    readOnly: isReadOnly({ scope: token.scope }),
    grant,
    client: { id: token.client.id, name: client.client_name ?? undefined },
    transport: 'stream',
    userAgent,
  },
});

/**
 * The caller a stored OAuth token authenticates, with the grant chosen at
 * consent. The request's secrets param and header may tighten that grant.
 */
export const oauthAuthInfo = (
  token: OAuthToken,
  bearerToken: string,
  req: Request,
): Option.Option<AuthenticatedAuthInfo> => {
  const grant = readGrant(token);

  if (Option.isNone(grant)) {
    return Option.none();
  }

  const fields = storedTokenFields.safeParse(token);

  if (!fields.success) {
    logger.error('OAuth token fields are invalid', {
      clientId: token.client.id,
      issues: fields.error.issues.map(({ path }) => path.join('.')),
    });

    return Option.none();
  }

  return Option.some(
    toAuthInfo({
      token,
      fields: fields.data,
      grant: withRequestSecrets(
        grant.value,
        new URL(req.url).searchParams,
        req.headers.get(SECRETS_HEADER),
      ),
      bearerToken,
      userAgent: req.headers.get('user-agent') ?? undefined,
    }),
  );
};
