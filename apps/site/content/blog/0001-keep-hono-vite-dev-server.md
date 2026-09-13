---
title: '@hono/vite-dev-server Evaluation'
date: '2026-04-28'
lang: 'en'
type: 'adr'
tags: ['architecture', 'decision']
draft: false
---

## Status: ✅ **KEPT** — Recommended retention

## What It Is

Official Hono × Vite development integration plugin.
Provides:

- **Middleware Mode**: Vite handles static assets; Hono handles API/SSR routes via Vite's `server.middlewareMode`
- **HMR (Hot Module Replacement)**: Instant updates during development without full page reloads
- **Entry Point Injection**: Auto-injects client-side `<script>` for module reloading
- **SSR Streaming**: Streams SSR responses through Vite dev server

## Current Usage

```
packages/less-core/src/index.ts  →  import honoDevServer from '@hono/vite-dev-server'
                                   →  honoDevServer({ entry: VIRTUAL_ENTRY_ID, injectClientScript: true })
packages/less-core/vite.config.build.ts →  external: ['@hono/vite-dev-server']  (dev-only!)
```

## Why It Exists (Not Removed)

### The Alternative: Manual Implementation

To replace `@hono/vite-dev-server`, LessJS would need a custom Vite plugin that:

| Feature                        |  Lines of Code | Complexity | Maintenance Risk                         |
| ------------------------------ | -------------: | ---------: | ---------------------------------------- |
| Middleware mode setup          |            ~20 |     Medium | Vite API changes between versions        |
| HMR client injection           |            ~15 |       High | Must track Vite's HMR protocol changes   |
| SSR transform pipeline         |            ~30 |  Very High | Must handle ESM/CJS interop, source maps |
| Request forwarding (Vite→Hono) |            ~25 |     Medium | Edge cases with streaming, headers       |
| Error overlay integration      |            ~10 |        Low | Nice-to-have but expected                |
| **Total**                      | **~100 lines** |   **High** | **Ongoing**                              |

### Cost-Benefit Analysis

| Factor              |        Keep Plugin         |   Remove & Reimplement    |
| ------------------- | :------------------------: | :-----------------------: |
| Bundle size impact  |      **0** (dev-only)      |           **0**           |
| Dependency count    |         +1 npm dep         |        -1 npm dep         |
| Code to maintain    |      ~5 lines (usage)      |     ~100 lines (impl)     |
| HMR reliability     | Battle-tested (Hono team)  |       Custom = bugs       |
| Vite version compat |   Maintained by authors    | We track breaking changes |
| DX quality          | Excellent (instant reload) |    Degraded or broken     |
| **Verdict**         |         **✅ Win**         |        **❌ Lose**        |

## Honest Counter-arguments (Why ANALYSIS Marked This P3)

1. **"One less dependency"** — Valid concern, BUT this dep is:
   - Dev-only (zero production footprint)
   - From Hono's own org (not a random package)
   - Already a transitive dep of `hono` ecosystem users likely have

2. **"Locks us to Hono"** — True, but LessJS _is_ a Hono framework.
   Replacing Hono would require rewriting everything regardless of this plugin.

3. **"Could break on Vite major bumps"** — True, but:
   - The Hono team maintains this plugin alongside their framework
   - Our alternative implementation would break just as often (or worse)

## Production Footprint: Zero

```bash
# Build output analysis (vite.config.build.ts):
external: ['@hono/vite-dev-server']  # ← Never bundled into SSR/client chunks
```

The plugin is only loaded when `vite dev` runs (command === 'serve').
In `vite build`, the import is tree-shaken and the package never touched.

## Conclusion

> **Keep @hono/vite-dev-server.** The tradeoff heavily favors retention:
> zero production cost vs. ~100 lines of custom maintenance code,
> battle-tested HMR vs. home-grown bugs, and official support vs.
> tracking Vite internal APIs across versions.
>
> If a future requirement forces removal (e.g., switching from Hono),
> the replacement cost is well-documented above (~100 lines).

---

_Evaluated: 2026-04-28 | Version reviewed: @hono/vite-dev-server@^0.25.3_
