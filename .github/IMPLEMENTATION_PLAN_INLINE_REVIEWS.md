# Enhanced Claude Code Review with Inline Comments - Implementation Plan

## Overview

Transform the Claude Code Review GitHub Action from posting a single summary comment to providing detailed inline comments on specific code issues, plus a comprehensive summary. This will give developers actionable, line-specific feedback directly in their PRs.

## Current State Analysis

**Existing Workflow:** `.github/workflows/claude-code-review.yml`

### What Works:
- ✅ Triggers on PR open and new commits (`opened`, `synchronize`)
- ✅ Security guards (OWNER/MEMBER/COLLABORATOR only)
- ✅ Proper permissions (contents, pull-requests, issues read access)
- ✅ Concurrency control (one review per PR, cancel-in-progress)

### Current Limitations:
- ❌ Uses `gh pr comment` → creates **one big comment**
- ❌ No line-specific feedback
- ❌ Generic prompt doesn't leverage project context (MCP architecture, TypeScript patterns)
- ❌ No differentiation from automated checks (lint, build already covered by `pr.yml`)

### What's Already Automated (Don't Duplicate):
- Linting: `pr.yml` runs `bun run lint` (line 28)
- Building: `pr.yml` runs `bun run build` (line 30)

## Desired End State

After implementation:
1. **Inline comments** on significant issues at specific lines
2. **Summary comment** with high-level findings and statistics
3. **Project-aware reviews** leveraging MCP architecture knowledge
4. **Focus on human judgment**: architecture, security, logic, performance, testing
5. **Avoid duplication**: Skip lint/build issues already caught by automation

### Verification Criteria:

#### Automated Verification:
- [ ] Workflow file passes YAML linting: `yamllint .github/workflows/claude-code-review.yml`
- [ ] Workflow syntax is valid: `gh workflow view claude-code-review.yml`
- [ ] Test PR triggers the workflow successfully
- [ ] Review comments appear as inline annotations (not single comment)

#### Manual Verification:
- [ ] Inline comments appear on specific problematic lines
- [ ] Summary comment includes review statistics and overview
- [ ] Comments focus on significant issues (not lint/format)
- [ ] Review demonstrates understanding of MCP architecture
- [ ] Comments reference CLAUDE.md conventions appropriately

## What We're NOT Doing

- Not replacing the existing lint/build automation (`pr.yml`)
- Not creating a separate GitHub Action package (inline implementation only)
- Not implementing formal review states (APPROVE/REQUEST_CHANGES) - staying with COMMENT
- Not adding automated test execution (Braintrust tests are developer-run)
- Not reviewing unchanged files or context lines (only changed code)

## Implementation Approach

Use GitHub's REST API (`gh api`) to post inline review comments on specific lines. Claude will:
1. Analyze the PR diff using `gh pr diff` and `gh pr view`
2. Identify significant issues requiring inline comments
3. Post inline comments via `gh api repos/.../pulls/.../comments`
4. Post summary comment via existing `gh pr comment`

This leverages GitHub's native review comment API while maintaining security through controlled tool access.

---

## Phase 1: Update Workflow Permissions and Tools

### Overview
Enable Claude to use GitHub's REST API for inline comments by adding `gh api` to allowed tools and updating permissions.

### Changes Required:

#### 1. Update Allowed Tools
**File**: `.github/workflows/claude-code-review.yml:69`
**Changes**: Add `gh api` command to allowlist

```yaml
# Current (line 69):
claude_args: '--allowed-tools "Bash(gh issue view:*),Bash(gh search:*),Bash(gh issue list:*),Bash(gh pr comment:*),Bash(gh pr diff:*),Bash(gh pr view:*),Bash(gh pr list:*)"'

# New:
claude_args: '--allowed-tools "Bash(gh issue view:*),Bash(gh search:*),Bash(gh issue list:*),Bash(gh pr comment:*),Bash(gh pr diff:*),Bash(gh pr view:*),Bash(gh pr list:*),Bash(gh api:repos/*/pulls/*/comments),Bash(gh api:repos/*/pulls/*/reviews)"'
```

**Rationale**:
- `gh api:repos/*/pulls/*/comments` - Create inline review comments
- `gh api:repos/*/pulls/*/reviews` - Create batch reviews (optional, for future use)
- Wildcard pattern allows any repo/PR but restricts to review endpoints only

#### 2. Update GitHub Permissions
**File**: `.github/workflows/claude-code-review.yml:34-38`
**Changes**: Add write permission for pull-requests

```yaml
# Current (lines 34-38):
permissions:
  contents: read
  pull-requests: read
  issues: read
  id-token: write

# New:
permissions:
  contents: read
  pull-requests: write  # Changed from 'read' to 'write' for inline comments
  issues: read
  id-token: write
```

**Rationale**: GitHub's REST API requires `pull-requests: write` to create review comments on specific lines.

### Success Criteria:

#### Automated Verification:
- [ ] Workflow YAML syntax is valid: `yamllint .github/workflows/claude-code-review.yml`
- [ ] GitHub Actions accepts the updated workflow (no syntax errors on push)
- [ ] Permissions are properly scoped (only PR write, not repository write)

#### Manual Verification:
- [ ] Test workflow run shows `gh api` commands execute without permission errors
- [ ] Claude can successfully post a test inline comment via `gh api`

---

## Phase 2: Enhance Prompt with Project Context

### Overview
Update the review prompt to leverage project-specific knowledge from CLAUDE.md and focus on areas not covered by automated checks.

### Changes Required:

#### 1. Replace Generic Prompt with MCP-Aware Instructions
**File**: `.github/workflows/claude-code-review.yml:52-65`
**Changes**: Comprehensive prompt rewrite

```yaml
# Current (lines 52-65):
prompt: |
  REPO: ${{ github.repository }}
  PR NUMBER: ${{ github.event.pull_request.number || github.event.inputs.pr_number }}

  Please review this pull request and provide feedback on:
  - Code quality and best practices
  - Potential bugs or issues
  - Performance considerations
  - Security concerns
  - Test coverage

  Use the repository's CLAUDE.md for guidance on style and conventions. Be constructive and helpful in your feedback.

  Use `gh pr comment` with your Bash tool to leave your review as a comment on the PR.

# New:
prompt: |
  # Code Review Task

  **REPO:** ${{ github.repository }}
  **PR:** ${{ github.event.pull_request.number || github.event.inputs.pr_number }}
  **COMMIT:** ${{ github.event.pull_request.head.sha }}

  ## Context

  This is the **Neon MCP Server** - a Model Context Protocol server bridging LLMs to Neon Postgres API.
  Review this PR with understanding of:
  - MCP tool/handler architecture (see CLAUDE.md lines 83-122)
  - TypeScript ES2022 + Node16 ESM requirements
  - Tool registration pattern: definitions.ts → toolsSchema.ts → handlers/ → tools.ts
  - Multi-call state management for migrations/tuning tools

  ## What's Already Automated (Don't Review)

  - ❌ Lint errors → `bun run lint` (automated by pr.yml)
  - ❌ Build failures → `bun run build` (automated by pr.yml)
  - ❌ Formatting issues → Automated

  ## Focus Your Review On (Significant Issues Only)

  1. **Architecture & Design**
     - Does new tool follow the tool registration pattern?
     - Is handler properly typed in NEON_HANDLERS?
     - Are Zod schemas correctly defined in toolsSchema.ts?

  2. **Security Vulnerabilities**
     - SQL injection risks (tool handlers using raw SQL)
     - Secrets exposure (API keys, tokens logged or returned)
     - Input validation gaps (Zod schema completeness)
     - Command injection in bash tool uses

  3. **Logic Bugs**
     - Error handling gaps (unhandled promise rejections)
     - State management issues (branch ID tracking for multi-call tools)
     - Edge cases not covered (null/undefined handling)

  4. **Performance Issues**
     - N+1 API call patterns
     - Inefficient Neon API usage
     - Missing pagination handling
     - Unnecessary data fetching

  5. **Testing Gaps**
     - Missing Braintrust evaluations for new tools
     - Uncovered edge cases in existing tests
     - Integration test scenarios missing

  6. **MCP-Specific Issues**
     - Tool descriptions not clear for LLMs
     - Missing analytics tracking (trackEvent calls)
     - Error handling doesn't use ToolError pattern
     - Missing Sentry error capture

  ## Review Instructions

  ### Step 1: Analyze the PR
  ```bash
  gh pr view ${{ github.event.pull_request.number }} --json title,body,files
  gh pr diff ${{ github.event.pull_request.number }}
  ```

  ### Step 2: Identify Significant Issues
  - Read the full diff and changed files
  - For each significant issue, note: file path, line number, severity, description
  - Only flag issues a human reviewer would care about (not lint/format)

  ### Step 3: Post Inline Comments
  For each significant issue, post an inline comment:

  ```bash
  gh api repos/${{ github.repository }}/pulls/${{ github.event.pull_request.number }}/comments \
    -f body="🔴 **[CATEGORY]**: Issue description with actionable fix" \
    -f path="relative/path/to/file.ts" \
    -F line=42 \
    -f side="RIGHT" \
    -f commit_id="${{ github.event.pull_request.head.sha }}"
  ```

  **Inline Comment Format:**
  - Use emoji severity: 🔴 Critical | 🟡 Important | 🔵 Consider
  - Start with **[Category]** (Security/Logic/Performance/Architecture/Testing)
  - Explain the issue clearly
  - Provide actionable fix or suggestion
  - Reference CLAUDE.md patterns when applicable

  **Example:**
  ```
  🔴 **[Security]**: Potential SQL injection vulnerability. User input `args.table_name` is concatenated directly into the SQL query without sanitization.

  **Fix:** Use parameterized queries or validate against a whitelist:
  ```typescript
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(args.table_name)) {
    throw new ToolError('Invalid table name');
  }
  ```

  See CLAUDE.md lines 118-120 for error handling patterns.
  ```

  ### Step 4: Post Summary Comment
  After posting inline comments, create a summary:

  ```bash
  gh pr comment ${{ github.event.pull_request.number }} --body "$(cat <<'EOF'
  ## 🤖 Claude Code Review Summary

  **Reviewed Commit:** ${{ github.event.pull_request.head.sha }}

  ### 📊 Review Statistics
  - Files Changed: X
  - Lines Reviewed: +Y / -Z
  - Issues Found: N
    - 🔴 Critical: A
    - 🟡 Important: B
    - 🔵 Consider: C

  ### 🎯 Key Findings
  1. [Brief description of most critical issue]
  2. [Second most important issue]
  3. [Third issue if applicable]

  ### ✅ What Looks Good
  - [Positive aspect 1]
  - [Positive aspect 2]

  ### 📝 Review Focus
  This review focused on architecture, security, logic, performance, and testing. Lint/build checks are automated in the pr.yml workflow.

  See inline comments above for detailed feedback on specific lines.

  ---
  *Powered by Claude Code Review*
  EOF
  )"
  ```

  ## Guidelines

  - **Be selective**: Only comment on significant issues worth a human's attention
  - **Be specific**: Reference exact lines, provide clear fixes
  - **Be constructive**: Explain the "why" behind suggestions
  - **Be project-aware**: Use CLAUDE.md patterns and terminology
  - **Don't duplicate**: Skip issues automated tools will catch
```

**Rationale**:
- Provides MCP architecture context so Claude understands the codebase
- Explicitly excludes lint/build issues to avoid duplication
- Structures review into categories (security, logic, performance, etc.)
- Gives clear format for inline comments (severity + category + fix)
- Includes example comment and summary format
- References specific CLAUDE.md sections for pattern consistency

### Success Criteria:

#### Automated Verification:
- [ ] YAML syntax is valid (multiline string properly formatted)
- [ ] GitHub Actions accepts the updated workflow
- [ ] Prompt variables resolve correctly (`${{ github.* }}`)

#### Manual Verification:
- [ ] Test PR shows Claude understands MCP architecture context
- [ ] Comments reference CLAUDE.md patterns appropriately
- [ ] Reviews focus on significant issues, not lint/format
- [ ] Inline comments use the specified format (emoji + category + fix)

---

## Phase 3: Create Test PR with Intentional Issues

### Overview
Create a test PR with intentional code issues across different categories to validate the enhanced review workflow.

### Changes Required:

#### 1. Create Test Branch
```bash
git checkout -b test/claude-review-validation
```

#### 2. Add Test File with Intentional Issues
**File**: `src/tools/handlers/test-review-tool.ts` (NEW)
**Purpose**: Test file with various intentional issues

```typescript
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
```

#### 3. Add to Tool Definitions (Incomplete Integration)
**File**: `src/tools/definitions.ts`
**Changes**: Add tool definition but intentionally miss schema/handler registration

```typescript
// Add to NEON_TOOLS array:
{
  name: 'test_review_tool' as const,
  description: 'Test tool for validating Claude Code Review',
  inputSchema: z.object({
    project_id: z.string(),
    user_name: z.string(),
  }),
}
```

**Intentionally skip:**
- ❌ Adding schema to `src/tools/toolsSchema.ts`
- ❌ Adding handler to `src/tools/tools.ts` NEON_HANDLERS

#### 4. Create PR
```bash
git add src/tools/handlers/test-review-tool.ts src/tools/definitions.ts
git commit -m "test: Add test tool with intentional issues for Claude review validation

This PR intentionally contains various code issues to test the enhanced
Claude Code Review workflow:

- Security vulnerabilities (SQL injection, hardcoded secrets)
- Logic bugs (unhandled promises, missing error handling)
- Performance issues (N+1 queries)
- Architecture issues (missing tool registration)
- MCP pattern violations (no analytics, no Sentry)

This PR should be closed after testing, not merged."

git push -u origin test/claude-review-validation
gh pr create --title "[TEST] Validate Enhanced Claude Code Review" \
  --body "Test PR for validating inline code review functionality. Contains intentional issues. **DO NOT MERGE**." \
  --label "test" \
  --draft
```

### Success Criteria:

#### Automated Verification:
- [ ] PR is created successfully and triggers workflow
- [ ] Workflow runs without errors (even if it finds issues)
- [ ] All 10 intentional issues are detected by linting/build OR Claude

#### Manual Verification:
- [ ] Claude posts inline comments on critical issues (SQL injection, hardcoded secrets)
- [ ] Comments include severity emoji (🔴, 🟡, 🔵) and category tags
- [ ] Comments provide actionable fixes with code examples
- [ ] Summary comment includes statistics and key findings
- [ ] Comments reference CLAUDE.md patterns where applicable
- [ ] Review focuses on human-judgment issues (not just lint errors)

---

## Phase 4: Iterate and Refine Based on Test Results

### Overview
Analyze test PR review results and refine the workflow prompt/configuration based on what works and what doesn't.

### Changes Required:

#### 1. Review Test PR Results
**Manual Analysis Steps:**
1. Read all inline comments posted by Claude
2. Check summary comment for completeness
3. Verify severity categorization is appropriate
4. Confirm all critical issues were caught
5. Check for false positives or missed issues

#### 2. Document Findings
**File**: `.github/REVIEW_TEST_RESULTS.md` (NEW)

```markdown
# Claude Code Review Test Results

**Test PR:** #XXX
**Date:** YYYY-MM-DD

## Inline Comments Posted

| Line | File | Severity | Category | Issue | Quality (1-5) | Notes |
|------|------|----------|----------|-------|---------------|-------|
| 12 | test-review-tool.ts | 🔴 | Security | SQL injection | 5 | Good catch, clear fix |
| ... | ... | ... | ... | ... | ... | ... |

## Summary Comment Quality

- [ ] Included file/line statistics
- [ ] Listed all critical issues
- [ ] Provided positive feedback
- [ ] Referenced automated checks appropriately

**Overall Quality:** [1-5 rating]

## Issues Caught vs Missed

### ✅ Caught by Claude:
1. SQL injection (line 12) - ✅
2. Hardcoded API key (line 18) - ✅
3. ...

### ❌ Missed by Claude:
1. [None / List any missed issues]

### False Positives:
1. [None / List any incorrect flags]

## Prompt Refinements Needed

Based on test results:
1. [Adjustment 1]
2. [Adjustment 2]

## Tool Configuration Changes

If needed:
- Adjust allowed-tools patterns
- Update permissions
- Modify timeout settings
```

#### 3. Refine Prompt Based on Findings
**File**: `.github/workflows/claude-code-review.yml`

**Common Refinements:**

If Claude is too verbose:
```yaml
## Additional Guidelines

- **Maximum 5 inline comments per file**: Focus on the most critical issues
- **Skip obvious issues**: Don't comment on issues that are self-evident
```

If Claude misses certain categories:
```yaml
## Priority Order

Review in this order:
1. 🔴 Critical security vulnerabilities (SQL injection, secrets)
2. 🔴 Critical logic bugs (crashes, data corruption)
3. 🟡 Performance issues (N+1, inefficiencies)
4. 🟡 Architecture violations (pattern mismatches)
5. 🔵 Improvements (nice-to-haves)
```

If comments lack actionability:
```yaml
## Comment Requirements

Every inline comment MUST include:
1. Clear explanation of the issue
2. Code example showing the fix
3. Reference to CLAUDE.md if pattern exists
```

#### 4. Update Workflow and Retest
```bash
# Update workflow based on findings
git checkout -b refine/claude-review-workflow
# Edit .github/workflows/claude-code-review.yml
git add .github/workflows/claude-code-review.yml
git commit -m "refine: Update Claude review prompt based on test results"
git push

# Trigger review on test PR again
gh workflow run claude-code-review.yml -f pr_number=XXX
```

### Success Criteria:

#### Automated Verification:
- [ ] Updated workflow passes YAML validation
- [ ] Subsequent runs execute without errors
- [ ] Performance is acceptable (< 5 minutes for typical PRs)

#### Manual Verification:
- [ ] Second review shows improvement over first
- [ ] Comments are more focused and actionable
- [ ] False positives are eliminated or reduced
- [ ] Critical issues are consistently caught
- [ ] Review tone is constructive and helpful

---

## Phase 5: Cleanup and Document

### Overview
Remove test files, update documentation, and finalize the enhanced review workflow.

### Changes Required:

#### 1. Clean Up Test PR
```bash
# Close and delete test PR
gh pr close XXX --delete-branch

# Or if valuable for documentation, keep it closed:
gh pr close XXX --comment "Test completed. Keeping for reference."
```

#### 2. Remove Test Files from Main Branch
**Files to remove:**
- `src/tools/handlers/test-review-tool.ts`
- Any test-only changes to `src/tools/definitions.ts`

```bash
# If test changes were merged (they shouldn't be):
git checkout main
git pull
git rm src/tools/handlers/test-review-tool.ts
# Revert changes to definitions.ts
git commit -m "chore: Remove test files from Claude review validation"
git push
```

#### 3. Update Repository Documentation
**File**: `CLAUDE.md`
**Changes**: Add section about the review workflow

```markdown
## Claude Code Review Workflow

This repository uses an enhanced Claude Code Review workflow that provides inline feedback on PRs.

### What Gets Reviewed

- Architecture and design patterns
- Security vulnerabilities
- Logic bugs and error handling
- Performance issues
- Testing gaps
- MCP-specific patterns

### What's Automated (Not Reviewed by Claude)

- Linting: `bun run lint`
- Building: `bun run build`

### Review Process

1. Workflow triggers on PR open and new commits
2. Claude analyzes the diff with full project context
3. Inline comments are posted on significant issues
4. Summary comment provides overview and statistics

### Triggering a Review

- **Automatic**: Opens when PR is created or updated
- **Manual**: Run workflow with PR number via Actions UI
- **Security**: Only runs for OWNER/MEMBER/COLLABORATOR PRs

### Review Format

Inline comments use this structure:
- **Severity**: 🔴 Critical | 🟡 Important | 🔵 Consider
- **Category**: [Security/Logic/Performance/Architecture/Testing]
- **Description**: Clear explanation of the issue
- **Fix**: Actionable code example

Example:
```
🔴 **[Security]**: SQL injection vulnerability in user input handling.

**Fix:** Use parameterized queries:
\`\`\`typescript
const result = await query('SELECT * FROM users WHERE name = $1', [userName]);
\`\`\`
```

See `.github/workflows/claude-code-review.yml` for configuration details.
```

#### 4. Add Workflow Badge to README
**File**: `README.md`
**Changes**: Add workflow status badge

```markdown
# Neon MCP Server

[![Lint and Build](https://github.com/neondatabase/mcp-server-neon/workflows/Lint%20and%20Build/badge.svg)](https://github.com/neondatabase/mcp-server-neon/actions/workflows/pr.yml)
[![Claude Code Review](https://github.com/neondatabase/mcp-server-neon/workflows/Claude%20Code%20Review/badge.svg)](https://github.com/neondatabase/mcp-server-neon/actions/workflows/claude-code-review.yml)

<!-- Existing README content -->
```

#### 5. Create Migration Guide for Team
**File**: `.github/CLAUDE_REVIEW_GUIDE.md` (NEW)

```markdown
# Claude Code Review Guide

## For PR Authors

### What to Expect

When you open a PR, Claude will:
1. Analyze your changes within 2-5 minutes
2. Post inline comments on significant issues
3. Provide a summary with statistics and key findings

### How to Respond

- **Inline comments**: Respond directly if you disagree or need clarification
- **Fix issues**: Address critical (🔴) issues before requesting human review
- **Discussion**: Claude's review is supplementary - discuss with teammates

### Limitations

Claude's review:
- Focuses on significant issues (not lint/format)
- May miss context only humans understand
- Should not replace human code review

## For Reviewers

### Using Claude's Feedback

- **Start with Claude**: Read Claude's review first to catch common issues
- **Focus your time**: Spend human review time on business logic and UX
- **Collaborate**: Use Claude's comments as discussion starting points

### When Claude Misses Things

Claude doesn't review:
- Business logic correctness (requires domain knowledge)
- UX/design decisions
- Product requirements alignment

These require human judgment.

## Adjusting the Workflow

To modify Claude's review behavior:
1. Edit `.github/workflows/claude-code-review.yml`
2. Update the prompt section (lines 52+)
3. Test on a draft PR before merging changes

Common adjustments:
- Add/remove review categories
- Adjust severity thresholds
- Modify comment format
- Change focus areas
```

### Success Criteria:

#### Automated Verification:
- [ ] Test files are removed from main branch
- [ ] README badge links work correctly
- [ ] Workflow file is in final production state

#### Manual Verification:
- [ ] Documentation is clear and comprehensive
- [ ] Team can understand how to use the review workflow
- [ ] Migration guide answers common questions
- [ ] Test PR is closed or archived appropriately

---

## Testing Strategy

### Unit Tests

Not applicable - this is a workflow configuration change, not code.

### Integration Tests

Performed via Phase 3 (test PR with intentional issues).

**Test Categories:**
1. **Security**: SQL injection, hardcoded secrets, command injection
2. **Logic**: Unhandled promises, missing error handling, incorrect types
3. **Performance**: N+1 queries, inefficient algorithms, unnecessary fetches
4. **Architecture**: Missing tool registration, pattern violations
5. **MCP Patterns**: Missing analytics, no Sentry capture, incorrect tool types

### Manual Testing Steps

1. **Create Test PR** (Phase 3)
   - Add file with 10+ intentional issues
   - Verify workflow triggers automatically
   - Wait for review to complete (~2-5 minutes)

2. **Validate Inline Comments**
   - Check that critical issues have inline comments
   - Verify comment format (severity + category + fix)
   - Confirm code examples are provided
   - Ensure CLAUDE.md patterns are referenced

3. **Validate Summary Comment**
   - Verify statistics (files, lines, issues) are present
   - Check key findings list is comprehensive
   - Confirm positive feedback is included
   - Ensure format is readable and actionable

4. **Test Edge Cases**
   - Very large PRs (20+ files)
   - PRs with only documentation changes
   - PRs from external contributors (should be blocked)
   - Manual workflow dispatch with PR number

5. **Performance Testing**
   - Measure time from PR open to review completion
   - Verify concurrency control (rapid commits cancel previous runs)
   - Check that workflow doesn't timeout (10-minute limit)

## Performance Considerations

### Workflow Execution Time

**Target**: < 5 minutes for typical PRs (5-10 files)

**Factors affecting performance:**
- PR size (number of files and lines changed)
- Claude API response time
- Number of inline comments to post
- GitHub API rate limits

**Optimizations:**
- Use batch review API (`gh api .../reviews`) instead of individual comments
- Limit to maximum N inline comments per file
- Skip files with no significant issues

### API Rate Limits

**GitHub API:**
- Authenticated requests: 5,000/hour
- Review comments: No specific limit documented

**Anthropic API:**
- Depends on account tier
- Monitor usage if many PRs are opened simultaneously

### Concurrency Control

Already implemented (lines 19-21 of workflow):
```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.event.pull_request.number }}
  cancel-in-progress: true
```

This prevents multiple simultaneous reviews of the same PR.

## Migration Notes

### For Existing PRs

- Enhanced review workflow applies to new commits only
- Old PRs won't be automatically re-reviewed
- To trigger review on old PR: manually run workflow via Actions UI

### For Team Adoption

1. **Announce Change**
   - Notify team via Slack/email about new inline review feature
   - Share `.github/CLAUDE_REVIEW_GUIDE.md` for reference

2. **Trial Period**
   - Monitor first 10-20 PRs for false positives or issues
   - Gather feedback from developers
   - Refine prompt based on team needs

3. **Feedback Loop**
   - Create issue template for workflow feedback
   - Schedule review of review quality after 1 month
   - Iterate on prompt and configuration

### Rollback Plan

If the enhanced review causes issues:

```bash
# Quick rollback: revert to single comment approach
git revert <commit-hash>
git push

# Or disable workflow entirely
# Edit .github/workflows/claude-code-review.yml:
on:
  # Comment out triggers to disable
  # pull_request:
  #   types: [opened, synchronize]
  workflow_dispatch:  # Keep manual trigger only
```

## References

- **Original workflow**: `.github/workflows/claude-code-review.yml` (current state)
- **Project docs**: `CLAUDE.md` (MCP architecture and patterns)
- **GitHub API docs**: https://docs.github.com/en/rest/pulls/comments
- **Claude Code Action**: https://github.com/anthropics/claude-code-action
- **Research findings**: (from Task agents in Phase 1)

## Open Questions

None - all decisions finalized based on user preferences:
1. ✅ Focus on significant changes only (not lint/format)
2. ✅ Use inline comments + summary
3. ✅ Avoid duplicating automated checks
4. ✅ Test with intentional issues PR
