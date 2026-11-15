import { SERVER_HOST } from '../config';

export const MCP_URL = new URL('/mcp', SERVER_HOST).href;

export const MARKDOWN_PATH = '/mcp.md';

export const LIST_TOOLS_URL = new URL('/api/list-tools', SERVER_HOST).href;

export const OG_IMAGE_URL = new URL('/og-image.png', SERVER_HOST).href;

export const DOCS_URL = 'https://neon.com/docs/ai/neon-mcp-server';

export const API_KEY_URL =
  'https://console.neon.tech/app/settings?modal=create_api_key';

export const REPOSITORY_URL = 'https://github.com/neondatabase/mcp-server-neon';

export const STATUS_URL = 'https://neonstatus.com';
