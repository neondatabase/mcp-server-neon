/** How the Neon API answers for one bearer token. */
type Caller = {
  readonly authMethod: 'oauth' | 'api_key_user' | 'api_key_org';
  readonly accountId: string;
  /** `fails` answers `GET /users/me` with a 500. */
  readonly user?: 'answers' | 'fails';
};

type NeonRequest = { readonly bearer: string; readonly path: string };

const bearerOf = (request: Request) =>
  request.headers.get('authorization')?.replace(/^Bearer /u, '') ?? '';

/**
 * The Neon API calls the transport makes to verify a bearer: auth details,
 * the user, and the organization of an org key. `callers` says how each
 * bearer answers; an unknown one gets a 401. `requests` records every call.
 */
export const neonAuthStandIn = () => {
  const callers = new Map<string, Caller>();
  const requests: NeonRequest[] = [];

  const answer = (request: Request) => {
    const bearer = bearerOf(request);
    const path = new URL(request.url).pathname.replace(/^\/api\/v2/u, '');
    const caller = callers.get(bearer);

    requests.push({ bearer, path });

    if (caller === undefined) {
      return Response.json(
        { message: 'authentication failed' },
        { status: 401 },
      );
    }

    if (path === '/auth') {
      return Response.json({
        auth_method: caller.authMethod,
        account_id: caller.accountId,
      });
    }

    if (path === '/users/me' && caller.user !== 'fails') {
      return Response.json({
        id: caller.accountId,
        name: 'User',
        last_name: '',
        email: 'u@x.dev',
      });
    }

    return path.startsWith('/organizations/')
      ? Response.json({ id: caller.accountId, name: 'Org' })
      : Response.json({ message: 'Neon API 500' }, { status: 500 });
  };

  return {
    callers,
    answer,
    /** The paths requested with `bearer`. */
    requestedWith: (bearer: string) =>
      requests.flatMap((request) =>
        request.bearer === bearer ? [request.path] : [],
      ),
  };
};
