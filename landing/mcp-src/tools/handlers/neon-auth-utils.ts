import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Api } from '@neondatabase/api-client';
import { getDefaultBranch } from './utils';

export async function resolveNeonAuthBranchId(
  projectId: string,
  branchId: string | undefined,
  neonClient: Api<unknown>,
): Promise<string> {
  if (branchId) {
    return branchId;
  }
  const defaultBranch = await getDefaultBranch(projectId, neonClient);
  return defaultBranch.id;
}

/**
 * Canonical "Neon Auth not provisioned" message. Worded to gate the LLM's
 * next action: surface the prerequisite to the user, explain the side effects
 * of `neon_auth_provision`, and obtain explicit approval before calling it.
 * Auto-chaining into provisioning is the wrong UX — provisioning creates the
 * `neon_auth` schema, deploys an auth service, and may incur cost.
 */
export const NEON_AUTH_NOT_PROVISIONED_MESSAGE =
  'Neon Auth is not provisioned for this branch (HTTP 404). Before calling neon_auth_provision, ask the user for explicit approval — provisioning has side effects (creates the neon_auth schema, deploys an auth service in your compute region, may incur cost).';

/**
 * Pre-flight check: returns null when Neon Auth IS provisioned for this
 * branch (callers should then proceed); returns a CallToolResult to short-
 * circuit with when it is not, or when the integration probe itself failed.
 *
 * Why a dedicated probe rather than mapping the per-operation 404? Several
 * mutations have their own 404-meaningful semantics (e.g.
 * `neon_auth_oauth_provider_update` on an unknown provider id,
 * `neon_auth_oauth_provider_delete` on a missing entry, `neon_auth_domain_update`
 * removing a domain that isn't in the list). Disambiguating by status code
 * alone is unsafe, so we ask the integration endpoint directly: a 404 there
 * definitively means the branch has no Neon Auth integration. A 5xx is
 * surfaced as a generic verify-failed message so a control-plane outage
 * cannot be misrepresented as "not provisioned".
 */
export async function ensureNeonAuthProvisioned(
  neonClient: Api<unknown>,
  projectId: string,
  branchId: string,
): Promise<CallToolResult | null> {
  const res = await neonClient.getNeonAuth(projectId, branchId);
  if (res.status === 200) {
    return null;
  }
  if (res.status === 404) {
    return {
      isError: true,
      content: [{ type: 'text', text: NEON_AUTH_NOT_PROVISIONED_MESSAGE }],
    };
  }
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: `Failed to verify Neon Auth provisioning (${res.status} ${res.statusText}).`,
      },
    ],
  };
}
