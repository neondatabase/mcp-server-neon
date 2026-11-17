import type { NeonSecretsMode, NeonToolMetadata } from '@neon/tools';
import {
  hiddenSecretFields,
  REDACTED_SECRET,
  withheldUnderSecrets,
} from '@neon/tools';
import { z } from 'zod';
import type { GrantContext } from './grant-context';

export const SECRETS_PARAM = 'secrets';

/** Lowercase on purpose: Node lowercases incoming header names. */
export const SECRETS_HEADER = 'x-neon-secrets';

/** Tightest first, so a lower index shows fewer secrets. */
const SECRETS_MODES = [
  'none',
  'setup',
  'all',
] as const satisfies readonly NeonSecretsMode[];

export const DEFAULT_SECRETS = 'setup' satisfies NeonSecretsMode;

/** The secrets modes in the order users read them. */
export const SECRETS_CHOICES = [
  'setup',
  'all',
  'none',
] as const satisfies readonly NeonSecretsMode[];

export type SecretsChoice = (typeof SECRETS_CHOICES)[number];

export class InvalidSecretsError extends Error {
  constructor() {
    super(`Invalid ${SECRETS_PARAM}: expected setup, all, or none`);
    this.name = 'InvalidSecretsError';
  }
}

/**
 * A stored grant carries `all`, `none`, or nothing for the default. Any other
 * stored value fails the whole grant, since dropping it could show secrets.
 */
export const StoredSecrets = z.object({
  secrets: z.enum(['all', 'none']).optional(),
});

/** The grant field for a mode; the default is stored as absent. */
export const secretsField = (
  mode: NeonSecretsMode,
): Pick<GrantContext, 'secrets'> =>
  mode === DEFAULT_SECRETS ? {} : { secrets: mode };

const isSecretsMode = (value: string): value is NeonSecretsMode =>
  SECRETS_MODES.some((mode) => mode === value);

/**
 * A value we cannot read must not fall back to showing more secrets, so
 * anything but one known mode throws.
 */
const parseSecretsValues = (
  values: readonly string[],
): NeonSecretsMode | undefined => {
  if (values.length === 0) {
    return undefined;
  }

  const [value = ''] = values;
  const normalized = value.trim().toLowerCase();

  if (values.length > 1 || !isSecretsMode(normalized)) {
    throw new InvalidSecretsError();
  }

  return normalized;
};

export const parseSecretsParam = (
  params: URLSearchParams,
): NeonSecretsMode | undefined =>
  parseSecretsValues(params.getAll(SECRETS_PARAM));

export const parseSecretsValue = (
  value: string | null,
): NeonSecretsMode | undefined =>
  parseSecretsValues(value === null ? [] : [value]);

const tighter = (
  left: NeonSecretsMode,
  right: NeonSecretsMode | undefined,
): NeonSecretsMode =>
  right === undefined ||
  SECRETS_MODES.indexOf(left) <= SECRETS_MODES.indexOf(right)
    ? left
    : right;

export const grantSecrets = (grant: GrantContext): NeonSecretsMode =>
  grant.secrets ?? DEFAULT_SECRETS;

export const effectiveSecrets = (
  grant: GrantContext,
  readOnly: boolean,
): NeonSecretsMode => (readOnly ? 'none' : grantSecrets(grant));

/** A request's URL and header may tighten a grant's secrets mode, never loosen it. */
export const withRequestSecrets = (
  grant: GrantContext,
  searchParams: URLSearchParams,
  headerValue: string | null | undefined,
): GrantContext => {
  const fromUrl = parseSecretsParam(searchParams);
  const fromHeader = parseSecretsValue(headerValue ?? null);

  const mode = tighter(tighter(grantSecrets(grant), fromUrl), fromHeader);
  const { secrets: _, ...rest } = grant;

  return { ...rest, ...secretsField(mode) };
};

export const withoutWithheldSecretTools = <
  Tool extends Pick<
    NeonToolMetadata,
    'secretOutputFields' | 'returnsOnlySecrets'
  >,
>(
  tools: Tool[],
  grant: GrantContext,
  readOnly: boolean,
): Tool[] => {
  const mode = effectiveSecrets(grant, readOnly);

  return tools.filter((tool) => !withheldUnderSecrets(tool, mode));
};

const SECRETS_NOTICES: Record<NeonSecretsMode, string | undefined> = {
  all: undefined,
  setup:
    `Notice: Tool results show ${REDACTED_SECRET} in place of secrets the user stored in Neon to call other services: OAuth provider client secrets and the SMTP password. ` +
    `The user can show them by adding ${SECRETS_PARAM}=all to the MCP server URL and removing any X-Neon-Secrets header, ` +
    'or, with OAuth, by authorizing again and choosing "All secrets" on the consent page.',
  none:
    `Notice: Secrets are hidden on this connection. Tool results show ${REDACTED_SECRET} in place of passwords, tokens, keys and connection strings, ` +
    'and tools whose result is only a secret, such as get_connection_string, are unavailable. ' +
    `The user can show setup credentials by removing the ${SECRETS_PARAM} query param from the MCP server URL and the X-Neon-Secrets header, ` +
    'or, with OAuth, by authorizing again and choosing "Setup credentials" on the consent page.',
};

/**
 * Sent only when a tool in the grant's scope has a secret the mode hides,
 * including tools the mode withholds. Read-only mode has its own notice, which
 * covers hidden secrets.
 */
export const secretsNotices = (
  grant: GrantContext,
  readOnly: boolean,
  tools: readonly Pick<NeonToolMetadata, 'secretOutputFields'>[],
): string[] => {
  const mode = grantSecrets(grant);
  const notice = readOnly ? undefined : SECRETS_NOTICES[mode];
  const hides = tools.some((tool) => hiddenSecretFields(tool, mode).length > 0);

  return notice === undefined || !hides ? [] : [notice];
};

export const SECRETS_LABELS: Record<NeonSecretsMode, string> = {
  setup: 'Setup credentials',
  all: 'All secrets',
  none: 'No secrets',
};

export const SECRETS_HELP: Record<NeonSecretsMode, string> = {
  setup:
    'Connection strings, Postgres role passwords, credential tokens, presigned URLs and the Neon Auth and Realtime secrets.',
  all: 'Setup credentials, plus the OAuth provider client secrets and SMTP password stored in Neon Auth.',
  none: `Tool results show ${REDACTED_SECRET} instead, and tools that only return a secret are hidden.`,
};

/** A stored grant's secrets mode, checked on its own so a bad value fails the grant. */
export const withStoredSecrets = (
  grant: GrantContext,
  stored: ReturnType<typeof StoredSecrets.safeParse>,
): GrantContext | undefined =>
  stored.success ? { ...grant, ...stored.data } : undefined;
