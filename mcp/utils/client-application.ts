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
  clientName?: string,
): ClientApplication {
  if (!clientName) return 'unknown';

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
    normalized.includes('visual-studio-code') ||
    normalized.includes('github copilot')
  )
    return 'vscode';
  if (normalized.includes('codex')) return 'codex';
  // ChatGPT's connector UA is openai-mcp; Codex adds "(Codex)" and matches above.
  if (normalized.includes('openai-mcp')) return 'chatgpt';
  if (normalized.includes('gemini')) return 'gemini-cli';
  if (normalized.includes('windsurf')) return 'windsurf';
  if (normalized.includes('antigravity') || tokenAtStart(normalized, 'agy'))
    return 'antigravity';
  if (tokenAtStart(normalized, 'cline')) return 'cline';
  if (tokenAtStart(normalized, 'goose')) return 'goose';
  if (normalized.includes('grok')) return 'grok-build';
  if (tokenAtStart(normalized, 'kilo')) return 'kilo-code';
  if (normalized.includes('kimi')) return 'kimi-code';
  if (normalized.includes('kiro')) return 'kiro-cli';
  if (normalized.includes('mcporter')) return 'mcporter';
  if (normalized.includes('opencode')) return 'opencode';
  if (tokenAtStart(normalized, 'fx')) return 'fx';
  if (tokenAtStart(normalized, 'zed')) return 'zed';
  if (normalized.includes('postman')) return 'postman';

  return 'unknown';
}

export function identifyClient(clientName?: string): IdentifiedClient {
  const name = clientName ?? 'unknown';
  return {
    clientName: name,
    clientApplication: detectClientApplication(name),
  };
}
