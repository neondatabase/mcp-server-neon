import { NEON_HANDLERS } from './tools.js';
export const isNeonToolName = (name) => {
    return name in NEON_HANDLERS;
};
