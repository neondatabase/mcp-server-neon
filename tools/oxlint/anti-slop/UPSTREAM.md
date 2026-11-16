# Upstream

- Source: [K-Mistele/anti-slop](https://github.com/K-Mistele/anti-slop) at commit `b7c1619b4d51b4815e89ba3700a975a6ec54b8c3`, copied with `skills/install-anti-slop/scripts/install.mjs` (no `--jev`). It forked from [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop) at `f87211b`.
- Merged on top: `rules/require-readable-spacing.ts`, `vendor/eslint-stylistic/padding-line-between-statements.ts`, and `vendor/eslint-stylistic/UPSTREAM.md` from dmmulroy/anti-slop `13909c9e07590f5a85d93c62712259fe14a883f7`, the previous base of this copy. The fork has not changed those files since `f87211b`.
- License: MIT, in [LICENSE](LICENSE).
- Plugins: `./tools/oxlint/anti-slop/index.ts`, `./tools/oxlint/anti-slop/effect/index.ts`, and `./tools/oxlint/anti-slop/martinfowler/index.ts`, registered in `.oxlintrc.json`. `jev/` and `diff-rules/` are copied but not registered.
- Deviations: none.
