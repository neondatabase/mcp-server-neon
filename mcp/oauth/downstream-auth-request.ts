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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  if (!value.every((item) => typeof item === 'string')) {
    return undefined;
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  return value;
}

export function parseDownstreamAuthRequest(
  value: unknown,
): DownstreamAuthRequest | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (typeof value.responseType !== 'string') {
    return undefined;
  }
  if (typeof value.clientId !== 'string') {
    return undefined;
  }
  if (typeof value.redirectUri !== 'string') {
    return undefined;
  }
  const scope = parseStringArray(value.scope);
  if (!scope) {
    return undefined;
  }
  if (typeof value.state !== 'string') {
    return undefined;
  }
  const resource = optionalString(value.resource);
  const codeChallenge = optionalString(value.codeChallenge);
  const codeChallengeMethod = optionalString(value.codeChallengeMethod);
  if (value.resource !== undefined && resource === undefined) {
    return undefined;
  }
  if (value.codeChallenge !== undefined && codeChallenge === undefined) {
    return undefined;
  }
  if (
    value.codeChallengeMethod !== undefined &&
    codeChallengeMethod === undefined
  ) {
    return undefined;
  }
  return {
    responseType: value.responseType,
    clientId: value.clientId,
    redirectUri: value.redirectUri,
    scope,
    state: value.state,
    ...(resource !== undefined ? { resource } : {}),
    ...(codeChallenge !== undefined ? { codeChallenge } : {}),
    ...(codeChallengeMethod !== undefined ? { codeChallengeMethod } : {}),
  };
}
