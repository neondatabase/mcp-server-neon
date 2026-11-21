import { Effect, Option } from 'effect';
import { parseConsentPost } from '../../../mcp/oauth/consent-approval';
import { oauthErrorResponse } from '../oauth-error-response';
import { oauthBrowserRequest } from '../oauth-request';
import { restartResponse } from './authorize-consent';
import { cancel } from './authorize-cancel';
import { approve, invalidSubmission } from './authorize-decision';
import { boundPending, consentForm } from './authorize-form';

const FORM_CONTENT_TYPES = new Set([
  'application/x-www-form-urlencoded',
  'multipart/form-data',
]);

/** POST /api/authorize: the consent form's approve or cancel. */
export const authorizePost = Effect.gen(function* () {
  const browser = yield* oauthBrowserRequest;

  const contentType =
    browser.headers.get('content-type')?.split(';', 1)[0]?.trim() ?? '';

  if (!FORM_CONTENT_TYPES.has(contentType)) {
    return oauthErrorResponse(
      400,
      'invalid_request',
      'Consent submission must use application/x-www-form-urlencoded or multipart/form-data',
    );
  }

  const form = yield* consentForm;

  if (Option.isNone(form)) {
    return oauthErrorResponse(
      400,
      'invalid_request',
      'Invalid consent form data',
    );
  }

  const bound = yield* boundPending(form.value);

  if (Option.isNone(bound)) {
    return restartResponse();
  }

  const { transaction: pending, browserSecret } = bound.value;

  const parsed = parseConsentPost({
    form: form.value,
    mode: pending.mode,
    ceiling: pending.ceiling,
  });

  if (parsed.action === 'cancel') {
    return yield* cancel({ id: pending.id, browserSecret });
  }

  if (parsed.action === 'invalid') {
    return yield* invalidSubmission({ pending, error: parsed.error });
  }

  return yield* approve({ pending, approval: parsed, browserSecret });
});
