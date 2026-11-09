import {
  getActiveSpan,
  getRootSpan,
  spanToJSON,
  type ErrorEvent,
  type Span,
} from '@sentry/node';

const SESSION_ATTRIBUTES = [
  'mcp.session.id',
  'gen_ai.conversation.id',
] as const;

type SessionAttributes = Partial<
  Record<(typeof SESSION_ATTRIBUTES)[number], string>
>;

// Kept on the request's root span rather than the isolation scope: the first
// request after a cold start runs on the default isolation scope, and every
// later request clones whatever it wrote there.
function setOnRequest(key: keyof SessionAttributes, value: string): void {
  const active = getActiveSpan();
  if (active) getRootSpan(active).setAttribute(key, value);
}

export function tagRequestSession(sessionId: string): void {
  setOnRequest('mcp.session.id', sessionId);
}

export function tagRequestConversation(conversationId: string): void {
  setOnRequest('gen_ai.conversation.id', conversationId);
}

export function requestSessionAttributes(
  span: Span | undefined = getActiveSpan(),
): SessionAttributes {
  if (!span) return {};
  const data = spanToJSON(getRootSpan(span)).data;
  const attributes: SessionAttributes = {};
  for (const key of SESSION_ATTRIBUTES) {
    const value = data[key];
    if (typeof value === 'string') attributes[key] = value;
  }
  return attributes;
}

/** `spanStart` hook: every span of a request carries its session ids. */
export function copySessionAttributes(span: Span): void {
  span.setAttributes(requestSessionAttributes(span));
}

/** `beforeSend` hook: error events of a request carry its session ids as tags. */
export function tagEventWithSession(event: ErrorEvent): ErrorEvent {
  const session = requestSessionAttributes();
  if (Object.keys(session).length === 0) return event;
  return { ...event, tags: { ...event.tags, ...session } };
}
