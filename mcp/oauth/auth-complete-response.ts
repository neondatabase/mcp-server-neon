import { waitUntil } from '@vercel/functions';
import { NextResponse, type NextRequest } from 'next/server';
import { flushAnalytics, track } from '../analytics/analytics';
import { detectClientApplication } from '../utils/client-application';
import {
  nativeAppRedirect,
  renderAuthCompletePage,
  type AuthCompleteOutcome,
  type AuthCompletePageProps,
} from './auth-complete-page';

const TEMPORARY_FAILURE_MESSAGE =
  'Neon could not finish authorization right now. Try again in a moment.';

/** Who the page is for, as far as /callback knows, for analytics. */
type CompletionContext = {
  userId?: string;
  clientId?: string;
  clientName?: string;
};

const completionContexts = new WeakMap<NextResponse, CompletionContext>();

/** Tags a /callback response with the context its completion page reports. */
export function withCompletionContext(
  response: NextResponse,
  context: CompletionContext,
): NextResponse {
  completionContexts.set(response, context);
  return response;
}

/**
 * Native-app redirects (cursor://, claude://) and failures shown to a browser
 * get a completion page instead of a bare redirect or JSON body. Web redirects
 * and non-browser callers keep the original response.
 */
export async function presentToBrowser(
  request: NextRequest,
  response: NextResponse,
): Promise<NextResponse> {
  const isRedirect = response.status >= 300 && response.status < 400;
  const appRedirect = isRedirect
    ? nativeAppRedirect(response.headers.get('location'))
    : undefined;
  if (appRedirect) {
    const error = appRedirect.searchParams.get('error');
    return completionPage(response, 200, {
      outcome: error ? failureOutcome(error) : 'success',
      returnUrl: appRedirect.href,
    });
  }

  const acceptsHtml = request.headers.get('accept')?.includes('text/html');
  const isJson = response.headers
    .get('content-type')
    ?.includes('application/json');
  if (response.status < 400 || !acceptsHtml || !isJson) {
    return response;
  }

  // The JSON keeps its detail for developers. The page only shows fixed text:
  // error_description is often relayed from the query string, where anyone
  // can put words on a Neon-branded page.
  const body: { error?: unknown } = await response
    .clone()
    .json()
    .catch(() => ({}));
  return completionPage(response, response.status, {
    outcome: failureOutcome(body.error),
    message: response.status >= 500 ? TEMPORARY_FAILURE_MESSAGE : undefined,
  });
}

function failureOutcome(error: unknown): AuthCompleteOutcome {
  return error === 'access_denied' ? 'cancelled' : 'failed';
}

function completionPage(
  original: NextResponse,
  status: number,
  props: Omit<AuthCompletePageProps, 'nonce' | 'pageViewId'>,
): NextResponse {
  const pageViewId = crypto.randomUUID();
  const context = completionContexts.get(original) ?? {};
  // anonymousId is the page view so the browser's action events, which only
  // know the page view, join to this user without the page holding identity.
  track({
    ...(context.userId ? { userId: context.userId } : {}),
    anonymousId: pageViewId,
    event: 'auth_complete_viewed',
    properties: {
      pageViewId,
      outcome: props.outcome,
      opensApp: Boolean(props.returnUrl),
      clientId: context.clientId,
      clientName: context.clientName,
      clientApplication: detectClientApplication(context.clientName),
    },
  });
  waitUntil(flushAnalytics());

  const { html, headers } = renderAuthCompletePage({ ...props, pageViewId });
  const page = new NextResponse(html, { status, headers });
  for (const cookie of original.headers.getSetCookie()) {
    page.headers.append('set-cookie', cookie);
  }
  return page;
}
