import { Effect, Option, Predicate } from 'effect';
import { HttpServerRequest } from 'effect/http';
import { AuthTransactions } from '../../../mcp/oauth/auth-transactions';
import { isAuthTransactionId } from '../../../mcp/oauth/browser-binding';
import { oauthBrowserRequest } from '../oauth-request';

/** Exactly one `state` field, as a string. */
const readFormState = (form: FormData): string | undefined => {
  const values = form.getAll('state');
  const [value] = values;

  return values.length === 1 && Predicate.isString(value) ? value : undefined;
};

/** The consent form, or none when the body does not parse. */
export const consentForm = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const webRequest = yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie);

  return yield* Effect.tryPromise({
    try: async () => webRequest.formData(),
    catch: () => 'unparseable' as const,
  }).pipe(Effect.option);
});

/** The pending transaction this browser is bound to, for a submitted form. */
export const boundPending = Effect.fnUntraced(function* (form: FormData) {
  const transactionId = readFormState(form);

  if (transactionId === undefined || !isAuthTransactionId(transactionId)) {
    return Option.none();
  }

  const browser = yield* oauthBrowserRequest;
  const browserSecret = browser.browserSecret(transactionId);

  if (browserSecret === undefined) {
    return Option.none();
  }

  const transactions = yield* AuthTransactions;

  const pending = yield* transactions.getPending({
    id: transactionId,
    browserSecret,
  });

  return pending.pipe(
    Option.map((transaction) => ({ transaction, browserSecret })),
  );
});
