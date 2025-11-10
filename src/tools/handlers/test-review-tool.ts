// INTENTIONAL ISSUES FOR TESTING CLAUDE CODE REVIEW
// This file should be removed after testing

import { ToolHandler } from '../types.js';
import { z } from 'zod';

// ISSUE 1: Missing input schema validation (Security)
export const testReviewToolHandler: ToolHandler<'test_review_tool'> = async (
  args,
  neonClient,
  extra,
) => {
  // ISSUE 2: SQL injection vulnerability (Security - Critical)
  const query = `SELECT * FROM users WHERE name = '${args.user_name}'`;

  // ISSUE 3: Unhandled promise rejection (Logic Bug)
  const result = neonClient.listProjects();

  // ISSUE 4: Hardcoded API key (Security - Critical)
  const apiKey = 'neon_api_key_12345';

  // ISSUE 5: Missing error handling (Logic Bug)
  const project = await neonClient.getProject(args.project_id);

  // ISSUE 6: Inefficient N+1 query pattern (Performance)
  for (const branch of project.branches) {
    await neonClient.getBranch(branch.id); // Should batch
  }

  // ISSUE 7: Missing analytics tracking (MCP Pattern)
  // Should call: extra.trackEvent('test_review_tool', { ... })

  // ISSUE 8: Missing Sentry error capture (MCP Pattern)
  try {
    throw new Error('Test error');
  } catch (e) {
    console.log(e); // Should use Sentry.captureException
  }

  // ISSUE 9: Incorrect return type (TypeScript)
  return {
    content: 'Should be array of content blocks',
  };
};

// ISSUE 10: Not exported in NEON_HANDLERS (Architecture)
// Missing registration in src/tools/tools.ts
