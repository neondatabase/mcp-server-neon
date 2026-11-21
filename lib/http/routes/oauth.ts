import { Layer } from 'effect';
import { Analytics } from '../../../mcp/analytics/analytics-service';
import { OAuthStore } from '../../../mcp/oauth/oauth-store';
import { AuthCompleteEventsRoutes } from './auth-complete-events';
import { RegisterRoutes } from './register';
import { RevokeRoutes } from './revoke';

/** The OAuth authorization server's endpoints, with the services they share. */
export const OAuthRoutes = Layer.mergeAll(
  RegisterRoutes,
  RevokeRoutes,
  AuthCompleteEventsRoutes,
  OAuthStore.layer,
  Analytics.layer,
);
