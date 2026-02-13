import { createApiClient } from '@neondatabase/api-client';
import { NEON_API_HOST } from '../constants';
import pkg from '../../package.json';

export const createNeonClient = (apiKey: string) =>
  createApiClient({
    apiKey,
    baseURL: NEON_API_HOST,
    headers: {
      'User-Agent': `mcp-server-neon/${pkg.version}`,
    },
  });
