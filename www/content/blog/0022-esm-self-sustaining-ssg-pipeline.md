---
title: 'ADR 0022: ESM-Native LessJS — Pure ESM Imports Across Browser/Deno/Bun/CF Workers'
date: '2026-05-13'
lang: 'en'
type: 'adr'
tags: ['architecture', 'esm', 'ssg', 'core', 'build', 'standards', 'portability']
draft: false
---

# ADR 0022: ESM-Native LessJS — Pure ESM Imports Across Browser/Deno/Bun/CF Workers

## Status

✅ Proposed

## Core Thesis

**LessJS should work as pure native ESM imports — runnable in browser, Deno, Bun, Node.js, and Cloudflare Workers — with Vite being an optional accelerator for dev mode and client bundling, not a hard requirement for the SSG pipeline.**

This means:
- Phase 1 (route scanning + SSR bundle generation) must produce **standard ESM modules**, not Vite-coupled bundles
- Phase 3 (SSG rendering) must be a **standalone process** that loads SSR bundles via `import()` — no Vite plugin required
- The SSR bundle must carry its own dependency map (`importmap.json`) so it resolves bare specifiers in **any runtime**
- `@openelement/core` must use only **Web Standard APIs** — zero `node:*` imports, zero platform-specific assumptions

## Context

### Problem 1: SSR bundle is Vite-coupled, breaks outside Vite process

LessJS Phase 3 (SSG) currently runs inside `closeBundle()` of the `less:build` Vite plugin. It builds a self-contained SSR bundle via `viteBuild(ssr: true, noExternal: [...])`, then imports it in the same process.

This bundle contains bare specifiers (`import 'hono'`, `import '@openelement/core'`) that rely on the **ambient process import map** to resolve. When a user installs LessJS from JSR (`jsr:@openelement/app`), Deno's workspace import map covers these. But with `npm:@jsr/lessjs__app`, the npm resolver doesn't know about them, and Phase 3 fails.

**Root cause**: The SSR bundle has no self-declared dependency map — it assumes the loading environment will resolve its bare specifiers.

### Problem 2: Target runtime diversity demands portable ESM

LessJS users deploy to:
- **Cloudflare Workers** — no filesystem, no Node APIs, pure Service Worker scope
- **Deno** — native ESM, import maps
- **Bun** — native ESM, Node compat
- **Node.js** — ESM with `--experimental-json-modules`
- **Browser** — native `<script type="module"` with importmap

Each has different resolution semantics. A Vite-bundled SSR bundle with inlined dependencies works in none of them consistently. A native ESM module with an explicit importmap works in all of them.

### Problem 3: Hand-rolled URL pattern matching in core

`core/src/context.ts` has a hand-rolled `extractParams()` function that parses route patterns (`/posts/:id` → pathname `/posts/123` → `{id: '123'}`). This duplicates WHATWG's **URLPattern** standard API, which is now available across all target runtimes (Deno native, Node 19+, Bun native, all browsers).

### What was considered and rejected

**parse5 replacement**: `parse5` is the WHATWG-standard HTML parser, used for AST-based nested DSD rendering in `render-nested.ts`. Considered replacing it with an inline HTML walker for "zero-dependency core", but rejected because:

- parse5 has zero functional overhead for our use case — it IS the standard
- A hand-rolled walker would lost WHATWG compliance (edge cases like nested `<template>`, HTML entity decoding inside attributes, quoted attribute values containing `>`)
- parse5 is only used in SSR build, not shipped to browsers (tree-shaken)
- The "zero dependency" benefit does not solve any real user problem

**`parseQuery()` replacement**: Already uses `URLSearchParams` internally. No change needed.

### Scope

This ADR covers changes to align LessJS with its core thesis:

1. **Phase 1 + Phase 3 → Pure ESM pipeline** — SSR bundle carries its own `importmap.json`, Phase 3 runs standalone in any runtime. Vite retained for dev HMR + client bundling only.
2. **`@openelement/core` → Web Standards only** — Already zero `node:*`, already zero Vite. Replace hand-rolled route matching with WHATWG `URLPattern`. Retain `parse5` (WHATWG-standard HTML parser, necessary for AST-based nested DSD).

## Decision

### 0. Every Artifact is Pure ESM — Runtime Agnostic

All LessJS build artifacts must be **standard ESM modules** that can be loaded via `import()` in any runtime. No artifact may assume the presence of Vite, Node.js APIs (`node:fs`, `node:path`), Deno-specific APIs, or any specific runtime's module resolution semantics.

This applies to:

| Artifact | Format | Loaded by |
|----------|--------|-----------|
| SSR bundle (`dist/server/entry.mjs`) | Pure ESM with bare specifiers | Phase 3 SSG in any runtime via `import()` |
| Client islands (`dist/client/islands/*.js`) | ESM chunks | Browser via `<script type="module">` |
| HTML pages (`dist/**/*.html`) | Static HTML + DSD | Browser natively |
| `@openelement/core` exports | Pure ESM with only relative/web-standard imports | SSR bundle, client islands, user code |

**Enforcement rules:**
- No `node:*` imports in `@openelement/core` (already done ✓)
- No Vite types or APIs referenced in core (already done ✓)
- SSR bundle must carry `importmap.json` so it resolves bare specifiers in any runtime
- Phase 3 SSG CLI must work in Deno, Bun, Node.js, and Cloudflare Workers without modification
- `parse5` is acceptable (WHATWG standard, available on npm/JSR, no runtime lock-in)
- `URLSearchParams` replaces hand-rolled query parsing (already done ✓)
- `URLPattern` replaces hand-rolled route param extraction (P1)

### 1. Phase 1 + 3: Native ESM SSG Pipeline

#### Current flow (Vite-coupled)

```
Phase 1 (Vite closeBundle):
  scanRoutes() → genHonoEntry() → viteBuild(ssr: true, noExternal: all)
  → dist/server/entry.js          ← bare specifiers, no self-declared deps
  → Phase 2 (viteBuild client)
  → Phase 3 (import('./dist/server/entry.js'), render all)
```

Cannot run outside Vite process because bare specifiers rely on ambient import map.

#### Proposed flow (ESM-native)

```
Phase 1 (Vite closeBundle or standalone):
  scanRoutes() → genHonoEntry()
  → esbuild --format=esm --packages=external    ← preserves bare specifiers
  → dist/server/entry.mjs + dist/server/importmap.json

Phase 2 (client bundling — Vite only):
  viteBuild(client islands)                     ← unchanged

Phase 3 (SSG — any runtime):
  read dist/server/importmap.json
  → load dist/server/entry.mjs with importmap
  → renderAll(routes)
  → write HTML files

Target runtimes:
  ✅ Deno:   deno run --import-map=importmap.json ssg.mjs
  ✅ Bun:    bun ssg.mjs                          ← natively supports importmap
  ✅ Node:   node --experimental-network-imports ssg.mjs
  ✅ CF:     wrangler ssg.mjs                     ← Workers runtime supports ESM
  ✅ Browser: not applicable (SSG runs at build time)
```

#### Sidecar importmap.json format

```json
{
  "imports": {
    "hono": "npm:hono@4.7.0",
    "lit": "npm:lit@3.3.2",
    "@lit/reactive-element": "npm:@lit/reactive-element@2.1.0",
    "@openelement/core": "npm:@jsr/lessjs__core@0.13.0",
    "@openelement/core/logger": "npm:@jsr/lessjs__core@0.13.0/logger",
    "@openelement/adapter-lit": "npm:@jsr/lessjs__adapter-lit@0.8.0",
    "parse5": "npm:parse5@7.0.0"
  }
}
```

Generated by Phase 1 from:
- The project's `deno.json` / `package.json` imports
- Resolved versions of `@openelement/*` packages
- User-configured `ssr.noExternal` patterns

#### Phase 3 loading strategy

```typescript
// ssg-cli.ts — standalone, no Vite dependency
async function loadSsrBundle(ssrDir: string) {
  const importmapPath = resolve(ssrDir, 'importmap.json');
  const entryPath = resolve(ssrDir, 'entry.mjs');

  const importmap = JSON.parse(readFileSync(importmapPath, 'utf-8'));

  // In Deno: deno run --import-map=./dist/server/importmap.json
  // In Bun: natively supports importmap.json
  // In Node: resolve bare specifiers manually via the importmap before import()
  const entryUrl = pathToFileURL(entryPath).href;
  return await import(entryUrl);
}
```

**Key insight**: Switch from `viteBuild(ssr: true, noExternal: all)` (everything inlined) to **esbuild `--format=esm --packages=external`** (bare specifiers preserved). The importmap provides the resolution map.

#### Dev mode impact

**None**. Vite dev server continues to handle HMR, dev proxy, and dev module resolution unchanged. The importmap is only produced during `build`.

---

### 2. URLPattern Adoption

#### Current code

```typescript
// core/src/context.ts — hand-rolled, ~30 lines
export function extractParams(
  pattern: string,
  pathname: string,
): Record<string, string> {
  const params: Record<string, string> = {};
  const patternParts = pattern.split('/');
  const pathParts = pathname.split('/');
  for (let i = 0; i < patternParts.length; i++) {
    const part = patternParts[i];
    if (part.startsWith(':')) {
      const paramName = part.slice(1);
      if (i < pathParts.length) {
        params[paramName] = decodeURIComponent(pathParts[i]);
      }
    }
  }
  return params;
}
```

Does not handle:
- Optional params (`/posts/:id?`)
- Wildcards (`/posts/*`)
- Regex constraints (`/posts/:id(\\d+)`)

#### Replacement

```typescript
// core/src/context.ts — using WHATWG URLPattern
export function extractParams(
  pattern: string,
  pathname: string,
): Record<string, string> {
  const urlPattern = new URLPattern({ pathname: pattern });
  const match = urlPattern.exec({ pathname, protocol: 'https', hostname: 'localhost' });
  return match?.pathname?.groups ?? {};
}
```

URLPattern supports:
- `:id` → named groups
- `:id?` → optional
- `*` → wildcard
- `(\\d+)` → regex constraints
- All per WHATWG spec

#### Runtime availability

| Runtime | URLPattern support | Notes |
|---------|-------------------|-------|
| Deno 1.33+ | ✅ Native | No flags |
| Node.js 19+ | ✅ | Under `--experimental-url-pattern` flag |
| Bun 1.0+ | ✅ Native | No flags |
| Chrome/Edge 95+ | ✅ Native | |
| Firefox 113+ | ✅ Native | |
| Safari 16.4+ | ✅ Native | |

LessJS targets Deno + Node. Use with runtime guard:

```typescript
export function extractParams(pattern: string, pathname: string): Record<string, string> {
  if (typeof URLPattern !== 'undefined') {
    const urlPattern = new URLPattern({ pathname: pattern });
    const match = urlPattern.exec({ pathname, protocol: 'https', hostname: 'localhost' });
    return match?.pathname?.groups ?? {};
  }
  // Fallback: existing hand-rolled implementation
  return extractParamsFallback(pattern, pathname);
}
```

---

## Consequences

### Positive

1. **True ESM-native architecture** — LessJS SSG runs in any runtime that supports ESM `import()`. No Vite process needed for production builds.
2. **Zero-friction install** — No `npm:` vs `jsr:` distinction. All install paths (npm, JSR, workspace) converge on the same Phase 3 behaviour.
3. **Platform-agnostic deployment** — `dist/` is pure static HTML + ESM islands. SSG runs equally well in CI on Deno, Node, or Bun.
4. **Standard-compliant route matching** — URLPattern supports optional params, wildcards, regex constraints. Future-proof.
5. **parse5 retained** — WHATWG-standard HTML parsing for correct AST-based DSD rendering.
6. **Vite stays where it shines** — Dev HMR and client bundling remain Vite's job. No reinvention needed.

### Negative

1. **Importmap generation adds logic to Phase 1** — Must scan project config for version info (~50 lines)
2. **Two SSR bundle modes** — Old `viteBuild(noExternal)` inline mode retained for backward compat; new importmap mode as default
3. **URLPattern needs a fallback** — Node.js <19 users get the hand-rolled version
4. **No change to `parseQuery()`** — Already uses `URLSearchParams`, correctly handles multi-value keys

### Migration

**Phase 3 importmap (v0.14)**:
- Phase 1 additionally produces `dist/server/entry.mjs` + `importmap.json`
- Both old (Vite inline) and new (ESM + importmap) modes coexist
- Phase 3 CLI defaults to importmap mode, falls back to Vite inline

**URLPattern (v0.14)**:
- Drop-in replacement for `extractParams()` with runtime guard
- Remove fallback in v0.15 after Node <19 support window ends

---

## Implementation Plan

### P0 (2.5d) — Solve the friction

| # | Task | Files | Est. |
|---|------|-------|------|
| 1 | Phase 1: emit `importmap.json` alongside SSR bundle | `cli/build-ssg.ts` | 0.5d |
| 2 | Phase 3: standalone SSG CLI using importmap | new `cli/ssg.ts` | 1d |
| 3 | Move `@hono/vite-dev-server` to optional dep | `adapter-vite/deno.json` | 0.5d |
| 4 | Document importmap approach in README | README.md | 0.5d |

### P1 (1.5d) — Standard API alignment

| # | Task | Files | Est. |
|---|------|-------|------|
| 5 | Replace `extractParams()` with `URLPattern` + fallback | `core/src/context.ts` | 0.5d |
| 6 | Test URLPattern route matching for all patterns | `__tests__/context.test.ts` | 0.5d |
| 7 | Remove the "parse5 replacement" section from all docs | - | 0.1d |
| 8 | Unify `BuildSSGOptions` single source of truth | `cli/build-ssg.ts`, `build-context.ts` | 0.5d |

### Total: 4d

---

## Technical Notes

### Why esbuild instead of viteBuild for SSR bundle?

`esbuild --format=esm --packages=external` preserves bare specifiers so the importmap can resolve them. It's also ~40× faster than Vite SSR build for this task (~50ms vs ~2s).

The virtual modules (`virtual:less-ssg-entry`, `virtual:less-blog-data`) are handled by **string inlining** via esbuild's `--define:` instead of Vite plugin resolvers.

### URLPattern fallback strategy

Keep the hand-rolled `extractParams()` as `extractParamsFallback()` until Node.js 19+ becomes the minimum supported version (~v0.15). The guard adds <10 lines and zero dependencies.

### What we keep

- `parse5` in `@openelement/core` — WHATWG-standard HTML parser, right tool for AST-based DSD rendering
- `URLSearchParams` in `parseQuery()` — already standard, no change
- Vite for dev mode and client bundle — unchanged, best-in-class HMR

### What we replace

- `import('./dist/server/entry.js')` without importmap → with importmap
- Hand-rolled route parameter parser → `URLPattern` (WHATWG standard)
