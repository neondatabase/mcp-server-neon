import { createApiClient } from '@neondatabase/api-client';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { NEON_API_HOST } from '../constants.js';

export const getPackageJson = () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  return JSON.parse(
    fs.readFileSync(path.join(__dirname, '../..', 'package.json'), 'utf8'),
  );
};

export const createNeonClient = (apiKey: string) =>
  createApiClient({
    apiKey,
    baseURL: NEON_API_HOST,
    headers: {
      'User-Agent': `mcp-server-neon/${getPackageJson().version}`,
    },
  });
