---
title: 'ADR 0023: Phase Reordering — Client Bundle as Final Layer'
date: '2026-05-13'
lang: 'en'
type: 'adr'
tags: ['architecture', 'build', 'phases', 'bundler']
draft: false
---

# ADR 0023: Phase Reordering — Client Bundle as Final Layer

## Status

✅ Proposed

## Context

ADR 0022 established that LessJS phases can operate independently of Vite. Phase 3 (SSG rendering) is now Vite-independent via `ssg-render.ts`. Phase 1a (scanRoutes, genHonoEntry) is pure TS. Phase 1b (SSR bundle building) can use esbuild.

This ADR addresses the remaining architectural inconsistency: **Phase ordering**.

### Current order

```
Phase 1 (SSR bundle)
  → Phase 2 (client island build + manifest.json)
  → Phase 3 (SSG render all pages + inject client script from manifest)
```

Phase 2 runs before Phase 3 because the manifest it produces is needed for client script injection. But the client script is only a `<script>` tag appended to already-rendered HTML — it has no effect on the HTML content itself. Phase 3 does not need Phase 2 to run.

### Problem

The current ordering creates an unnecessary dependency chain:

- Phase 2 blocks Phase 3 for no functional reason
- Content hashes in client chunk filenames are determined before HTML is rendered (should be the other way around)
- Users who only want SSG (no islands) must still go through Phase 2
- The build pipeline looks like a linear chain when it's actually two independent outputs (SSR HTML + client JS)

### Proposed order

```
Phase 1 (SSR bundle — any bundler or esbuild)
  → Phase 3 (SSG render all pages)
  → Phase 2 (bundle client islands) — FINAL step
  → Inject client script URLs into rendered HTML
```

This makes Phase 2 the last step — the only phase that depends on a bundler. Everything else runs on pure ESM.

## Decision

### Phase reordering

Change the build pipeline to:

1. **Phase 1**: SSR bundle (content-independent, generates routes + rendering code)
2. **Phase 3**: SSG render (uses SSR bundle to produce all HTML files)
3. **Phase 2**: Client island bundle (produces ESM chunks + manifest.json)
4. **Inject**: Read manifest, inject `<script>` tags into HTML

The injection step is decoupled from Phase 2 — it reads the already-written manifest.json and patches HTML files. This means Phase 2 can be skipped entirely if the project has no islands.

### Phase 2 bundler options

Phase 2's requirements:
- Input: virtual client entry module + island source files
- Output: ESM chunks in `dist/client/`
- Manifest: Vite-style `manifest.json` mapping entry → chunk URL
- Minification: production builds
- Code splitting: per-island chunks

| Option | Speed | Code splitting | Manifest | Maturity | Notes |
|--------|-------|---------------|----------|----------|-------|
| **Vite** (current) | 🟡 moderate | ✅ full | ✅ built-in | ✅ battle-tested | Only used for client build, not dev |
| **esbuild** | 🟢 fastest | ⚠️ limited | ❌ custom needed | ✅ mature | No code splitting per-island |
| **rolldown** (Rust) | 🟢 fast | ✅ full | ⚠️ partial | 🟡 new (v1 in 2026) | Rollup-compatible API, still maturing |
| **rollup** | 🟡 moderate | ✅ full | ✅ via plugin | ✅ battle-tested | Slower than alternatives |

**Recommendation: Keep Vite for Phase 2.**

Rationale:
- Phase 2 already uses Vite and works correctly — replacing it gains nothing for the user
- Vite's manifest output is already consumed by `ssgRender()` — esbuild would need custom manifest generation
- Dev mode still needs Vite for HMR — keeping Vite in Phase 2 means shared config between build and dev
- The "one bundler config" story is simpler for users
- esbuild's lack of per-island code splitting means all islands go in one file — defeats the purpose of islands

**Phase 2 does not need to be swapped. It only needs to be reordered to run last.**

## Consequences

### Positive

1. **Phase 3 runs immediately after Phase 1** — no waiting for client bundle
2. **SSG works without any bundler** — Phase 2 is optional (zero-island projects)
3. **Content hashes are stable** — client chunk hashes don't affect HTML content
4. **Clearer architecture** — Phase 2 is "add client JS to already-rendered HTML", not "prerequisite for rendering"

### Negative

1. **Injection step becomes explicit** — currently `ssgRender()` handles injection internally. Must decouple: `ssgRender()` writes HTML, then injection reads manifest and modifies HTML.
2. **`dist/` is incomplete after Phase 3** — users running only Phase 1+3 get HTML without client JS. Must document this.
3. **Build pipeline rework** — `build.ts` in adapter-vite must call phases in new order. ~1 day migration.

### Implementation sketch

```typescript
// build.ts — new order
async function build(ctx) {
  // Phase 1: SSR bundle
  await buildSSRBundle(ctx);
  ctx.markComplete(1);

  // Phase 3: SSG render (no manifest needed — just render)
  const module = await loadSsrBundle(ctx);
  await ssgRender(module, ctx.options, ctx);  // writes HTML, no script injection
  ctx.markComplete(3);

  // Phase 2: Client islands (any bundler)
  await buildClientBundle(ctx);
  ctx.markComplete(2);

  // Inject: read manifest, patch HTML
  if (manifestExists()) {
    const scriptUrls = parseManifest(manifestPath);
    injectClientScripts(distDir, scriptUrls);
  }
}
```

No changes to `ssgRender()` internals — it simply stops doing client script injection. The caller (`build.ts` or `cli/ssg.ts`) decides whether and when to run Phase 2 + injection.

## Migration

Split across two minor versions:

**v0.14** (next):
- Decouple injection from `ssgRender()` — remove client script injection from render pipeline
- `build.ts` calls phases in new order (Phase 1 → Phase 3 → Phase 2 → injection)
- Inject becomes a standalone function in `ssg-postprocess.js`

**v0.15**:
- Phase 2 becomes optional — `build.ts` skips it if `totalIslands === 0`
- `cli/ssg.ts` supports `--skip-client` flag
- API stable: `ssgRender()` no longer requires client manifest
