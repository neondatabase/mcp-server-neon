---
name: working-with-oxlint
description: >-
  Setting up and running Oxlint in a TypeScript repo: type-aware linting with
  oxlint-tsgolint, the strict all-categories config with a shrink-only lint
  baseline (Matt Pocock's sandcastle), Effect rules from @effect/tsgo, and
  Dillon Mulroy's vendored anti-slop rules. Use when adding or changing Oxlint,
  .oxlintrc.json, or oxlint.config.ts, when a repo moves from ESLint to Oxlint,
  or when linting Effect code.
---

# Working with Oxlint

This repo's setup: `.oxlintrc.json` (every category but `restriction` and `nursery`, the `@effect/tsgo` recommended preset, and anti-slop vendored in `tools/oxlint/anti-slop/`), and `pnpm lint` runs `scripts/lint-ratchet.ts`, which holds violations to the shrink-only `scripts/lint-baseline.json`. Sources and licenses are in [ATTRIBUTION.md](ATTRIBUTION.md). Effect coding rules are `working-with-effect`; this skill covers the linter that enforces them.

## Install and run

Install `oxlint` and, for type-aware rules, `oxlint-tsgolint` as exact-pinned dev dependencies. Type-aware rules (`typescript/no-floating-promises` and the `effecttsgo/*` rules) run when the config sets `options.typeAware` or the CLI gets `--type-aware`. The project needs no `typescript` dependency for this; tsgolint brings typescript-go.

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "options": { "typeAware": true, "reportUnusedDisableDirectives": "error" }
}
```

The config is `.oxlintrc.json` (comments and trailing commas allowed) or `oxlint.config.ts` with `defineConfig` from `oxlint`. Useful flags: `-c <config>`, `--fix`, `--deny-warnings`, `--max-warnings=<n>`, `--rules` to list registered rules, `--init` for a default config.

## Strict config with a lint ratchet

Matt Pocock's sandcastle sets every category except `restriction` and `nursery` to `error`, then cherry-picks useful `restriction` rules. `restriction` bans ordinary language features, and `nursery` rules change between releases.

```json
{
  "plugins": ["eslint", "typescript", "unicorn", "oxc", "import", "promise", "node", "vitest"],
  "categories": { "correctness": "error", "suspicious": "error", "pedantic": "error", "perf": "error", "style": "error" }
}
```

Violations that existed when the config landed are counted per file and rule in a baseline that only shrinks (sandcastle's `scripts/lint-ratchet.ts` and `scripts/lint-baseline.json`):

- A new violation fails, whether a count goes up or a file or rule appears that the baseline lacks. Fix it; never raise the baseline.
- Disable comments (`eslint-disable`, `oxlint-disable`, `@ts-ignore`, `@ts-expect-error`, `@effect-diagnostics`) fail outside a reviewed allowlist.
- The config may loosen rules only in reviewed override groups (sandcastle has five: entry points, tests, tooling scripts, `src/`, and templates), and the ratchet rejects any other override.
- Pay debt one rule or one file per PR; an `oxlint --fix` sweep of one rule across the repo is fine.

A new file has no baseline, so it meets every cap at zero. The caps a new sandcastle `src/` file hits first are `import/max-dependencies` 10, `max-lines` 300, `max-lines-per-function` 50, `max-statements` 20, and `complexity` 15.

Sandcastle restricts running effects to entry points with `eslint/no-restricted-properties`. It lists `runPromise`, `runPromiseExit`, `runSync`, `runSyncExit`, `runFork`, and `runCallback`, each with the same message:

```json
"eslint/no-restricted-properties": ["error", {
  "object": "Effect",
  "property": "runPromise",
  "message": "Run Effects only at an entry point (the public promise API or the CLI). Compose and return the Effect instead."
}]
```

Entry-point files, and tests, get the rule turned off in their reviewed `overrides` groups. The ratchet keeps the entry-point file list in sync with its `ENTRY_POINTS`:

```json
"overrides": [
  {
    "files": ["src/main.ts", "src/run.ts"],
    "rules": { "eslint/no-restricted-properties": "off" }
  }
]
```

## Effect rules: @effect/tsgo

`@effect/tsgo` (the Effect Language Service for TypeScript-Go) adds the type-aware `effecttsgo` plugin, with rules such as `floating-effect`, `missing-effect-error`, `missing-layer-context`, `outdated-api`, and `global-timers-in-effect`. Stock `oxlint` rejects it with `Unknown plugin: 'effecttsgo'`, so install `@effect/tsgo` as an exact-pinned dev dependency and run Oxlint through its local launcher. Without the local install, a bare `npx effect-tsgo` resolves the unscoped npm package `effect-tsgo` instead, so keep `--no-install` (or use `pnpm exec`):

```bash
npx --no-install effect-tsgo oxlint --type-aware
```

`effect-tsgo patch` patches `node_modules` instead, and only `patch` adds the `effecttsgo` types to `oxlint.config.ts`. Each release supports specific Oxlint and `oxlint-tsgolint` versions: 0.67.4 supports Oxlint 1.88.0–1.91.0 and tsgolint 7.0.2004–7.0.2006, while Oxlint `latest` is 1.92.0. Check the `@effect/tsgo` README table before bumping either.

Presets ship as `antipattern`, `correctness`, `effect-native`, `maintainers`, `recommended`, `strict`, and `style`:

```json
{
  "extends": ["./node_modules/@effect/tsgo/oxlint-presets/recommended.json"],
  "options": { "typeAware": true }
}
```

HumanLayer instead lists `effecttsgo` in `plugins` and sets each `effecttsgo/*` rule individually.

## anti-slop

Dillon Mulroy's anti-slop is a set of Oxlint JS-plugin rules that reject low-evidence TypeScript, such as chained type assertions, `unknown` parameters and returns, module mocking, and ad hoc `typeof` narrowing. It is meant to be vendored: there is no npm package. Install it with its skill, which copies `src/` to `tools/oxlint/anti-slop/`, installs `@oxlint/plugins` at exactly the resolved Oxlint version, and merges the config:

```bash
npx skills add dmmulroy/anti-slop --skill install-anti-slop
```

Its Effect rules are a separate opt-in plugin:

```json
{
  "jsPlugins": [
    { "name": "anti-slop", "specifier": "./tools/oxlint/anti-slop/index.ts" },
    { "name": "anti-slop-effect", "specifier": "./tools/oxlint/anti-slop/effect/index.ts" }
  ],
  "rules": {
    "anti-slop-effect/no-manual-effect-error-tag": "error",
    "anti-slop-effect/no-manual-tag-comparison": "error",
    "anti-slop-effect/no-manual-tagged-construction": "error",
    "anti-slop-effect/no-service-constructor-imports": "error",
    "anti-slop-effect/prefer-effect-match": "error"
  }
}
```

Add `tools/oxlint/anti-slop/**` and the agent directories (`.agents/**`, `.cursor/**`, `.claude/**`) to `ignorePatterns`. The rules are syntactic: they use Oxlint's ESTree and scope APIs, don't resolve imported types, and recognize `Effect.catch*` and `Match.when` only under those exact identifiers. To update, ask the skill to update while preserving local customizations; it doesn't force-replace the vendored copy.

HumanLayer combines all three: `typeAware`, plugins `typescript`, `react`, `oxc`, `vitest`, and `effecttsgo`, vendored anti-slop, the type-aware `typescript/no-floating-promises` and `no-misused-promises`, and the syntactic `typescript/no-explicit-any`, `no-non-null-assertion`, and `oxc/no-barrel-file`, all as errors.
