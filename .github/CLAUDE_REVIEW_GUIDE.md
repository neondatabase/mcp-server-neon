# Claude Code Review Guide

This repository uses an enhanced Claude Code Review workflow that provides inline feedback on pull requests using AI-powered code analysis.

## For PR Authors

### What to Expect

When you open a PR in this repository, Claude will:

1. **Analyze your changes** within 2-5 minutes
2. **Post inline comments** on specific lines with significant issues
3. **Provide a summary** with statistics and key findings

### Inline Comment Format

Claude's inline comments follow this structure:

- **Severity Emoji**: 🔴 Critical | 🟡 Important | 🔵 Consider
- **Category**: [Security], [Logic], [Performance], [Architecture], [Testing]
- **Description**: Clear explanation of the issue
- **Fix**: Actionable code example or suggestion

### Example Inline Comment

```
🔴 **[Security]**: Potential SQL injection vulnerability. User input is concatenated directly into SQL query.

**Fix:** Use parameterized queries:
```typescript
const result = await query('SELECT * FROM users WHERE name = $1', [userName]);
```

Reference: See CLAUDE.md lines 118-120 for error handling patterns.
```

### How to Respond

- **Address Critical Issues (🔴)** before requesting human review
- **Discuss Important Issues (🟡)** with your team for context
- **Consider improvements (🔵)** for future refactoring
- **Question comments**: Reply directly on the inline comment for discussion

### Limitations

Claude's review:
- Focuses on **significant issues** (not lint/format)
- May miss **business logic context** only humans understand
- Should **not replace human code review** - use as a first-pass filter
- Respects **CLAUDE.md conventions** but isn't perfect
- Focuses on **MCP architecture patterns** specific to this project

### What Claude Does NOT Review

These are automated by other workflows:
- Linting errors → `bun run lint` (automated in pr.yml)
- Build failures → `bun run build` (automated in pr.yml)
- Formatting issues → Automated formatting checks

Claude focuses on **human judgment** areas: architecture, security, logic, performance, and testing.

## For Reviewers

### Using Claude's Feedback

1. **Start with Claude's comments** - they provide a quick first pass
2. **Focus your human review** on business logic and product requirements
3. **Use Claude's findings** as discussion starting points with the author

### Claude's Strengths

- Catches common security issues (SQL injection, hardcoded secrets)
- Identifies architectural pattern violations
- Flags missing error handling
- Spots potential N+1 query problems
- References project-specific patterns (CLAUDE.md)

### Claude's Limitations

Claude cannot evaluate:
- **Business correctness**: Does this implement the right feature?
- **UX/Design decisions**: Is this the best user experience?
- **Product requirements**: Does this meet the brief?
- **Domain knowledge**: Is this financially/medically/legally correct?

These require human judgment.

### Review Workflow

1. Read Claude's inline comments first
2. Check the summary for severity breakdown
3. Verify critical issues (🔴) are addressed
4. Perform human review on remaining code
5. Focus on business logic and product goals

## Understanding the Review Workflow

### What Triggers a Review

- **Automatic**: When a PR is opened or new commits are pushed
- **Manual**: Run the workflow manually via GitHub Actions UI with a PR number
- **Security**: Only runs for OWNER/MEMBER/COLLABORATOR PRs (blocks external contributions)

### Review Categories

Claude reviews code in these categories:

1. **Architecture & Design**
   - Tool registration pattern compliance
   - Handler typing in NEON_HANDLERS
   - Zod schema correctness

2. **Security Vulnerabilities**
   - SQL injection risks
   - Secrets exposure
   - Input validation gaps
   - Command injection

3. **Logic Bugs**
   - Error handling gaps
   - State management issues
   - Edge case handling
   - Null/undefined checks

4. **Performance Issues**
   - N+1 API calls
   - Inefficient Neon API usage
   - Missing pagination
   - Unnecessary fetching

5. **Testing Gaps**
   - Missing Braintrust evaluations
   - Uncovered edge cases
   - Integration test scenarios

6. **MCP-Specific Issues**
   - Tool descriptions clarity
   - Missing analytics tracking
   - ToolError pattern compliance
   - Missing Sentry capture

## Adjusting the Workflow

To modify Claude's review behavior:

1. Edit `.github/workflows/claude-code-review.yml`
2. Update the `prompt:` section (lines 52+)
3. Test on a draft PR before merging changes

### Common Adjustments

**To focus on specific categories:**
```yaml
## Focus Areas
Review these categories in priority order:
1. Security (SQL injection, secrets, input validation)
2. Architecture (tool registration, patterns)
3. Logic bugs (error handling, state management)
```

**To be more/less strict:**
```yaml
## Issue Threshold
Only comment on issues that:
- Affect multiple files
- Have security implications
- Break established patterns
```

**To adjust comment format:**
```yaml
**Inline Comment Requirements:**
Every comment MUST include:
1. Issue explanation
2. Code example
3. CLAUDE.md reference
```

## For Repository Maintainers

### Monitoring Review Quality

1. Check PR comments for relevance and accuracy
2. Look for false positives (incorrect flags)
3. Identify patterns in missed issues
4. Gather feedback from team

### Refining the Prompt

If Claude is:
- **Too verbose**: Add max comment limit per file
- **Missing categories**: Update focus areas section
- **Not specific enough**: Add requirement for code examples
- **Incorrect patterns**: Reference specific CLAUDE.md lines

### Performance Management

- Typical PR review time: 2-5 minutes
- Large PRs (20+ files) may take longer
- Concurrency control prevents multiple simultaneous reviews
- GitHub API rate limits are typically not hit

## Rollback Plan

If the enhanced review causes issues:

```bash
# Quick rollback: revert to previous version
git revert <commit-hash>
git push

# Or disable workflow temporarily
# Edit .github/workflows/claude-code-review.yml:
on:
  # Comment out automatic triggers:
  # pull_request:
  #   types: [opened, synchronize]
  workflow_dispatch:  # Keep manual trigger only
```

## References

- **Workflow Configuration**: `.github/workflows/claude-code-review.yml`
- **Project Architecture**: `CLAUDE.md` (lines 83-122)
- **Tool Registration Pattern**: See CLAUDE.md "Adding New Tools" section
- **GitHub API Docs**: https://docs.github.com/en/rest/pulls/comments
- **Claude Code Action**: https://github.com/anthropics/claude-code-action

## Feedback and Questions

If you have questions about Claude's review:

1. **Reply on the comment** with context or disagreement
2. **Open an issue** if you think the workflow needs adjustment
3. **Check CLAUDE.md** for project-specific patterns
4. **Reference line numbers** when discussing code patterns

---

*Enhanced Claude Code Review helps catch issues automatically while letting humans focus on business logic and product decisions.*
