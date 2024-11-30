import { NEON_HANDLERS, NeonToolName } from './tools.js';

export const isNeonToolName = (name: string): name is NeonToolName => {
  return name in NEON_HANDLERS;
};
