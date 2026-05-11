import { AsyncLocalStorage } from 'node:async_hooks';
import {
  discovery,
  buildAuthorizationUrl,
  authorizationCodeGrant,
  ClientSecretPost,
  refreshTokenGrant,
  customFetch,
  type Configuration,
} from 'openid-client';
import {
  CLIENT_ID,
  CLIENT_SECRET,
  SERVER_HOST,
  UPSTREAM_OAUTH_HOST,
} from '../config';

// Carries a per-call AbortSignal into the upstream fetch so callers can
// cancel an in-flight `refreshTokenGrant` (Promise.race alone only unblocks
// the await — the underlying socket stays open until the OS-level timeout).
// The customFetch wrapper installed on the cached Configuration reads from
// this ALS so we don't have to leak the signal as an explicit parameter
// through openid-client's API surface.
const upstreamAbortSignalContext = new AsyncLocalStorage<AbortSignal>();

function combineSignals(
  fromContext: AbortSignal | undefined,
  fromInit: AbortSignal | null | undefined,
): AbortSignal | undefined {
  if (!fromContext) return fromInit ?? undefined;
  if (!fromInit) return fromContext;
  // Both present — abort if either fires. AbortSignal.any is Node 20+ (we run
  // on Node 24 LTS on Vercel) but defend against missing implementation by
  // falling back to the context signal, which is the one we care about.
  const any = (
    AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }
  ).any;
  return any ? any([fromContext, fromInit]) : fromContext;
}

const REDIRECT_URI = `${SERVER_HOST}/callback`;

const NEON_MCP_SCOPES = [
  'openid',
  'offline',
  'offline_access',
  'urn:neoncloud:projects:create',
  'urn:neoncloud:projects:read',
  'urn:neoncloud:projects:update',
  'urn:neoncloud:projects:delete',
  'urn:neoncloud:orgs:create',
  'urn:neoncloud:orgs:read',
  'urn:neoncloud:orgs:update',
  'urn:neoncloud:orgs:delete',
  'urn:neoncloud:orgs:permission',
] as const;

// Cache OAuth discovery config for function instance lifetime
// This avoids repeated network calls during the lifetime of a serverless instance
let cachedConfig: Configuration | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const getUpstreamConfig = async (): Promise<Configuration> => {
  const now = Date.now();

  // Return cached config if still valid
  if (cachedConfig && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedConfig;
  }

  const url = new URL(UPSTREAM_OAUTH_HOST);
  cachedConfig = await discovery(
    url,
    CLIENT_ID,
    {
      client_secret: CLIENT_SECRET,
    },
    ClientSecretPost(CLIENT_SECRET),
    {},
  );
  // Inject a per-call AbortSignal through openid-client's customFetch hook.
  // The signal is read from ALS so callers (e.g. the timeout wrapper in
  // /api/token) can actually cancel the in-flight fetch instead of just
  // unblocking their await. The cached config is shared across requests, so
  // ALS is the right scoping primitive.
  //
  // Critical: when no ALS signal is set (the vast majority of upstream
  // calls — discovery, authorizationCodeGrant in /callback, refresh paths
  // that don't pass a signal), this MUST be a pure pass-through. Earlier
  // code spread `init` into a new object unconditionally, which broke the
  // OAuth code-exchange path (Hydra responses came back as
  // OAUTH_RESPONSE_IS_NOT_CONFORM / invalid_grant) for a subset of Vercel
  // function instances whose cached Configuration carried that wrapper for
  // the full 1-hour cache TTL. Pure pass-through means the only requests
  // that traverse our wrapper logic are the ones that genuinely need it.
  (cachedConfig as unknown as Record<symbol, typeof globalThis.fetch>)[
    customFetch
  ] = (input, init) => {
    const ctxSignal = upstreamAbortSignalContext.getStore();
    if (!ctxSignal) {
      // No per-call signal to inject — defer to native fetch with the
      // original args untouched. Preserves Request-object inputs, headers,
      // body, signal, etc. exactly as openid-client constructed them.
      return globalThis.fetch(input, init);
    }
    return globalThis.fetch(input, {
      ...(init ?? {}),
      signal: combineSignals(ctxSignal, init?.signal),
    });
  };
  cacheTimestamp = now;

  return cachedConfig;
};

export const upstreamAuth = async (state: string) => {
  const config = await getUpstreamConfig();
  return buildAuthorizationUrl(config, {
    redirect_uri: REDIRECT_URI,
    token_endpoint_auth_method: 'client_secret_post',
    scope: NEON_MCP_SCOPES.join(' '),
    response_type: 'code',
    state,
  });
};

export const exchangeCode = async (currentUrl: URL, state: string) => {
  const config = await getUpstreamConfig();
  return await authorizationCodeGrant(config, currentUrl, {
    expectedState: state,
    idTokenExpected: true,
  });
};

export const exchangeRefreshToken = async (
  token: string,
  signal?: AbortSignal,
) => {
  const config = await getUpstreamConfig();
  if (!signal) return refreshTokenGrant(config, token);
  // Run the grant inside the ALS-scoped signal so the customFetch hook
  // attaches it to the underlying fetch. Cancellation now actually closes
  // the socket — Promise.race alone only resolved the await wrapper.
  return upstreamAbortSignalContext.run(signal, () =>
    refreshTokenGrant(config, token),
  );
};
