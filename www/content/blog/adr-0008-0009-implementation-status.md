---
title: 'ADR 0008/0009/0010/0011/0012 — Implementation Status'
date: '2026-05-11'
lang: 'en'
type: 'adr'
tags: ['architecture', 'decision']
draft: false
archived: true
---

## Summary

ADR 0008 + 0009 + 0010 + 0011 + 0012 fully implemented on the `dev` branch.

- All `.less/` temp files eliminated (ADR 0010)
- All `globalThis[Symbol.for()]` bridges eliminated (ADR 0011 + 0012)
- `lessjs()` unified entry extracted to `@openelement/app` (ADR 0012)
- Build pipeline: single `viteBuild()` + closeBundle inline Phase 2/3 (ADR 0011)

## Completed Phases

### Phase A: Eliminate `.less/` File IPC → `LessBuildContext` + Virtual Modules + Define Injection

| Step | Status | Commit    | Description                                               |
| ---- | ------ | --------- | --------------------------------------------------------- |
| A.1  | ✅     | `85f3131` | Expand `LessBuildContext` with 20+ fields                 |
| A.2  | ✅     | `a1ab6ef` | `lessContent()` writes to `ctx` instead of `.less/` files |
| A.3  | ✅     | `605c249` | `lessI18n()` writes to `ctx` instead of `.less/` files    |
| A.4  | ✅     | `2e5e1aa` | `less:build` writes metadata to `ctx` + fallback          |
| A.5  | ✅     | `eb965a1` | Unified `build.ts` orchestrator with shared `ctx`         |
| A.6  | ✅     | `eb965a1` | `buildClient()`/`buildSSG()` read from `ctx` (preferred)  |
| A.7  | ✅     | `0acd4b7` | `headExtras` via Vite `define` injection                  |
| A.8  | ✅     | `eb965a1` | Cleaned up `.less/` references (see known limits)         |

### Phase D: Replace `runtime-shim.ts` with `virtual:less-runtime`

| Step    | Status | Commit    | Description                                                   |
| ------- | ------ | --------- | ------------------------------------------------------------- |
| D.1+D.3 | ✅     | `1bf6d6a` | `virtual:less-runtime` replaces `.less-runtime.ts` file write |
| D.2     | ✅     | `52f9e11` | Virtual runtime plugin added to SSR build                     |

### Phase E: Single-Plugin API (`lessjs()`) → Extracted to `@openelement/app`

| Step | Status | Description                                                |
| ---- | ------ | ---------------------------------------------------------- |
| E.1  | ✅     | `lessjs()` umbrella function created in `@openelement/app`      |
| E.2  | ✅     | `less()` accepts optional `externalCtx` parameter          |
| E.3  | ✅     | Backward compat: split-call mode works with explicit `ctx` |
| E.4  | ✅     | Unified `build` command via closeBundle (ADR 0011)         |

### ADR 0011: Eliminate Last globalThis Bridge via closeBundle Inline

| Step | Status | Description                                                 |
| ---- | ------ | ----------------------------------------------------------- |
| 1    | ✅     | Phase 2/3 inlined in closeBundle(), cli/build.ts simplified |
| 2    | ✅     | globalThis write removed from less() in index.ts            |
| 3    | ✅     | clearActiveContext() removed from build.ts                  |

### ADR 0012: Extract lessjs() Umbrella to @openelement/app

| Step | Status | Description                                                                              |
| ---- | ------ | ---------------------------------------------------------------------------------------- |
| 1    | ✅     | New `@openelement/app` package with static imports                                            |
| 2    | ✅     | `lessjs()` removed from core/index.ts                                                    |
| 3    | ✅     | `getActiveContext`/`setActiveContext`/`clearActiveContext` deleted from build-context.ts |
| 4    | ✅     | content/i18n: `options.ctx                                                               |
| 5    | ✅     | docs/vite.config.ts switched to `lessjs()` from `@openelement/app`                            |
| 6    | ✅     | `LessContentOptions` exported from `@openelement/content`                                     |

### ADR 0010: Eliminate All Remaining `.less/` Temp Files

| Step | Status | Commit    | Description                                                  |
| ---- | ------ | --------- | ------------------------------------------------------------ |
| 1    | ✅     | `c9cbe61` | `virtual:less-client-entry` replaces `.less-client-entry.ts` |
| 2    | ✅     | `c9cbe61` | `virtual:less-ssg-entry` replaces `.less-ssg-entry.ts`       |
| 3    | ✅     | `c9cbe61` | Remove `build-metadata.json` file write from `build.ts`      |
| 4    | ✅     | `c9cbe61` | Remove all `.less/` fallback reads from `build-ssg.ts`       |
| 5    | ✅     | `c9cbe61` | Clean up unused imports, fix lint                            |

## Key Results

- **`.less/` files reduced**: 10 → 3 → **0** (zero filesystem IPC)
- **`globalThis` bridges**: 4 → 1 → **0** (all deleted, ctx via explicit parameter only)
- **Virtual modules**: `virtual:less-runtime`, `virtual:less-nav`, `virtual:less-client-entry`, `virtual:less-ssg-entry`
- **`lessjs({ content, i18n })`**: Single-call API in `@openelement/app`, static imports, type-safe
- **`buildClient()`/`buildSSG()` require `ctx`**: No standalone split-phase execution
- **Build pipeline**: Single `viteBuild()` → `closeBundle()` inlines Phase 2/3
- **All pre-commit checks pass** (deno fmt, deno lint, deno check)

## No Remaining Work

All ADR 0008/0009/0010/0011/0012 tasks are complete.
