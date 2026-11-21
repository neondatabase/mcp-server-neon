import type { Effect } from 'effect';
import type { AuthorizationCode, Client } from 'oauth2-server';
import type { ApprovedAuthTransaction } from '../../../mcp/oauth/auth-transaction';
import { generateRandomString } from '../../../mcp/oauth/utils';
import { SERVER_HOST } from '../../config';
import type { resolveAccount } from './callback-account';

const AUTHORIZATION_CODE_TTL_MS = 10 * 60 * 1000;

export type UpstreamTokens = {
  readonly access_token: string;
  readonly refresh_token?: string;
  readonly id_token?: string;
  readonly scope?: string;
  readonly expiresIn: () => number | undefined;
};

type Account = Effect.Success<ReturnType<typeof resolveAccount>>;

export const authorizationCode = (input: {
  readonly now: number;
  readonly client: Client;
  readonly approved: ApprovedAuthTransaction;
  readonly account: Account;
  readonly tokens: UpstreamTokens & { readonly refresh_token: string };
}): AuthorizationCode => {
  const { now, client, approved, account, tokens } = input;
  const { request } = approved;

  return {
    authorizationCode: `${generateRandomString(16)}:${generateRandomString(32)}`,
    expiresAt: new Date(now + AUTHORIZATION_CODE_TTL_MS),
    createdAt: now,
    redirectUri: request.redirectUri,
    scope: approved.approvedScopes.join(' '),
    client,
    user: account,
    token: {
      access_token: tokens.access_token,
      access_token_expires_at: now + (tokens.expiresIn() ?? 3600) * 1000,
      refresh_token: tokens.refresh_token,
      id_token: tokens.id_token,
    },
    code_challenge: request.codeChallenge,
    code_challenge_method: request.codeChallengeMethod,
    grant: approved.approvedGrant,
  };
};

export const clientRedirect = (input: {
  readonly redirectUri: string;
  readonly state: string;
  readonly code: string;
}) => {
  const redirect = new URL(input.redirectUri);

  redirect.searchParams.set('code', input.code);

  if (input.state !== '') {
    redirect.searchParams.set('state', input.state);
  }

  redirect.searchParams.set('iss', SERVER_HOST);

  return redirect.href;
};
