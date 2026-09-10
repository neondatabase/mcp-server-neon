import { ensureOauthDatabaseUrl } from '../../e2e/provision-oauth-db';

let ready: Promise<string> | undefined;

export async function ensureTestOauthDatabase(): Promise<string> {
  ready ??= ensureOauthDatabaseUrl().then((url) => {
    process.env.OAUTH_DATABASE_URL = url;
    return url;
  });
  return ready;
}
