# OAuth consent UI screenshots

Reference screenshots of the `/oauth/consent` page introduced in the
"rich Next.js consent UI" PR. Re-generate via the
[`agent-browser`](https://www.npmjs.com/package/agent-browser) global
CLI:

```sh
# in one terminal — start the dev server with .env.e2e exported
cd landing && env $(cat .env.e2e | grep -v '^#' | xargs -L1) \
  pnpm exec next dev --port 3100

# in another terminal — capture the 6 scenarios
cd landing && ./scripts/capture-consent-screenshots.sh
```

The script produces PNGs in `/tmp/consent-screenshots/` by default; copy
them over the files in this directory once you're happy with the
output. The `agent-browser` daemon persists across commands; the script
calls `agent-browser close --all` at the end so a fresh run starts
clean.

| File                                | Scenario |
| ----------------------------------- | -------- |
| `01-default-full-access.png`        | Default state — MCP client requested full access, all 7 tool categories enabled. |
| `02-narrowed-categories.png`        | User narrowed to Querying + Schema and pinned a project ID. Live preview reflects the change. |
| `03-read-only-mode.png`             | User toggled to Read-only. Tools preview prunes destructive tools. |
| `04-client-pinned-project.png`      | MCP client pinned `?projectId=…` via the resource URI. Project ID input is locked, badge shows "Locked by client". |
| `05-client-pinned-categories.png`   | MCP client capped categories via `?category=querying&category=schema`. Only those two render. |
| `06-readonly-locked.png`            | MCP client mandated read-only via `?readonly=true`. Full access option is disabled. |
