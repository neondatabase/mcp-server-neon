---
name: working-with-effect
description: >-
  Writing, reviewing, and testing Effect v4 TypeScript: services and layers,
  schemas, tagged errors, Config, schedules, streams, caches, HTTP clients, and
  @effect/vitest tests. Combines the Effect skills and coding standards of Kit
  Langton, HumanLayer, Dillon Mulroy, and Matt Pocock. Use for any Effect code,
  when refactoring a codebase onto Effect, or when auditing an Effect service.
---

# Working with Effect

These rules combine four sources (see [ATTRIBUTION.md](ATTRIBUTION.md)). A repo's own `AGENTS.md` and established Effect conventions take precedence unless the task is changing them. Linting that enforces much of this is `working-with-oxlint`.

## Source rule

Check these before guessing an API:

- the nearest `AGENTS.md` and any project-local Effect practices doc
- the installed `effect` and `@effect/*` versions and their declarations
- the Effect v4 docs at <https://effect-ts-effect-smol.mintlify.app/>
- upstream Effect source when the installed package doesn't settle it

The references were reviewed against Effect 4.0.0. The installed version wins: prerelease APIs and import paths differ. Unstable modules (`effect/http`, `effect/rpc`, `effect/process`) can change between minors, so typecheck examples against the installed version. Upgrading from v3 or a v4 prerelease: read [references/V4_APIS.md](references/V4_APIS.md) first.

## References

Read only the matching files; read all of them when work crosses concerns.

- Creating or changing a service or layer: [DEEP_MODULES.md](references/DEEP_MODULES.md), then [SERVICES_LAYERS.md](references/SERVICES_LAYERS.md)
- Auditing a codebase, package, or diff for service and layer problems: [SERVICE_AUDIT.md](references/SERVICE_AUDIT.md)
- Data models, brands, variants, optional keys, decoders: [SCHEMA.md](references/SCHEMA.md)
- Runtime config, env vars, `ConfigProvider`: [CONFIG.md](references/CONFIG.md)
- Retry, repeat, polling, backoff, workers: [SCHEDULING.md](references/SCHEDULING.md)
- Memoization, TTL caches, request dedupe, batching: [CACHING.md](references/CACHING.md)
- Streams, queues, pubsub, pagination, backpressure: [STREAMS.md](references/STREAMS.md)
- Outgoing HTTP, status handling, HTTP retry: [HTTP_CLIENTS.md](references/HTTP_CLIENTS.md)
- Tests, time, concurrency synchronization, fakes: [TESTING.md](references/TESTING.md)

## Principles

1. **Deep modules.** The interface is the cost and the hidden implementation is the benefit. Public operations take domain inputs and return domain values; callers never supply credentials, clients, rows, or other internals.
2. **Everything stays in Effect.** Expected failures stay in `E`, dependencies in `R`, resources in scopes. Don't pass services, layers, effects, or errors as ordinary values when composition expresses the relationship.
3. **Two-tier errors.** Classify rich internal failures, then narrow to a small caller-actionable union per operation. Log with `Effect.logError` before narrowing or swallowing; don't pass in external loggers.
4. **Observe operations.** Every public operation has a stable `Effect.fn("Domain.operation")`, an explicit `Effect.withSpan`, or both.
5. **Parse, don't validate.** Decode at trust boundaries (non-Effect callers, databases, networks) with Schema.
6. **Use Effect platform services.** Application code uses Effect's `FileSystem`, `Path`, `Crypto`, HTTP, process, and socket services. Native Node APIs belong only in runtime adapters.

HumanLayer also captures every error to Sentry where it surfaces. Follow the repo's reporting policy instead where one exists: mcp-server-neon keeps client errors and `NeonDbError` out of Sentry (`mcp/server/errors.ts`).

## Core defaults

- Compose workflows with `Effect.gen(function* () { ... })`.
- Define public and non-trivial internal service methods with `Effect.fn("Domain.operation")`. Use `Effect.fnUntraced` only for internal helpers that intentionally skip span metadata.
- Define services with `Context.Service`, build them with `Layer.effect(Service, Effect.gen(...))` (or `Layer.scoped` for acquisition), and return `Service.of({ ... })`.
- Model records with `Schema.Struct(...)` plus a same-name `interface`. Use `Data.TaggedEnum` for trusted internal control flow and Schema tagged variants or unions for encoded boundaries.
- Use a named input object for every operation, even with one argument, so same-typed positional arguments can't be swapped.
- Decode unknown wire input with `Schema.decodeUnknownEffect(...)`; use `schema.makeEffect(...)` for typed input that needs validation. Reserve throwing `schema.make(...)` for trusted construction.
- Prefer `Predicate` refinements over ad hoc `typeof`, `instanceof`, nullish, and property-presence checks on trusted values, and exhaustive `Match` for multi-branch dispatch.
- Read runtime config through `Config`, never `process.env` in application logic, and keep secrets `Redacted` until the adapter call.
- Use `Schedule` for retry, repeat, and polling, and `Stream` for many-valued, backpressured sources.
- Use bounded concurrency, bounded and idempotent retries, scoped background fibers, and explicit finalizers.

## Services

A service is an authority seam: a cohesive capability whose requirements propagate through Effect context. It earns a tag only if it owns at least one of these:

- authority over persistence, credentials, external I/O, runtime resources, configuration, time, randomness, or lifecycle
- effect sequencing or policy reused across entrypoints
- state or behavior with real production and test variation
- enough implementation that deleting it would spread complexity into callers (the deletion test)

Use an existing Effect service (`Clock`, `Crypto`, `Random`, `Config`, `HttpClient`, `FileSystem`, `Path`) before defining one. Keep parsed inputs, per-call data, pure calculations, per-call options, and wrappers that only forward another service as values or pure modules. A test-only desire to inject a value is not enough.

Module shape, following the project's established equivalent:

```ts
export interface Interface {
  readonly operation: (input: Input) => Effect.Effect<Output, OperationError>
}

export class Service extends Context.Service<Service, Interface>()(
  "@app/Capability",
) {}

export const make: Effect.Effect<Service["Service"], never, Dependency.Service> =
  Effect.gen(function* () {
    const dependency = yield* Dependency.Service

    const operation = Effect.fn("Capability.operation")(function* (input: Input) {
      return yield* dependency.operation(input)
    })

    return Service.of({ operation })
  })

export const layerWithoutDependencies = Layer.effect(Service, make)

export const layer = layerWithoutDependencies.pipe(Layer.provide([Dependency.layer]))
```

Composition roots select and provide concrete layers, and each service's layer is provided once during runtime construction. Yield stable dependencies while building the layer; yield request- or operation-scoped context inside the method. Name a test layer `layerTest` for a static substitute and `layerMemory` only when it faithfully implements the contract in memory.

When a test needs to override behavior, give the function a config layer and instantiate it differently in tests, rather than adding `@internal` override properties. Don't make that layer optional.

## Errors

- Use `Schema.TaggedError` for network, RPC, queue, workflow, and other boundary-facing errors. `Data.TaggedError` is fine for internal-only failures.
- Never fail with `new Error()` inside an Effect, including the `catch` of `Effect.tryPromise`. It widens the error channel and `catchTag` loses the discriminant:

```ts
Effect.tryPromise({
  try: () => doThing(),
  catch: (e) => new WorktreeError({ message: `Failed: ${e instanceof Error ? e.message : String(e)}` }),
})
```

- Recover with `Effect.catchTag` or `catchTags`, and `Effect.catchReason` for a tagged `error.reason`. Never compare `_tag` manually or branch on `instanceof` to recover.
- Catch or retry only where the boundary has a truthful response, retry only proven-idempotent operations, and let exhausted failures stay visible unless there is a real fallback.

## Running effects

Run effects only at entry points: the public promise API, the CLI, or the transport handler. Everywhere else, compose and return the Effect. A promise-returning function delegates to Effect immediately; more than one `runPromise` inside a single function means it needs refactoring. Effect stays out of a user-facing API that promises a plain TypeScript interface.

## Boundaries

- Keep HTTP handlers thin: decode input, read context, call services, map typed errors to transport responses.
- Wrap HTTP clients, SDKs, CLIs, and external integrations in named effects at adapter boundaries. Return domain values, never SDK response objects or raw rows.
- Decode persisted rows with Schema when values are not trivially trusted.
- Keep provider and network calls outside authoritative database transactions.

## Testing

- Use `@effect/vitest` `it.effect`; use `it.live` only when live runtime behavior is under test.
- Use `TestClock`, `Deferred`, `Queue`, `Latch`, and `Ref` instead of sleeps and timing races.
- Use a real ephemeral database for SQL, constraints, transactions, and state transitions.
- Substitute layers at real seams. Test services and recording fakes live only in test files or test utilities.
- No `vi.mock`, `vi.spyOn`, module patching, or method spies.
- Assert both the result or error and the externally visible end state.

## Do nots

- No `as any`, non-null assertions, or unchecked casts to silence Effect typing; `as const` is fine.
- No `Schema.Class` or `Schema.TaggedClass` as the default data-modeling pattern.
- No hand-rolled `_tag` error classes or literal `_tag` objects when `Schema.TaggedError`, a tagged class, or `Data.taggedEnum` fits.
- No cause-level recovery when typed-error recovery is enough.
- No `Layer.mergeAll(...)` or `provideMerge(...)` as make-it-compile tools.
- No required authority, credentials, persistence, or transports hidden behind `Context.Reference` defaults.
- No hand-rolled Map/TTL caches or in-flight dedupe when `effect/Cache` fits.

## Review checklist

- [ ] The public surface is small, domain-shaped, and hides implementation knowledge.
- [ ] Each method exposes a narrow caller-actionable error union, and no Effect fails with a raw `Error`.
- [ ] Every public operation has a stable trace boundary.
- [ ] Dependencies are in `R`; resources and background work have scoped owners; each layer is provided once.
- [ ] Unknown input is decoded; secrets stay `Redacted`; raw rows and SDK values don't cross public seams.
- [ ] No code compares `_tag` manually; recovery uses `catchTag`.
- [ ] Effects run only at entry points.
- [ ] Native platform APIs sit behind Effect services.
- [ ] Retries are bounded and idempotent; concurrency and buffering are bounded.
- [ ] Tests use real seams and deterministic synchronization, and assert end state.
