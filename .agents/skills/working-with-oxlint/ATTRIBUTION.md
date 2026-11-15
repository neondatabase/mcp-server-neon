# Attribution

`SKILL.md` adapts configuration and rules from the sources below. License texts are in `licenses/`. Install and run facts were verified against `oxlint` 1.91.0, `oxlint-tsgolint` 7.0.2006, `@effect/tsgo` 0.67.4, and `effect` 4.1.2.

| Source | Commit or version | License | Used for |
|---|---|---|---|
| [mattpocock/sandcastle](https://github.com/mattpocock/sandcastle) `.oxlintrc.json`, `.sandcastle/CODING_STANDARDS.md` | `14bdcdd` | MIT, Copyright (c) 2026 Matt Pocock ([licenses/mattpocock-sandcastle.txt](licenses/mattpocock-sandcastle.txt)) | Strict categories, lint ratchet, new-file caps, `Effect.run*` restriction |
| [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop) `README.md` | `13909c9` | MIT, Copyright (c) 2026 Dillon Mulroy ([licenses/dmmulroy-anti-slop.txt](licenses/dmmulroy-anti-slop.txt)) | anti-slop install, Effect rule group, analysis limits |
| [humanlayer/humanlayer](https://github.com/humanlayer/humanlayer) `.oxlintrc.jsonc` | `f9bd735` | Apache-2.0, Copyright 2025-2026 QueryTale, Inc. d/b/a HumanLayer ([licenses/humanlayer-apache-2.0.txt](licenses/humanlayer-apache-2.0.txt), [NOTICE](licenses/humanlayer-NOTICE.txt)) | Combined `effecttsgo` and anti-slop config |
| [@effect/tsgo](https://github.com/Effect-TS/tsgo) README and package | 0.67.4 | MIT, Copyright (c) 2023 Effectful Technologies Inc ([licenses/effect-tsgo.txt](licenses/effect-tsgo.txt)) | `effect-tsgo oxlint`, `patch`, supported versions, presets |
