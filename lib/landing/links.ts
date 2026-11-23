import { SERVER_HOST } from '../config';
import { PUBLIC_MCP_URL } from '../server-metadata';

/** The address the page tells people to add: production's, whichever deployment serves the page. */
export const MCP_URL = PUBLIC_MCP_URL;

export const MARKDOWN_PATH = '/mcp.md';

export const LIST_TOOLS_URL = new URL('/api/list-tools', MCP_URL).href;

export const OG_IMAGE_URL = new URL('/og-image.png', SERVER_HOST).href;

export const DOCS_URL = 'https://neon.com/docs/ai/neon-mcp-server';

export const API_KEY_URL =
  'https://console.neon.tech/app/settings?modal=create_api_key';

export const REPOSITORY_URL = 'https://github.com/neondatabase/mcp-server-neon';

export const STATUS_URL = 'https://neonstatus.com';
