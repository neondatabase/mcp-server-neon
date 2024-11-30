import { createApiClient } from '@neondatabase/api-client';
import dotenv from 'dotenv';
import { NEON_HANDLERS, NeonToolName } from './tools.js';

let neonClientInstance: ReturnType<typeof createApiClient> | null = null;

export const getNeonClient = () => {
  if (neonClientInstance) {
    return neonClientInstance;
  }

  dotenv.config();

  const API_KEY = process.env.NEON_API_KEY;
  if (!API_KEY) {
    throw new Error('NEON_API_KEY environment variable is required');
  }

  neonClientInstance = createApiClient({
    apiKey: API_KEY,
  });

  return neonClientInstance;
};

export const isNeonToolName = (name: string): name is NeonToolName => {
  return name in NEON_HANDLERS;
};
