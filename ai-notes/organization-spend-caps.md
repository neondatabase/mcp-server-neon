# Organization spend-cap tools

The server exposes `get_organization_spend_cap`, `set_organization_spend_cap`, and `disable_organization_spend_cap` through the existing `projects` category, for connections with access to all projects. `org_id` is required. A project-scoped connection cannot manage organization billing. Read-only connections expose only get; the API requires Organization Admin permission for writes.

Set takes integer USD cents (`10000` means $100.00), never a floating-point dollar amount. Only explicit `spend_cap_enabled: true` opts in to suspension. Omit the boolean to preserve existing enforcement, or use false for notifications only. Disable preserves the current amount and notification emails with GET then PUT. It never calls DELETE, which also removes notifications. As with any read/modify/write API without conditional writes, a concurrent administrator amount change between that GET and PUT can be overwritten; use set with an explicit amount when coordinating concurrent edits.

Results show observed current-open-invoice usage, observation time, status, warning and monitoring delay, and preserve optional fields in `structuredContent.data`. Missing status is unavailable, not evidence enforcement is off or applied. Saves accept configuration asynchronously. Pending includes restriction or recovery acknowledgement; applied confirms control-plane acknowledgement, not that every workload finished stopping or resuming. Other restrictions can remain.

Billing resets on the first UTC calendar day of each month; only the current open invoice counts when plan changes produce multiple invoices. Detection can lag by 1-2 hours and bills can exceed the threshold. Storage charges continue during suspension, and deleting stored objects requires lifting the cap.

## Release prerequisites

This server change depends on the companion `neondatabase/neon-pkgs` change in `packages/tools` (branch `codex/organization-spend-caps`). Merge and publish that `@neon/tools` release first, then update the exact package pin and lockfile here to the real released version and repeat validation. The committed `2.20.0` dependency does not contain the new disable selector: this server branch is intentionally not mergeable until that release pin is added. No unpublished version or local workspace path belongs in the manifest or lockfile.

For local review, build that companion's `@neon/tools` and dependencies, pack it, and temporarily install or link the unpacked package with this server's dependencies. Keep this override outside tracked manifests; restore the published package when finished. Protocol tests run against a loopback Neon API, never a live organization's billing settings.

The backend prerequisites are Universe [schema PR 3225238](https://github.com/databricks-eng/universe/pull/3225238) followed by [application PR 3214494](https://github.com/databricks-eng/universe/pull/3214494), plus the Hadron/runtime and Function-router companions. Before enabling enforcement, service owners must verify all service gates and actual Functions runtime shutdown in staging, then follow the backend dry-run/canary rollout. MCP does not implement runtime enforcement or confirm workload shutdown.
