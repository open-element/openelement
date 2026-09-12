---
title: 'SOP: ADR 0008 Completion + Single-Plugin Unification'
date: '2026-05-10'
lang: 'en'
type: 'adr'
tags: ['architecture', 'decision']
draft: false
archived: true
---

> **Branch**: `dev` | **Created**: 2026-05-10 | **Status**: ✅ FULLY IMPLEMENTED

## Background

ADR 0008 Phase C is complete (`createServer()` → `viteBuild + import()`).
All phases (A, B, C, D, E) are now fully implemented via ADR 0010/0011/0012.

## Final State

- **Phase A** (`.less/` file IPC → memory): ✅ Done via ADR 0010
- **Phase B** (globalThis bridges → module vars): ✅ Done
- **Phase C** (eliminate `createServer()`): ✅ Done — closeBundle inlines Phase 2/3 (ADR 0011)
- **Phase D** (runtime-shim → virtual module): ✅ Done
- **Phase E** (single-plugin API): ✅ Done — `lessjs()` extracted to `@openelement/app` (ADR 0012)

## Key Changes from Original SOP

- **Phase E updated**: `lessjs()` was originally in `@openelement/core` with dynamic `import()`. Per ADR 0012, it has been extracted to a new `@openelement/app` package with static imports for better type safety and correct dependency direction.
- **globalThis fully deleted**: `getActiveContext()`/`setActiveContext()`/`clearActiveContext()` have been removed from `build-context.ts`. ctx is only passed via explicit parameter.
- **content/i18n require explicit ctx**: `lessContent({ ctx })` and `lessI18n({ ctx })` — no auto-discovery fallback.

## Architecture Summary

```
@openelement/app (lessjs entry)
  ├── @openelement/core       (less(), LessBuildContext)
  ├── @openelement/content    (lessContent)
  └── @openelement/i18n       (lessI18n)
```

Publish order: rpc → ui → adapter-lit → signal → content → i18n → core → app → create

---

> **The sections below are the original implementation plan, kept as historical reference.
> All tasks are complete. No further action needed.**

## Current State of `.less/` Files (Phase A targets) — ALL ELIMINATED

These files are written by Phase 1 plugins and read by Phase 2/3 CLI scripts:

| File                    | Writer                    | Reader                                         | Contains                                                                                                                                      |
| ----------------------- | ------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `build-metadata.json`   | `less:build` closeBundle  | `build-client.ts`, `build-ssg.ts`              | islandTagNames, islandFiles, packageIslands, resolveAlias, ssrNoExternal, middleware, html, pwa, upgradeStrategy, viewTransition, speculation |
| `head-extras.html`      | `build-ssg.ts`            | SSR entry (generated code reads it at runtime) | raw HTML string                                                                                                                               |
| `.less-ssg-entry.ts`    | `build-ssg.ts`            | viteBuild SSR input                            | generated Hono entry code                                                                                                                     |
| `.less-client-entry.ts` | `build-client.ts`         | viteBuild client input                         | generated client island entry                                                                                                                 |
| `.less-runtime.ts`      | `less:core` config hook   | Vite alias resolution                          | runtime shim code                                                                                                                             |
| `blog-options.json`     | `less:content` buildStart | `build-ssg.ts`                                 | `{ contentDir, basePath }`                                                                                                                    |
| `nav-data.json`         | `less:content` buildStart | `build-ssg.ts` virtual:less-nav plugin         | NavSection[]                                                                                                                                  |
| `header-nav.json`       | `less:content` buildStart | `build-ssg.ts` virtual:less-nav plugin         | HeaderNavLink[]                                                                                                                               |
| `i18n-options.json`     | `less:i18n` buildStart    | `build-ssg.ts`                                 | LessI18nOptions                                                                                                                               |
| `sitemap-options.json`  | `less:content` buildStart | `build-ssg.ts`                                 | SitemapOptions                                                                                                                                |

**Total: 10 temp files.** Goal: 0.

---

## Phase Breakdown & Execution Order

### Phase A: Eliminate `.less/` File IPC → `LessBuildContext` + Virtual Modules

**Strategy**: All build-time data flows through `LessBuildContext` (in-memory). CLI scripts receive context directly instead of reading JSON files. Virtual modules resolve from context instead of reading `.less/` JSON.

**Risk**: MEDIUM — touches the entire build pipeline, but changes are mechanical (read file → read context property).

#### A.1: Expand `LessBuildContext` to carry all current `.less/` data

**File**: `packages/core/src/build-context.ts`

Add these fields:

```typescript
// ─── From less:content buildStart ────────────────────────────
blogOptions: { contentDir?: string; basePath?: string } | null = null;
navSections: import('./content-types.js').NavSection[] = [];
headerNav: import('./content-types.js').HeaderNavLink[] = [];
sitemapOptions: import('./content-types.js').SitemapOptions | null = null;

// ─── From less:i18n buildStart ───────────────────────────────
i18nOptions: import('./i18n-types.js').LessI18nOptions | null = null;

// ─── From less:build closeBundle ────────────────────────────
// (replaces build-metadata.json)
root: string = '';
outDir: string = 'dist';
base: string = '/';
middleware: FrameworkOptions['middleware'] | null = null;
html: FrameworkOptions['html'] | null = null;
pwa: FrameworkOptions['pwa'] | null = null;
upgradeStrategy: string = 'lazy';
viewTransition: boolean = true;
speculation: boolean | SpeculationRulesOptions | null = null;
headExtras: string = '';

// ─── From entry-renderer ─────────────────────────────────────
ssgEntryCode: string = '';     // replaces .less-ssg-entry.ts
clientEntryCode: string = '';  // replaces .less-client-entry.ts
```

**Note**: Type imports need to be duplicated or extracted to a shared types file. Prefer a lightweight `packages/core/src/shared-types.ts` that content/i18n can also reference, or use `Record<string, unknown>` with runtime casts.

**Validation**: `deno check`, `deno lint`, existing tests pass.

#### A.2: `less:content` write to `ctx` instead of `.less/` files

**File**: `packages/content/src/index.ts`

- `lessContent()` receives `LessBuildContext` as parameter (or accesses it via a shared symbol on Vite's `config` object)
- `buildStart()` sets `ctx.blogOptions`, `ctx.navSections`, `ctx.headerNav`, `ctx.sitemapOptions`
- Remove all `writeFileSync(join(lessDir, '*.json'))` calls

**Problem**: `lessContent()` currently returns `Plugin[]` and doesn't know about `LessBuildContext`. Two options:

**Option A (preferred)**: `lessContent()` accepts `{ ctx }` option. The `lessjs()` umbrella plugin creates the context and passes it to all sub-plugins.

**Option B**: Store context on `config` via a `configResolved` hook symbol key. More coupling, less clean.

→ **Go with Option A**. This is the path to single-plugin API.

#### A.3: `less:i18n` write to `ctx` instead of `.less/` files

**File**: `packages/i18n/src/index.ts`

- `lessI18n()` accepts `{ ctx }` option
- `buildStart()` sets `ctx.i18nOptions`
- Remove `writeFileSync(join(lessDir, 'i18n-options.json'))`

#### A.4: `less:build` write metadata to `ctx` instead of `.less/build-metadata.json`

**File**: `packages/core/src/build.ts`

- `closeBundle()` sets `ctx.root`, `ctx.base`, `ctx.resolveAlias`, etc.
- Remove `writeFileSync(metadataPath, ...)`
- The ctx is already passed to `buildPlugin()` — just extend what it writes

#### A.5: `build-client.ts` read from `ctx` instead of `.less/build-metadata.json`

**File**: `packages/core/src/cli/build-client.ts`

- Accept `LessBuildContext` as parameter (passed from CLI orchestrator)
- Remove `readFileSync(join(root, '.less', 'build-metadata.json'))`
- Read `ctx.islandTagNames`, `ctx.islandFiles`, `ctx.packageIslands`, etc.
- Write `.less-client-entry.ts` to memory (ctx.clientEntryCode) instead of filesystem

**Problem**: `build-client.ts` is a standalone CLI script (`if (import.meta.main)`). It currently reads metadata from disk because Phase 1 (vite build) and Phase 2/3 are separate processes.

**Solution**: Create a unified `build.ts` orchestrator that:

1. Runs Phase 1 (vite build) → ctx gets populated by plugin hooks
2. Runs Phase 2 (client build) → reads from ctx
3. Runs Phase 3 (SSG) → reads from ctx
4. All within the same Node.js process — no `.less/` IPC needed

This is the **key architectural change**. Instead of 3 separate CLI scripts, one orchestrator:

```typescript
// packages/core/src/cli/build.ts (new unified build command)
export async function build(options: FrameworkOptions) {
  const ctx = new LessBuildContext(options);

  // Phase 1: SSR build (vite build) — plugins populate ctx
  await viteBuild({
    plugins: [
      lessCore(options, ctx),
      lessContent({ ...options.content, ctx }),
      lessI18n({ ...options.i18n, ctx }),
    ],
  });

  // Phase 2: Client build — reads ctx
  await buildClient(ctx);

  // Phase 3: SSG render — reads ctx
  await buildSSG(ctx);
}
```

#### A.6: `build-ssg.ts` read from `ctx` instead of `.less/` files

**File**: `packages/core/src/cli/build-ssg.ts`

- Accept `LessBuildContext` as parameter
- Replace all `readFileSync(join(root, '.less', '*.json'))` with `ctx.*` reads
- Replace `.less-ssg-entry.ts` with `ctx.ssgEntryCode` (use virtual module or `define`)
- Replace `virtual:less-nav` file read with `ctx.navSections` / `ctx.headerNav`
- Replace `.less/head-extras.html` file read with `ctx.headExtras` (inline via `define`)
- Keep `optionalPackageStubsPlugin()` — still needed for SSR build

#### A.7: `entry-renderer.ts` headExtras — eliminate `.less/head-extras.html` read

**File**: `packages/core/src/entry-renderer.ts`

Currently SSG entry code does:

```typescript
import { readFileSync } from 'node:fs';
let __headExtras = readFileSync(join(process.cwd(), '.less', 'head-extras.html'), 'utf-8');
```

Replace with `define` injection:

```typescript
// In viteBuild config:
define: {
  __LESS_HEAD_EXTRAS__: JSON.stringify(options.headExtras);
}

// In generated entry code:
const __headExtras = __LESS_HEAD_EXTRAS__;
```

This eliminates the runtime file read AND the `.less/head-extras.html` file.

#### A.8: Clean up `.less/` directory creation

After A.1–A.7, search for all remaining `.less/` references and remove:

- `mkdirSync(lessTmpDir, ...)` calls
- `writeFileSync(join(lessTmpDir, ...))` calls
- Any `.less/` path references in comments/docs

**Verification**: `grep -rn "\.less" packages/ --include="*.ts"` returns 0 results.

---

### Phase D: Replace `runtime-shim.ts` with `virtual:less-runtime`

**Risk**: LOW — mechanical replacement.

#### D.1: Create `virtual:less-runtime` Vite plugin

**File**: `packages/core/src/index.ts` (inside `less()`)

Replace the `less:core` config hook that writes `.less-runtime.ts` to disk:

```typescript
// BEFORE (writes to .less/.less-runtime.ts):
config() {
  writeFileSync(runtimePath, createRuntimeShimCode(), 'utf-8');
  return { resolve: { alias: { '@openelement/core/less-runtime': runtimePath } } };
}

// AFTER (virtual module):
const VIRTUAL_RUNTIME_ID = 'virtual:less-runtime';
const RESOLVED_RUNTIME_ID = '\0' + VIRTUAL_RUNTIME_ID;

// In less:core plugin:
resolveId(id) { if (id === VIRTUAL_RUNTIME_ID) return RESOLVED_RUNTIME_ID; }
load(id) { if (id === RESOLVED_RUNTIME_ID) return createRuntimeShimCode(); }

// In config() hook:
return { resolve: { alias: { '@openelement/core/less-runtime': VIRTUAL_RUNTIME_ID } } };
```

#### D.2: Update `build-ssg.ts` SSR build to include `virtual:less-runtime` plugin

The SSG SSR build also needs to resolve `@openelement/core/less-runtime`. Add the same virtual module plugin to the SSR `viteBuild()` plugins array.

#### D.3: Remove `createRuntimeShimCode()` from `runtime-shim.ts`

The function can stay (it generates the code), but it no longer writes to disk.

**Verification**: `grep -rn "\.less-runtime" packages/ --include="*.ts"` returns 0 file-path references (only import IDs remain).

---

### Phase E: Single-Plugin API (`lessjs()`)

**Risk**: LOW — pure API layer, internals unchanged.

#### E.1: Create `lessjs()` umbrella function

**File**: `packages/core/src/index.ts` (new export)

```typescript
export function lessjs(options: LessjsOptions = {}): Plugin[] {
  const ctx = new LessBuildContext(resolvedCoreOptions);

  return [
    ...less(resolvedCoreOptions, ctx),
    ...(options.content ? lessContent({ ...options.content, ctx }) : []),
    ...(options.i18n ? lessI18n({ ...options.i18n, ctx }) : []),
  ];
}
```

Where `LessjsOptions`:

```typescript
interface LessjsOptions extends FrameworkOptions {
  content?: LessContentOptions;
  i18n?: LessI18nOptions;
}
```

#### E.2: Update `less()`, `lessContent()`, `lessI18n()` to accept `ctx`

Each function gets an optional `ctx` parameter. When called from `lessjs()`, the shared context is used. When called standalone (backward compat), each creates its own context.

#### E.3: Keep backward compatibility

`less()`, `lessContent()`, `lessI18n()` remain exported and work independently. Users can still do:

```typescript
plugins: [less(), lessContent({ blog: true })];
```

But `lessjs({ content: { blog: true } })` is the recommended path.

#### E.4: Update CLI to use unified `build` command

Replace the 3-script pipeline:

```bash
deno task build        # runs: vite build + build:client + build:ssg
```

With a single `build` command that uses the orchestrator from A.5.

---

## Execution Checklist

### Phase A (Eliminate .less/ IPC) — ✅ COMPLETE

- [x] A.1: Expand `LessBuildContext` with all `.less/` data fields
- [x] A.2: `lessContent()` → write to `ctx` instead of `.less/` files
- [x] A.3: `lessI18n()` → write to `ctx` instead of `.less/` files
- [x] A.4: `less:build` → write metadata to `ctx` instead of `.less/build-metadata.json`
- [x] A.5: Create unified `build.ts` orchestrator (replaces 3-script pipeline)
- [x] A.6: `build-ssg.ts` → read from `ctx` instead of `.less/` files
- [x] A.7: `entry-renderer.ts` → `define` injection replaces `head-extras.html` file read
- [x] A.8: Clean up all remaining `.less/` references

### Phase D (Virtual less-runtime) — ✅ COMPLETE

- [x] D.1: Create `virtual:less-runtime` plugin in `less:core`
- [x] D.2: Add virtual:less-runtime to SSR build plugins
- [x] D.3: Remove `.less-runtime.ts` file write

### Phase E (Single-plugin API) — ✅ COMPLETE (extracted to @openelement/app per ADR 0012)

- [x] E.1: Create `lessjs()` umbrella function in `@openelement/app`
- [x] E.2: Update `less()`, `lessContent()`, `lessI18n()` to accept shared `ctx`
- [x] E.3: Verify backward compatibility (split-call with explicit `ctx` works)
- [x] E.4: Update CLI to use unified build command (closeBundle inline per ADR 0011)

---

## Commit Strategy

- **One commit per checkbox** (small, reviewable, revertable)
- **Commit message format**: `refactor(core): A.1 — expand LessBuildContext with .less/ data fields`
- **Run after each commit**: `deno fmt && deno lint && deno check` + full test suite
- **Branch**: all on `dev`

## Risk Mitigation

1. **Incremental commits**: Each step is independently valid. If A.5 (unified orchestrator) proves complex, A.1–A.4 still eliminate `.less/` writes from plugins — the CLI can temporarily still read from a JSON dump.
2. **Fallback**: If unified build orchestrator is too risky, keep Phase 1 as `vite build` (writes one metadata JSON to `.less/`) and have Phase 2/3 read it. This is a partial win: 10 files → 1 file.
3. **Testing**: After each phase, run the full e2e build (`deno task build`) and verify output matches.

## Definition of Done — ✅ ALL MET

- `grep -rn "\.less" packages/ --include="*.ts"` returns 0 results (excluding comments)
- `grep -rn "globalThis\[" packages/ --include="*.ts"` returns 0 results
- `grep -rn "getActiveContext\|setActiveContext\|clearActiveContext" packages/ --include="*.ts"` returns 0 results
- User can write `plugins: [await lessjs({ content: { blog: true }, i18n: { locales: ['en', 'zh'] } })]` from `@openelement/app`
- `lessjs()` uses static imports, not dynamic `import()` + try/catch
- Build pipeline: single `viteBuild()` → `closeBundle()` inlines Phase 2/3
