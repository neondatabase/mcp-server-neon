# OAuth consent UI screenshots

Reference screenshots of the `/oauth/consent` page introduced in the
"rich Next.js consent UI" PR. Re-generate with
`landing/scripts/capture-consent-screenshots.ts` after meaningful UI
changes (run a Next.js dev server, then `pnpm exec tsx
landing/scripts/capture-consent-screenshots.ts`).

| File                                | Scenario |
| ----------------------------------- | -------- |
| `01-default-full-access.png`        | Default state — MCP client requested full access, all 7 tool categories enabled. |
| `02-narrowed-categories.png`        | User narrowed to Querying + Schema and pinned a project ID. Live preview reflects the change. |
| `03-read-only-mode.png`             | User toggled to Read-only. Tools preview prunes destructive tools. |
| `04-client-pinned-project.png`      | MCP client pinned `?projectId=…` via the resource URI. Project ID input is locked, badge shows "Locked by client". |
| `05-client-pinned-categories.png`   | MCP client capped categories via `?category=querying&category=schema`. Only those two render. |
| `06-readonly-locked.png`            | MCP client mandated read-only via `?readonly=true`. Full access option is disabled. |
