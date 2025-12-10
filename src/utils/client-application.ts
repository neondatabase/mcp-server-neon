export type ClientApplication = 'cursor' | 'claude' | 'other';

/**
 * Detects the client application type from the MCP client name.
 * The client name is provided by the MCP client during the initialize handshake.
 *
 * @param clientName - The name of the MCP client (e.g., "claude-ai", "cursor-client")
 * @returns The detected client application type
 */
export function detectClientApplication(
  clientName?: string,
): ClientApplication {
  if (!clientName) return 'other';

  const normalized = clientName.toLowerCase();

  if (normalized.includes('cursor')) return 'cursor';
  if (normalized.includes('claude')) return 'claude';

  return 'other';
}
