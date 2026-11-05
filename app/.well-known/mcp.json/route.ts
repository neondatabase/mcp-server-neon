import {
  buildServerCard,
  discoveryPreflight,
  discoveryResponse,
} from '@/lib/server-metadata';

// SEP-1649 first placed the Server Card here, and directory scanners still
// probe this path before /mcp/server-card.
export function GET() {
  return discoveryResponse(buildServerCard(), 'application/json');
}

export const OPTIONS = discoveryPreflight;
