import { Effect, Option } from 'effect';
import { AuthTransactions } from '../../../mcp/oauth/auth-transactions';
import {
  clientNameForPage,
  presentToBrowser,
} from '../../../mcp/oauth/auth-complete-response';
import { FlowAnswer } from '../../../mcp/oauth/flow-answer';
import { SERVER_HOST } from '../../config';
import { oauthBrowserRequest } from '../oauth-request';
import { restartResponse } from './authorize-consent';

const cancelRedirect = (redirectUri: string, state: string) => {
  const url = new URL(redirectUri);

  url.searchParams.set('error', 'access_denied');

  if (state !== '') {
    url.searchParams.set('state', state);
  }

  url.searchParams.set('iss', SERVER_HOST);

  return url.href;
};

/** The user cancelled: end the transaction and tell the client. */
export const cancel = Effect.fnUntraced(function* (binding: {
  readonly id: string;
  readonly browserSecret: string;
}) {
  const transactions = yield* AuthTransactions;
  const consumed = yield* transactions.consumePending(binding);

  if (Option.isNone(consumed)) {
    return restartResponse();
  }

  const { clientId, redirectUri, state } = consumed.value.request;
  const browser = yield* oauthBrowserRequest;
  const clientName = yield* clientNameForPage({ clientId, redirectUri });

  // A desktop app gets the same "Connection cancelled" page as a cancel
  // relayed through /callback, instead of the consent form staying up.
  return yield* presentToBrowser({
    answer: FlowAnswer.Redirect({
      location: cancelRedirect(redirectUri, state),
      status: 303,
      clears: Option.some({ id: binding.id, secure: browser.secure }),
      context: Option.some({
        clientId,
        clientName,
        relayedError: 'access_denied',
      }),
    }),
    accept: browser.accept,
    query: browser.url.searchParams,
  });
});
