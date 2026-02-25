import type { GrantContext } from '../utils/grant-context';
import { getAvailableTools } from './grant-filter';

/**
 * Build the effective tool surface for an authenticated context.
 *
 * This is the single composition point used by remote transport to keep
 * tool registration and tools/list output in sync.
 */
export function composeToolsForContext(grant: GrantContext, readOnly: boolean) {
  return getAvailableTools(grant, readOnly);
}
