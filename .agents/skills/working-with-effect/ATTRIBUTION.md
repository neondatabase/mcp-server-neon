# Attribution

`SKILL.md` adapts and combines material from the sources below. Files under `references/` are copied unmodified, except that `AUDIT.md` was renamed to `SERVICE_AUDIT.md`. License texts are in `licenses/`.

| Source | Commit | License | Used for |
|---|---|---|---|
| [kitlangton/skills](https://github.com/kitlangton/skills) `skills/effect` | `71195e3` | MIT, Copyright (c) 2026 Kit Langton ([licenses/kitlangton-skills.txt](licenses/kitlangton-skills.txt)) | Source rule, core defaults, boundary rules, do nots; `references/` CACHING, CONFIG, HTTP_CLIENTS, SCHEDULING, SCHEMA, SERVICES_LAYERS, STREAMS, TESTING, V4_APIS |
| [humanlayer/humanlayer](https://github.com/humanlayer/humanlayer) `.claude/skills/effect-program-design` | `f9bd735` | Apache-2.0, Copyright 2025-2026 QueryTale, Inc. d/b/a HumanLayer ([licenses/humanlayer-apache-2.0.txt](licenses/humanlayer-apache-2.0.txt), [NOTICE](licenses/humanlayer-NOTICE.txt)) | Principles, core defaults, errors, testing, review checklist; `references/DEEP_MODULES.md`. Changed: the Sentry capture rule defers to the repo's reporting policy, and the naming-convention rule is omitted. |
| [dmmulroy/skills](https://github.com/dmmulroy/skills) `effect-service-design` | `8603380` | MIT, Copyright (c) 2026 Matt Pocock, as stated in that repo's LICENSE ([licenses/dmmulroy-skills.txt](licenses/dmmulroy-skills.txt)) | Services section and module shape; `references/SERVICE_AUDIT.md` |
| [mattpocock/sandcastle](https://github.com/mattpocock/sandcastle) `.sandcastle/CODING_STANDARDS.md` | `14bdcdd` | MIT, Copyright (c) 2026 Matt Pocock ([licenses/mattpocock-sandcastle.txt](licenses/mattpocock-sandcastle.txt)) | No `new Error()` in Effects, running effects only at entry points, config layers instead of `@internal` test overrides |
