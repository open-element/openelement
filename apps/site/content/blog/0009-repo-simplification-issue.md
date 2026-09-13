---
title: 'Repo-wide Simplification Roadmap: ADR 0008 + ADR 0009'
date: '2026-05-11'
lang: 'en'
type: 'adr'
tags: ['architecture', 'decision']
draft: false
---

## Overview

Two ADRs driving a comprehensive simplification of the LessJS codebase — preserving all functionality while eliminating coupling, duplication, and unnecessary abstraction layers.

---

### ADR 0008 — Pipeline-level Restructuring

Eliminate `createServer()`, `globalThis[Symbol.for()]` bridges, `.less/` temp file IPC, and `runtime-shim`.

**Phases (execution order)**:

- **Phase C+B** (merge): Remove `createServer()`, replace `ssrLoadModule` with `import()`, replace `globalThis` bridges with module variables
- **Phase A**: Replace `.less/` temp file IPC with `define` injection into SSR bundle
- **Phase D**: Delete `runtime-shim.ts` + `generate-runtime-shim.ts`, replace `less-runtime.ts` with `virtual:less-runtime`

**Key result**: 3→2 Vite calls, 8+→0 temp files, 4→0 globalThis keys, SSR bundle actually consumed

**Phase D detail — `virtual:less-runtime`**:
Delete physical `less-runtime.ts` and the entire alias infrastructure (`writeFileSync` → `userResolveAlias` → `resolve.alias`). Replace with a `virtual:less-runtime` module implemented in the `less()` Vite plugin's `resolveId`/`load` hooks. Consumers keep the same import path (`@openelement/core/less-runtime`), zero code changes needed. Also removes `export { Hono } from 'hono'` — consumers import `Hono` directly.

---

### ADR 0009 — Repo-wide Simplification (on top of ADR 0008)

Layered simplification across `@openelement/core` and cross-package boundaries.

**Layer 1 — Core internal simplification** (6 independent + 2 dependent items):

- [ ] 1.1 Delete `CodeBuilder` class → `string[]`
- [ ] 1.2 Merge `hono-entry.ts` into `entry-renderer.ts`
- [ ] 1.3 Eliminate inline HTML escape → use `escapeHtml()`
- [ ] 1.4 Merge `renderPageRoute` wrapInDocument branches
- [ ] 1.5 Merge `renderCorsOrigin` duplicate branches
- [ ] 1.6 Merge `ssr-handler.ts` into `html-escape.ts`
- [ ] 1.7 Extract `__ssr` to `ssr-helper.ts` _(needs Phase C+B)_
- [ ] 1.8 Eliminate `__less_get_default_export` helper
- [ ] 1.9 Remove `LessBuildContext.userResolveAlias` _(needs Phase C)_

**Layer 2 — Cross-package decoupling**:

- [ ] 2.1 Mark `render-dsd.ts` re-exports of `html-escape` as `@deprecated`
- [ ] 2.2 Delete `runtime-shim.ts` _(ADR 0008 Phase D)_
- [ ] 2.3 Align `blog-data.ts` with `i18n-data.ts` pattern _(ADR 0008 Phase B)_
- [ ] 2.5 Extract `walkHtmlFiles()` from `ssg-postprocess.ts` (eliminate 5× duplication)

**Layer 3 — Export cleanup & file deletion**:

- [ ] 3.1 `render-dsd.ts` re-export chain cleanup
- [ ] 3.2 **Delete `less-runtime.ts`** → replace with `virtual:less-runtime` in Vite plugin _(needs Phase C+B, zero consumer changes)_
- [ ] 3.3 `index.ts` export audit (mark CLI internals as `@internal`)
- [ ] 3.4 Extract `registerAdapter`/`getAdapter` to `adapter-registry.ts`

---

### Execution Order

```
Phase C+B (ADR 0008)
  → Layer 1.1–1.6, 1.8 (all independent, can parallel)
  → Layer 1.7, 1.9 (depend on C+B)
  → less-runtime.ts → virtual:less-runtime + adapter-registry.ts extraction
Phase A → D (ADR 0008)
  → Layer 2 remaining
  → Layer 3 export audit
```

### Expected Impact

- **~350 lines reduced** in core (5846 → ~5495)
- **5 files deleted**: `hono-entry.ts`, `ssr-handler.ts`, `less-runtime.ts`, `runtime-shim.ts`, `generate-runtime-shim.ts`
- **2 files created**: `ssr-helper.ts`, `adapter-registry.ts` (clear single-responsibility modules)
- **1 virtual module added**: `virtual:less-runtime` (replaces physical file + 35 lines of alias logic, zero consumer changes)
- **Zero functionality changes** — all simplifications are behavior-preserving

---

_Full details: [ADR 0008](/blog/0008-eliminate-createserver-globalthis-bridges) and ADR 0009 artifact_
