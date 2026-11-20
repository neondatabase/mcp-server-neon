import { Layer } from 'effect';
import { OAuthServices } from '../oauth-services';
import { AuthCompleteEventsRoutes } from './auth-complete-events';
import { AuthorizeRoutes } from './authorize';
import { CallbackRoutes } from './callback';
import { RegisterRoutes } from './register';
import { RevokeRoutes } from './revoke';

/** The OAuth authorization server's endpoints, with the services they share. */
export const OAuthRoutes = Layer.mergeAll(
  RegisterRoutes,
  RevokeRoutes,
  AuthCompleteEventsRoutes,
  CallbackRoutes,
  AuthorizeRoutes,
  OAuthServices,
);
