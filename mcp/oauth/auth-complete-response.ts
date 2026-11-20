import { Effect, Match, Option, Predicate } from 'effect';
import { HttpServerResponse } from 'effect/http';
import { isClientIdMetadataUrl } from '../../lib/oauth/client-id-metadata-document';
import { Analytics } from '../analytics/analytics-service';
import { identifyClient } from '../utils/client-application';
import {
  nativeAppRedirect,
  renderAuthCompletePage,
} from './auth-complete-page';
import type {
  AuthCompleteOutcome,
  AuthCompletePageProps,
} from './auth-complete-page';
import {
  answerRetryAfter,
  renderFlowAnswer,
  withClearedTransaction,
} from './flow-answer';
import type { CompletionContext, FlowAnswer } from './flow-answer';
import { OAuthStore } from './oauth-store';

const SERVER_FAILURE_MESSAGE =
  'Neon could not finish authorization right now. Start again from your app.';

const RETRY_MESSAGE =
  'Neon could not finish authorization right now. Reload this page in a moment to try again.';

// Relayed OAuth errors that mean the server failed, not the request.
const TEMPORARY_ERRORS = new Set(['server_error', 'temporarily_unavailable']);

const failureOutcome = (error: string | undefined): AuthCompleteOutcome =>
  error === 'access_denied' ? 'cancelled' : 'failed';

type CompletionPageProps = Omit<AuthCompletePageProps, 'nonce' | 'pageViewId'>;

// anonymousId is the page view so the browser's action events, which only
// know the page view, join to this user without the page holding identity.
const trackView = Effect.fnUntraced(function* (input: {
  readonly props: CompletionPageProps;
  readonly context: CompletionContext;
}) {
  const { props, context } = input;
  const pageViewId = crypto.randomUUID();
  const analytics = yield* Analytics;

  const properties = {
    pageViewId,
    outcome: props.outcome,
    opensApp: props.returnUrl !== undefined,
    clientId: context.clientId,
    clientName: context.clientName,
    clientApplication: identifyClient(undefined, context.clientName)
      .clientApplication,
    // A reload of a retryable failure is a new view of the same attempt.
    retryable: props.retryable === true,
  };

  const event = {
    anonymousId: pageViewId,
    event: 'auth_complete_viewed',
    properties,
  };

  yield* analytics.track(
    context.userId === undefined ? event : { userId: context.userId, ...event },
  );

  return { pageViewId };
});

const completionPage = Effect.fnUntraced(function* (input: {
  readonly answer: FlowAnswer;
  readonly status: number;
  readonly props: CompletionPageProps;
}) {
  const { answer, status, props } = input;

  const context = Option.getOrElse(
    answer.context,
    (): CompletionContext => ({}),
  );

  // A page with no authorization in it is not a view worth counting, and
  // without a page view its script sends no action events.
  const pageView =
    props.outcome === 'none' ? {} : yield* trackView({ props, context });

  const { html, headers } = renderAuthCompletePage({ ...props, ...pageView });
  const retryAfter = answerRetryAfter(answer);

  const page = HttpServerResponse.text(html, {
    status,
    headers:
      retryAfter === undefined
        ? headers
        : { ...headers, 'Retry-After': retryAfter },
  });

  return withClearedTransaction(answer, page);
});

/** A native-app redirect the flow tagged gets a page; anything else as is. */
const redirectPage = (answer: FlowAnswer, location: string) => {
  const appRedirect = nativeAppRedirect(location);

  if (appRedirect === undefined || Option.isNone(answer.context)) {
    return Effect.succeed(renderFlowAnswer(answer));
  }

  const error = answer.context.value.relayedError;
  const temporary = error !== undefined && TEMPORARY_ERRORS.has(error);

  return completionPage({
    answer,
    status: 200,
    props: {
      outcome: error === undefined ? 'success' : failureOutcome(error),
      message: temporary ? SERVER_FAILURE_MESSAGE : undefined,
      returnUrl: appRedirect.href,
    },
  });
};

const failureMessage = (input: {
  readonly retryable: boolean;
  readonly status: number;
}) => {
  if (input.retryable) {
    return RETRY_MESSAGE;
  }

  return input.status >= 500 ? SERVER_FAILURE_MESSAGE : undefined;
};

const errorPage = (input: {
  readonly answer: FlowAnswer;
  readonly status: number;
  readonly error: string;
  readonly query: URLSearchParams;
}) => {
  const { answer, status, error, query } = input;

  if (!query.has('code') && !query.has('state') && !query.has('error')) {
    return completionPage({ answer, status, props: { outcome: 'none' } });
  }

  // The JSON keeps its detail for developers. The page only shows fixed text:
  // error_description is often relayed from the query string, where anyone
  // can put words on a Neon-branded page.
  const retryable = Option.match(answer.context, {
    onNone: () => false,
    onSome: (context) => context.retryable === true,
  });

  return completionPage({
    answer,
    status,
    props: {
      outcome: failureOutcome(error),
      message: failureMessage({ retryable, status }),
      retryable,
    },
  });
};

/**
 * In a browser, native-app redirects (cursor://, claude://) and failures get a
 * completion page instead of a bare redirect or JSON body. Web redirects and
 * non-browser callers get the answer as it is.
 */
export const presentToBrowser = Effect.fn('AuthComplete.present')(
  function* (input: {
    readonly answer: FlowAnswer;
    readonly accept: string | undefined;
    readonly query: URLSearchParams;
  }) {
    const { answer, accept, query } = input;

    if (accept?.includes('text/html') !== true) {
      return renderFlowAnswer(answer);
    }

    return yield* Match.value(answer).pipe(
      Match.tag('Redirect', ({ location }) => redirectPage(answer, location)),
      Match.tag('OAuthError', ({ status, error }) =>
        status < 400
          ? Effect.succeed(renderFlowAnswer(answer))
          : errorPage({ answer, status, error, query }),
      ),
      Match.exhaustive,
    );
  },
);

/**
 * The client's registered name for the page's analytics, when an error is
 * relayed to it. Looked up only when the redirect gets a page, and never for a
 * client ID metadata document, which can take seconds to fetch. A failed
 * lookup leaves the name out: it is only an analytics property.
 */
export const clientNameForPage = Effect.fnUntraced(function* (input: {
  readonly clientId: string;
  readonly redirectUri: string;
}) {
  const { clientId, redirectUri } = input;

  if (
    nativeAppRedirect(redirectUri) === undefined ||
    isClientIdMetadataUrl(clientId)
  ) {
    return undefined;
  }

  const store = yield* OAuthStore;

  const client = yield* store.findClient({ clientId }).pipe(
    Effect.catchTags({
      OAuthStoreUnavailable: () => Effect.succeedNone,
      ClientMetadataUnavailable: () => Effect.succeedNone,
    }),
  );

  return Option.match(client, {
    onNone: () => undefined,
    onSome: ({ client_name: name }): string | undefined =>
      Predicate.isString(name) ? name : undefined,
  });
});
