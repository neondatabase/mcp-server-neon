import { createNeonClient as createSdkClient } from '../neon-client';

export const createNeonClient = (apiKey: string) => createSdkClient(apiKey);
