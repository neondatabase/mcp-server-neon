import { ensureOauthDatabaseUrl } from '../../e2e/provision-oauth-db';
import { ensureAuthTransactionSchema } from '../oauth/auth-transaction-store';

let ready: Promise<string> | undefined;

export async function ensureTestOauthDatabase(): Promise<string> {
  ready ??= ensureOauthDatabaseUrl().then(async (url) => {
    process.env.OAUTH_DATABASE_URL = url;
    await ensureAuthTransactionSchema(url);
    return url;
  });
  return ready;
}
