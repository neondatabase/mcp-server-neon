import { describe, expect, it } from 'vitest';
import {
  detectClientApplication,
  identifyClient,
} from '../utils/client-application';

describe('detectClientApplication', () => {
  it.each([
    ['Cursor', 'cursor'],
    ['Cursor (via mcp-remote 0.1.31)', 'cursor'],
    ['cursor-vscode', 'cursor'],
    ['claude-code', 'claude-code'],
    ['claude-code/2.1.226 (cli)', 'claude-code'],
    ['claude-code/2.1.226 (claude-vscode, agent-sdk/0.3.226)', 'claude-code'],
    ['claude-user', 'claude-desktop'],
    ['Claude Desktop', 'claude-desktop'],
    ['claude-ai', 'claude-ai'],
    ['ChatGPT', 'chatgpt'],
    ['chatgpt', 'chatgpt'],
    ['openai-mcp/1.0.0', 'chatgpt'],
    ['v0bot', 'v0'],
    ['Visual Studio Code', 'vscode'],
    ['Visual Studio Code/1.132.0', 'vscode'],
    ['Visual-Studio-Code', 'vscode'],
    ['Visual Studio Code - Insiders', 'vscode'],
    ['GitHub Copilot', 'unknown'],
    ['Codex', 'codex'],
    ['codex-mcp-client', 'codex'],
    ['codex-mcp-client/0.147.0', 'codex'],
    ['openai-mcp/1.0.0 (Codex)', 'codex'],
    ['gemini-cli-mcp-client', 'gemini-cli'],
    ['Gemini CLI MCP Client', 'gemini-cli'],
    ['Windsurf', 'windsurf'],
    ['windsurf-client', 'windsurf'],
    ['antigravity-client', 'antigravity'],
    ['antigravity-client (via mcp-remote 0.1.37)', 'antigravity'],
    ['Google Antigravity', 'antigravity'],
    ['Antigravity IDE MCP Client', 'antigravity'],
    ['agy', 'antigravity'],
    ['antigravity-cli', 'antigravity'],
    ['Cline', 'cline'],
    ['cline-cli', 'cline'],
    ['goose', 'goose'],
    ['GitHub Copilot CLI', 'github-copilot-cli'],
    ['github-copilot-developer', 'github-copilot-cli'],
    ['copilot-cli', 'github-copilot-cli'],
    ['copilot/1.0.78 (win32 v24.18.1) term/vscode', 'github-copilot-cli'],
    ['grok-cli', 'grok-build'],
    ['grok-cli/1.2.3', 'grok-build'],
    ['Kilo', 'kilo-code'],
    ['Kilo-Code', 'kilo-code'],
    ['kilo', 'kilo-code'],
    ['kimi-code', 'kimi-code'],
    ['kimi-code (neon)', 'kimi-code'],
    ['Q-DEV-CLI', 'kiro-cli'],
    ['Q DEV CLI', 'kiro-cli'],
    ['Kiro CLI', 'kiro-cli'],
    ['Grok', 'unknown'],
    ['Kimi', 'unknown'],
    ['kiro', 'unknown'],
    ['mcporter (neon)', 'mcporter'],
    ['opencode', 'opencode'],
    ['OpenCode', 'opencode'],
    ['opencode/1.18.15', 'opencode'],
    ['fx', 'fx'],
    ['fx/1.0.0', 'fx'],
    ['Zed', 'zed'],
    ['Zed/1.14.2+stable (linux; x86_64)', 'zed'],
    ['Postman', 'postman'],
    ['Postman-Client', 'postman'],
    ['MCP CLI Proxy', 'unknown'],
    ['decline', 'unknown'],
    ['mongoose', 'unknown'],
    ['postfix', 'unknown'],
    ['buzzed', 'unknown'],
    ['grokking-mcp', 'unknown'],
    ['Shikimori', 'unknown'],
    ['Sekiro', 'unknown'],
    ['node', 'unknown'],
    ['python-httpx/0.28.1', 'unknown'],
    ['', 'unknown'],
    [undefined, 'unknown'],
  ] as const)('%s → %s', (input, expected) => {
    expect(detectClientApplication(input)).toBe(expected);
  });
});

describe('identifyClient', () => {
  it('defaults missing names to unknown', () => {
    expect(identifyClient()).toEqual({
      clientName: 'unknown',
      clientApplication: 'unknown',
    });
  });

  it('keeps the handshake or UA string and classifies it', () => {
    expect(identifyClient('ChatGPT')).toEqual({
      clientName: 'ChatGPT',
      clientApplication: 'chatgpt',
    });
  });

  it('does not throw on non-string runtime values', () => {
    expect(detectClientApplication(1)).toBe('unknown');
    expect(detectClientApplication({ name: 'Cursor' })).toBe('unknown');
    expect(identifyClient(['Codex'])).toEqual({
      clientName: 'unknown',
      clientApplication: 'unknown',
    });
  });
});
