import { createHmac, timingSafeEqual } from 'node:crypto';

const AUTHORIZE_STATE_TTL_SECONDS = 30 * 60;

export type DownstreamAuthRequest = {
  responseType: string;
  clientId: string;
  redirectUri: string;
  scope: string[];
  state: string;
  resource?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
};

export class AuthorizeStateConfigError extends Error {
  readonly kind = 'config';
  constructor() {
    super('COOKIE_SECRET is not set');
    this.name = 'AuthorizeStateConfigError';
  }
}

export class AuthorizeStateError extends Error {
  readonly kind = 'invalid';
  constructor(
    message = 'Invalid authorize state. Start the connection again from your MCP client.',
  ) {
    super(message);
    this.name = 'AuthorizeStateError';
  }
}

function cookieSecret(): string {
  const secret = process.env.COOKIE_SECRET;
  if (secret === undefined || secret.length === 0) {
    throw new AuthorizeStateConfigError();
  }
  return secret;
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

function parsePayload(value: unknown): DownstreamAuthRequest {
  if (typeof value !== 'object' || value === null) {
    throw new AuthorizeStateError();
  }
  if (!('responseType' in value) || typeof value.responseType !== 'string') {
    throw new AuthorizeStateError();
  }
  if (!('clientId' in value) || typeof value.clientId !== 'string') {
    throw new AuthorizeStateError();
  }
  if (!('redirectUri' in value) || typeof value.redirectUri !== 'string') {
    throw new AuthorizeStateError();
  }
  if (!('scope' in value) || !isStringArray(value.scope)) {
    throw new AuthorizeStateError();
  }
  if (!('state' in value) || typeof value.state !== 'string') {
    throw new AuthorizeStateError();
  }
  const resource =
    'resource' in value && typeof value.resource === 'string'
      ? value.resource
      : undefined;
  const codeChallenge =
    'codeChallenge' in value && typeof value.codeChallenge === 'string'
      ? value.codeChallenge
      : undefined;
  const codeChallengeMethod =
    'codeChallengeMethod' in value &&
    typeof value.codeChallengeMethod === 'string'
      ? value.codeChallengeMethod
      : undefined;
  return {
    responseType: value.responseType,
    clientId: value.clientId,
    redirectUri: value.redirectUri,
    scope: value.scope,
    state: value.state,
    resource,
    codeChallenge,
    codeChallengeMethod,
  };
}

function parseEnvelope(value: unknown): {
  exp: number;
  maxScope: string[];
  payload: DownstreamAuthRequest;
} {
  if (typeof value !== 'object' || value === null) {
    throw new AuthorizeStateError();
  }
  if (!('v' in value) || value.v !== 1) {
    throw new AuthorizeStateError();
  }
  if (
    !('exp' in value) ||
    typeof value.exp !== 'number' ||
    !Number.isFinite(value.exp)
  ) {
    throw new AuthorizeStateError();
  }
  if (!('maxScope' in value) || !isStringArray(value.maxScope)) {
    throw new AuthorizeStateError();
  }
  if (!('payload' in value)) {
    throw new AuthorizeStateError();
  }
  return {
    exp: value.exp,
    maxScope: value.maxScope,
    payload: parsePayload(value.payload),
  };
}

function mac(body: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(body).digest();
}

export function signAuthorizeState({
  payload,
  maxScope,
  nowSeconds = Math.floor(Date.now() / 1000),
  ttlSeconds = AUTHORIZE_STATE_TTL_SECONDS,
}: {
  payload: DownstreamAuthRequest;
  maxScope: string[];
  nowSeconds?: number;
  ttlSeconds?: number;
}): string {
  const secret = cookieSecret();
  const envelope = {
    v: 1 as const,
    exp: nowSeconds + ttlSeconds,
    maxScope,
    payload,
  };
  const body = Buffer.from(JSON.stringify(envelope), 'utf8').toString(
    'base64url',
  );
  const signature = mac(body, secret).toString('base64url');
  return `${body}.${signature}`;
}

export function verifyAuthorizeState(
  encoded: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): { payload: DownstreamAuthRequest; maxScope: string[] } {
  const secret = cookieSecret();
  const separator = encoded.lastIndexOf('.');
  if (separator <= 0 || separator === encoded.length - 1) {
    throw new AuthorizeStateError();
  }
  const body = encoded.slice(0, separator);
  const signature = encoded.slice(separator + 1);
  let given: Buffer;
  try {
    given = Buffer.from(signature, 'base64url');
  } catch {
    throw new AuthorizeStateError();
  }
  const expected = mac(body, secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new AuthorizeStateError();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    throw new AuthorizeStateError();
  }
  const envelope = parseEnvelope(parsed);
  if (envelope.exp <= nowSeconds) {
    throw new AuthorizeStateError(
      'This authorization request has expired. Start the connection again from your MCP client.',
    );
  }
  return { payload: envelope.payload, maxScope: envelope.maxScope };
}
