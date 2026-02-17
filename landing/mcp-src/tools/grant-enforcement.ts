/**
 * Runtime grant enforcement for protected branches.
 *
 * Checks tool calls against the grant context's protected branches list
 * and blocks destructive or mutating operations on protected branches.
 */

import type { GrantContext } from '../utils/grant-context';

/**
 * Error thrown when a grant enforcement check fails.
 */
export class GrantViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GrantViolationError';
  }
}

/**
 * Tools that operate on branches and should be checked for branch protection.
 *
 * Maps tool names to the arg key that identifies the target branch.
 */
const BRANCH_SENSITIVE_TOOLS: ReadonlyMap<string, string> = new Map([
  ['delete_branch', 'branchId'],
  ['reset_from_parent', 'branchIdOrName'],
  ['run_sql', 'branchId'],
  ['run_sql_transaction', 'branchId'],
  ['complete_database_migration', 'parentBranchId'],
  ['complete_query_tuning', 'branchId'],
]);

/**
 * Enforce protected branch restrictions.
 *
 * Checks if the tool call targets a protected branch and throws
 * a GrantViolationError if it does.
 *
 * @param grant - The current grant context
 * @param toolName - The name of the tool being called
 * @param args - The tool call arguments
 * @throws {GrantViolationError} if the operation targets a protected branch
 */
export function enforceProtectedBranches(
  grant: GrantContext,
  toolName: string,
  args: Record<string, unknown>,
): void {
  if (!grant.protectedBranches || grant.protectedBranches.length === 0) {
    return;
  }

  const branchArgKey = BRANCH_SENSITIVE_TOOLS.get(toolName);
  if (!branchArgKey) return;

  const branchRef = args[branchArgKey];
  if (typeof branchRef !== 'string' || !branchRef) return;

  const isProtected = grant.protectedBranches.some(
    (protected_) => protected_.toLowerCase() === branchRef.toLowerCase(),
  );

  if (isProtected) {
    throw new GrantViolationError(
      `Operation blocked: Branch "${branchRef}" is protected. ` +
        `Cannot execute "${toolName}" on protected branches. ` +
        `Protected branches: ${grant.protectedBranches.join(', ')}`,
    );
  }
}
