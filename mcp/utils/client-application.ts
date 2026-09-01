type KnownClientApplication =
  | 'cursor'
  | 'claude-code'
  | 'claude-desktop'
  | 'chatgpt'
  | 'v0'
  | 'vscode';

export type ClientApplication = KnownClientApplication | 'unknown';

export type IdentifiedClient = {
  clientName: string;
  clientApplication: ClientApplication;
};

/**
 * Detects the client application type from the MCP client name or User-Agent.
 * @param clientName - The name of the MCP client
 * @returns The detected client application type
 */
export function detectClientApplication(
  clientName?: string,
): ClientApplication {
  if (!clientName) return 'unknown';

  const normalized = clientName.toLowerCase();

  // Known clients
  if (normalized.includes('cursor')) return 'cursor';
  if (normalized.includes('claude-code')) return 'claude-code';
  if (
    normalized.includes('claude-user') ||
    normalized.includes('claude desktop')
  )
    return 'claude-desktop';
  if (normalized.includes('chatgpt')) return 'chatgpt';
  if (normalized.includes('v0bot')) return 'v0';
  if (normalized.includes('visual studio code')) return 'vscode';

  return 'unknown';
}

export function identifyClient(clientName?: string): IdentifiedClient {
  const name = clientName ?? 'unknown';
  return {
    clientName: name,
    clientApplication: detectClientApplication(name),
  };
}
