# Attribution

The general Effect guidance lives in the vendored [`effect-program-design`](../effect-program-design/SKILL.md) skill (K-Mistele/anti-slop, MIT). This skill keeps the sources below. Files under `references/` are copied unmodified, except that `AUDIT.md` was renamed to `SERVICE_AUDIT.md`, its target module shape follows the `make` and `static layer` service pattern, and `V4_APIS.md` links the effect-program-design references that replaced Kit Langton's. License texts are in `licenses/`.

| Source | Commit | License | Used for |
|---|---|---|---|
| [kitlangton/skills](https://github.com/kitlangton/skills) `skills/effect` | `71195e3` | MIT, Copyright (c) 2026 Kit Langton ([licenses/kitlangton-skills.txt](licenses/kitlangton-skills.txt)) | `references/V4_APIS.md` |
| [dmmulroy/skills](https://github.com/dmmulroy/skills) `effect-service-design` | `8603380` | MIT, Copyright (c) 2026 Matt Pocock, as stated in that repo's LICENSE ([licenses/dmmulroy-skills.txt](licenses/dmmulroy-skills.txt)) | `references/SERVICE_AUDIT.md` |
| [mattpocock/sandcastle](https://github.com/mattpocock/sandcastle) `.sandcastle/CODING_STANDARDS.md` | `14bdcdd` | MIT, Copyright (c) 2026 Matt Pocock ([licenses/mattpocock-sandcastle.txt](licenses/mattpocock-sandcastle.txt)) | No `new Error()` in Effects, running effects only at entry points |
