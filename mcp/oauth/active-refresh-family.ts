import { Effect } from 'effect';
import { OAuthStoreUnavailable } from './oauth-store-unavailable';
import type { RefreshFailed } from './refresh-failed';
import type { RefreshTokenResult } from './refresh-token-result';
import { retireLatePair } from './grant-retirement';
import type { Client, Token } from 'oauth2-server';
import {
  GrantRevokedError,
  storedGrantFamily,
  traceGrant,
} from './grant-family';
import { model } from './model';
import { stored } from './stored';

/** Resolve the owner's current grant before exchanging its refresh token. */
export const activeRefreshFamily = (
  oldToken: Token,
  clientId: string,
  refreshToken: string,
) =>
  stored('activeRefreshFamily', async () => {
    const active =
      storedGrantFamily(oldToken) === undefined
        ? await model.getAccessToken(oldToken.accessToken)
        : oldToken;

    if (active === undefined) {
      throw new GrantRevokedError();
    }

    const lineage = await traceGrant(
      { clientId, token: active, refreshToken },
      model,
    );

    await model.assertGrantActive(lineage.familyId);

    return lineage.familyId;
  });

export const compensateLatePair = (
  failure: OAuthStoreUnavailable | RefreshFailed,
  rotation: { readonly familyId: string; readonly client: Client },
  pair: { readonly accessToken: string; readonly refreshToken: string },
) =>
  failure instanceof OAuthStoreUnavailable &&
  failure.cause instanceof GrantRevokedError
    ? stored('retireLatePair', async () =>
        retireLatePair(rotation.familyId, rotation.client.id, {
          accessToken: pair.accessToken,
          refreshToken: pair.refreshToken,
        }),
      )
    : Effect.void;

export const activeRefreshResponse = (
  result: RefreshTokenResult,
  clientId: string,
) =>
  stored('checkRefreshResponse', async () => {
    const { grantFamilyId, ...body } = result;

    if (grantFamilyId === undefined) {
      throw new GrantRevokedError();
    }

    if (await model.isGrantRevoked(grantFamilyId)) {
      await retireLatePair(grantFamilyId, clientId, {
        accessToken: body.access_token,
        refreshToken: body.refresh_token,
      });

      throw new GrantRevokedError();
    }

    return body;
  });
