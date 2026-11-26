import { Layer } from 'effect';
import { AppLayer } from '../../../lib/http/app';
import { OAuthRoutes } from '../../../lib/http/routes/oauth';
import { ensureTestOauthDatabase } from '../ensure-test-oauth-database';

// The routes' store reads OAUTH_DATABASE_URL, which this sets to the test database.
await ensureTestOauthDatabase();

/**
 * The OAuth server's routes on the real services: the OAuth Postgres store,
 * the refresh lock, upstream OAuth, analytics. A test merges a layer after
 * this one to replace any of those services, then builds its own handler with
 * `HttpRouter.toWebHandler`.
 */
export const OAuthTestApp = Layer.mergeAll(OAuthRoutes, AppLayer);
