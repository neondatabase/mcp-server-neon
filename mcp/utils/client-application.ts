import { logger } from './logger';

type KnownClientApplication =
  | 'cursor'
  | 'claude-code'
  | 'claude-desktop'
  | 'claude-ai'
  | 'chatgpt'
  | 'v0'
  | 'vscode'
  | 'codex'
  | 'gemini-cli'
  | 'windsurf'
  | 'antigravity'
  | 'cline'
  | 'goose'
  | 'github-copilot-cli'
  | 'grok-build'
  | 'kilo-code'
  | 'kimi-code'
  | 'kiro-cli'
  | 'mcporter'
  | 'opencode'
  | 'fx'
  | 'zed'
  | 'postman';

export type ClientApplication = KnownClientApplication | 'unknown';

export type IdentifiedClient = {
  clientName: string;
  clientApplication: ClientApplication;
};

function tokenAtStart(normalized: string, token: string): boolean {
  return (
    normalized === token ||
    normalized.startsWith(`${token}/`) ||
    normalized.startsWith(`${token} `) ||
    normalized.startsWith(`${token}-`)
  );
}

export function detectClientApplication(
  clientName?: unknown,
): ClientApplication {
  if (typeof clientName !== 'string' || clientName.length === 0) {
    return 'unknown';
  }

  const normalized = clientName.toLowerCase();

  if (normalized.includes('cursor')) return 'cursor';
  if (normalized.includes('claude-code')) return 'claude-code';
  if (
    normalized.includes('claude-user') ||
    normalized.includes('claude desktop')
  )
    return 'claude-desktop';
  if (normalized.includes('claude-ai')) return 'claude-ai';
  if (normalized.includes('chatgpt')) return 'chatgpt';
  if (normalized.includes('v0bot')) return 'v0';
  if (
    normalized.includes('github copilot cli') ||
    normalized.includes('github-copilot-developer') ||
    normalized.includes('copilot-cli') ||
    normalized.includes('copilot/')
  )
    return 'github-copilot-cli';
  if (
    normalized.includes('visual studio code') ||
    normalized.includes('visual-studio-code')
  )
    return 'vscode';
  if (
    tokenAtStart(normalized, 'codex') ||
    normalized.includes('codex-mcp') ||
    normalized.includes('(codex)')
  )
    return 'codex';
  // ChatGPT's connector UA is openai-mcp; Codex adds "(Codex)" and matches above.
  if (normalized.includes('openai-mcp')) return 'chatgpt';
  if (normalized.includes('gemini-cli') || normalized.includes('gemini cli'))
    return 'gemini-cli';
  if (normalized.includes('windsurf')) return 'windsurf';
  if (normalized.includes('antigravity') || tokenAtStart(normalized, 'agy'))
    return 'antigravity';
  if (tokenAtStart(normalized, 'cline')) return 'cline';
  if (tokenAtStart(normalized, 'goose')) return 'goose';
  if (normalized.includes('grok-cli')) return 'grok-build';
  if (tokenAtStart(normalized, 'kilo')) return 'kilo-code';
  if (normalized.includes('kimi-code')) return 'kimi-code';
  if (
    normalized.includes('q-dev-cli') ||
    normalized.includes('q dev cli') ||
    normalized.includes('kiro cli')
  )
    return 'kiro-cli';
  if (normalized.includes('mcporter')) return 'mcporter';
  if (normalized.includes('opencode')) return 'opencode';
  if (tokenAtStart(normalized, 'fx')) return 'fx';
  if (tokenAtStart(normalized, 'zed')) return 'zed';
  if (normalized.includes('postman')) return 'postman';

  return 'unknown';
}

export function identifyClient(clientName?: unknown): IdentifiedClient {
  try {
    if (typeof clientName !== 'string' || clientName.length === 0) {
      return {
        clientName: 'unknown',
        clientApplication: 'unknown',
      };
    }
    return {
      clientName,
      clientApplication: detectClientApplication(clientName),
    };
  } catch (error) {
    // Attribution is telemetry-only. A throw here would 500 the MCP request.
    logger.error('identifyClient failed', { err: error });
    return {
      clientName:
        typeof clientName === 'string' && clientName.length > 0
          ? clientName
          : 'unknown',
      clientApplication: 'unknown',
    };
  }
}
