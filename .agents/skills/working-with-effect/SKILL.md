---
name: working-with-effect
description: >-
  This repo's rules for Effect v4 code, on top of the vendored
  effect-program-design skill: how Effect code reaches Sentry, which files may
  run effects, the tool-error contract, test placement, and where the
  conventions differ from upstream. Use for any Effect code in this repo, when
  moving code onto Effect, or when reviewing an Effect change.
---

# Working with Effect in mcp-server-neon

Read [`effect-program-design`](../effect-program-design/SKILL.md) first: the service pattern, errors, observability, boundaries, and testing rules there apply here. This skill adds what is specific to this repo. `AGENTS.md` and this skill win where they differ from upstream. The anti-slop Oxlint rules that enforce much of both are in `working-with-oxlint`.

Upgrading from v3 or a v4 prerelease: [references/V4_APIS.md](references/V4_APIS.md). Auditing a package or diff for service and layer problems: [references/SERVICE_AUDIT.md](references/SERVICE_AUDIT.md).

## Services

Every service is a `Context.Service` whose constructor is its `make` effect and whose layer is `static readonly layer = Layer.effect(this, this.make)` (`anti-slop-effect/require-service-make-layer`). The key is the file path plus the class name, `@neondatabase/mcp-server-neon/<path>/<Name>` (`effecttsgo` `deterministicKeys`). Records use `type` aliases, not `interface` (`typescript/consistent-type-definitions`), so upstream examples written with `interface` become `type` here.

## Sentry

Sentry gets server failures only. Client errors, `NeonDbError`, and Neon API 4xx responses are mistakes in the call and stay out of Sentry; `handleToolError` in `mcp/server/errors.ts` holds that rule, and Effect code keeps it.

Effect code reaches Sentry through `SentryLayer` in `mcp/sentry/effect.ts`, merged into the layer an entry point runs (see `lib/http/app.ts`). It installs `OtelTracer.layerGlobal`, so `Effect.fn` and `Effect.withSpan` spans become Sentry spans under the request span, and an `ErrorReporter` that sends each reported error to `captureException`. Effect code doesn't call Sentry directly. `effect/http` reports every unhandled failure, so an error that is the caller's mistake sets `[ErrorReporter.ignore] = true`. `RouteNotFound` already does; `RequestParseError` (400) doesn't, so a route that decodes a body maps it to an ignored error. The flag only stops capture: a failure that ends an `Effect.fn` or `Effect.withSpan` span still marks the span failed, so handle a caller's mistake inside the span, as `handleToolError` does for tool spans.

`mcp/__tests__/__snapshots__/tool-error-results.json` is the contract for every failing tool call: what the client receives, whether Sentry got an event, and the tool span's status and `error.type`. A change to the tool pipeline keeps it unchanged unless the change is the point.

## Running effects

Effects run only at entry points (`eslint/no-restricted-properties` on `Effect.run*`): Next.js route files forward to the web handler in `lib/http/app.ts`. Everywhere else, compose and return the Effect.

Never fail with `new Error()` inside an Effect, including the `catch` of `Effect.tryPromise`: it widens the error channel and `catchTag` loses the discriminant.

## Tests

Tests live in `mcp/__tests__/` and `e2e/`; this repo has no `src/`. `@effect/vitest` 4.x needs vitest 5 and this repo is on vitest 4, so until that upgrade, cover Effect code through the integration and end-to-end suites. No `vi.mock`, `vi.spyOn`, or module patching in new tests (`anti-slop/no-module-mocking`).
