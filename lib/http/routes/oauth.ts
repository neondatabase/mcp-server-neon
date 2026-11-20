import { Layer } from 'effect';
import { OAuthStore } from '../../../mcp/oauth/oauth-store';
import { RegisterRoutes } from './register';
import { RevokeRoutes } from './revoke';

/** The OAuth authorization server's endpoints, with the store they share. */
export const OAuthRoutes = Layer.mergeAll(
  RegisterRoutes,
  RevokeRoutes,
  OAuthStore.layer,
);
