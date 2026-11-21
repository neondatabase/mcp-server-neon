import { Data, Match, Option } from 'effect';
import { HttpServerResponse } from 'effect/http';
import {
  consentCookieClearOptions,
  consentCookieName,
} from './browser-binding';

/** What the flow knows about the request a completion page is for. */
export type CompletionContext = {
  readonly userId?: string;
  readonly clientId?: string;
  readonly clientName?: string;
  /**
   * The OAuth error relayed to the client. Never read it back from the
   * redirect: the client chose its redirect_uri, query string included.
   */
  readonly relayedError?: string;
  /** Failed before the one-time transaction was used up, so a reload can retry. */
  readonly retryable?: boolean;
};

/** The consent cookie pair a finished transaction clears. */
type ClearedTransaction = { readonly id: string; readonly secure: boolean };

/**
 * How an authorization flow step answers, before the browser presentation
 * decides whether a completion page replaces it.
 */
export type FlowAnswer = Data.TaggedEnum<{
  Redirect: {
    readonly location: string;
    readonly status: number;
    readonly clears: Option.Option<ClearedTransaction>;
    readonly context: Option.Option<CompletionContext>;
  };
  OAuthError: {
    readonly status: number;
    readonly error: string;
    readonly description: string | undefined;
    readonly headers: Readonly<Record<string, string>>;
    readonly context: Option.Option<CompletionContext>;
  };
}>;

export const FlowAnswer = Data.taggedEnum<FlowAnswer>();

const clearCookies = (
  response: HttpServerResponse.HttpServerResponse,
  { id, secure }: ClearedTransaction,
) =>
  (secure ? [true, false] : [false]).reduce(
    (cleared, hostPrefixed) =>
      HttpServerResponse.setCookieUnsafe(
        cleared,
        consentCookieName(id, hostPrefixed),
        '',
        consentCookieClearOptions(secure),
      ),
    response,
  );

/** Clears the transaction cookies a redirect answer ends, on any response. */
export const withClearedTransaction = (
  answer: FlowAnswer,
  response: HttpServerResponse.HttpServerResponse,
) =>
  Match.value(answer).pipe(
    Match.tag('Redirect', ({ clears }) =>
      Option.match(clears, {
        onNone: () => response,
        onSome: (transaction) => clearCookies(response, transaction),
      }),
    ),
    Match.tag('OAuthError', () => response),
    Match.exhaustive,
  );

/** The `Retry-After` an error answer carries. */
export const answerRetryAfter = Match.type<FlowAnswer>().pipe(
  Match.tag('Redirect', () => undefined),
  Match.tag('OAuthError', ({ headers }) => headers['Retry-After']),
  Match.exhaustive,
);

/** The answer as it goes to a client that is not a browser. */
export const renderFlowAnswer = (answer: FlowAnswer) =>
  withClearedTransaction(
    answer,
    Match.value(answer).pipe(
      Match.tag('Redirect', ({ location, status }) =>
        HttpServerResponse.redirect(location, { status }),
      ),
      Match.tag('OAuthError', ({ status, error, description, headers }) =>
        HttpServerResponse.jsonUnsafe(
          { error, error_description: description },
          { status, headers },
        ),
      ),
      Match.exhaustive,
    ),
  );
