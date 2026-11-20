import { Option } from 'effect';
import { AUTH_RESTART_DESCRIPTION } from '../../../mcp/oauth/consent-html-headers';
import { FlowAnswer } from '../../../mcp/oauth/flow-answer';
import { CallbackFailed } from './callback-failed';

export const oauthError = (input: {
  readonly error: string;
  readonly description: string | undefined;
  readonly status?: number;
}) =>
  FlowAnswer.OAuthError({
    status: input.status ?? 400,
    error: input.error,
    description: input.description,
    headers: {},
    context: Option.none(),
  });

export const restartAnswer = () =>
  oauthError({
    error: 'invalid_request',
    description: AUTH_RESTART_DESCRIPTION,
  });

export const isPresent = (value: string | null): value is string =>
  value !== null && value !== '';

export const hostOf = (uri: string): string | undefined => {
  try {
    return new URL(uri).hostname;
  } catch {
    return undefined;
  }
};

/** A server-side failure of a step, with what the answer needs to know. */
export const failed =
  (input: {
    readonly clientId: string | undefined;
    readonly consumed: boolean;
  }) =>
  (error: { readonly cause: unknown }) =>
    CallbackFailed.make({
      cause: error.cause,
      clientId: input.clientId,
      consumed: input.consumed,
      sloEmitted: false,
    });
