#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createApiClient } from '@neondatabase/api-client';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { handleInit, parseArgs } from './initConfig.js';
import './utils/polyfills.js';
import { server } from './server/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'),
);

const commands = ['init', 'start'] as const;
const { command, neonApiKey, executablePath } = parseArgs();
if (!commands.includes(command as (typeof commands)[number])) {
  console.error(`Invalid command: ${command}`);
  process.exit(1);
}

if (command === 'init') {
  // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression, @typescript-eslint/await-thenable
  await handleInit({
    executablePath,
    neonApiKey,
  });
  process.exit(0);
}

// "start" command from here
// ----------------------------

export const neonClient = createApiClient({
  apiKey: neonApiKey,
  headers: {
    'User-Agent': `mcp-server-neon/${packageJson.version}`,
  },
});

/**
 * Start the server using stdio transport.
 * This allows the server to communicate via standard input/output streams.
 */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  console.error('Server error:', error);
  process.exit(1);
});
