import { Layer } from 'effect';
import { Analytics } from '../../mcp/analytics/analytics-service';
import { AuthTransactions } from '../../mcp/oauth/auth-transactions';
import { OAuthStore } from '../../mcp/oauth/oauth-store';
import { NeonAccounts } from '../../mcp/server/neon-accounts';
import { ServerConfig } from '../config';
import { UpstreamOAuth } from '../oauth/upstream-oauth';

/** The services the OAuth authorization server's endpoints share. */
export const OAuthServices = Layer.mergeAll(
  OAuthStore.layer,
  Analytics.layer,
  AuthTransactions.layer,
  UpstreamOAuth.layer.pipe(Layer.provide(ServerConfig.layer)),
  NeonAccounts.layer,
);
