import { createApiClient } from '@neondatabase/api-client';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

export const getPackageJson = () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  return JSON.parse(
    fs.readFileSync(path.join(__dirname, '../..', 'package.json'), 'utf8'),
  );
};

const API_HOST = process.env.NEON_API_HOST ?? 'http://localhost:30000/api/v2';
export const createNeonClient = (apiKey: string) =>
  createApiClient({
    apiKey,
    baseURL: API_HOST,
    headers: {
      'User-Agent': `mcp-server-neon/${getPackageJson().version}`,
    },
  });
