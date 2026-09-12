---
title: '.less Compiler — Optional Zero-Framework Component Authoring'
date: '2026-05-11'
lang: 'en'
type: 'adr'
tags: ['architecture', 'decision']
draft: false
---

## Status

**DRAFT** — Proposed for v0.11.0 alpha (per ADR 0006 version strategy), not a v0.7–v0.10 blocker.

## Context

LessJS currently uses `lit` for the docs site and UI package, while core is moving toward a
DSD-first renderer with framework adapters. Lit should remain usable, but it should not be the
long-term foundation of the framework contract. The current Lit route brings:

- Lit runtime cost for Lit-authored islands
- adapter complexity for server rendering and style extraction
- upgrade/hydration terminology drift between old Lit SSR and new DSD-first rendering
- SSR/DSD/upgrade paths that must stay in sync
- Deno fmt panics on tagged template literals with HTML entities (dprint-core bug)
- Unnecessary type complexity: `noImplicitOverride`, decorators, complex generics

## Proposal

Introduce `.less` files — a component format purpose-built for LessJS. A compiler transforms
`.less` files into vanilla Custom Elements at build time. The goal is zero framework runtime for
compiled components. Lit remains an adapter, not a forced dependency.

### `.less` file format

```less
<!-- my-counter.less -->
<template>
  <button @click="decrement">−</button>
  <span>{count}</span>
  <button @click="increment">+</button>
</template>

<script>
  count = 0
  increment() { this.count++ }
  decrement() { this.count-- }
</script>

<style>
  :host { display: inline-flex; gap: 0.5rem; align-items: center; }
</style>
```

### Compiler output

```ts
// dist/assets/my-counter.js — vanilla Custom Element, 0 deps
const tpl = document.querySelector('#my-counter-template');
class MyCounter extends HTMLElement {
  #count = 0;
  #root = this.attachShadow({ mode: 'open' });
  get count() {
    return this.#count;
  }
  set count(v) {
    this.#count = v;
    this.#update();
  }
  #update() {
    this.#root.querySelector('span').textContent = this.#count;
  }
  connectedCallback() {
    this.#root.append(tpl.content.cloneNode(true));
    this.#root.querySelector('button:first-child')
      .onclick = () => this.count--;
    this.#root.querySelector('button:last-child')
      .onclick = () => this.count++;
  }
}
customElements.define('my-counter', MyCounter);
```

### What the compiler eliminates

| Layer   | Before (Lit adapter)           | After (.less compiler)                 |
| ------- | ------------------------------ | -------------------------------------- |
| Runtime | Lit runtime for Lit components | 0kb framework runtime for compiled CEs |
| SSR     | adapter-mediated rendering     | LessJS DSD renderer / template strings |
| Upgrade | Custom Element upgrade         | Custom Element upgrade                 |
| Build   | esbuild + Lit semantics        | standard TS/JS output                  |
| Tests   | adapter tests required         | compiler fixture tests required        |

### SSG integration

The route scanner (route-scanner.ts) already maps `app/routes/*.ts` → URL paths. Extend it to also scan `.less` files:

- `app/routes/blog/hello-world.less` → `/blog/hello-world`
- `app/routes/blog.less` → `/blog`
- `app/islands/my-counter.less` → Island component

Page `.less` files render directly (template is the page). Island `.less` files get lazy chunk treatment like today's Lit islands.

### Backward compatibility

- `vite.config.ts` option: `compiler: 'lit' | 'less' | 'auto'` (auto = `.less` files use compiler, `.ts` files use Lit)
- Lit support retained as optional runtime throughout v0.x
- v0.11.0 introduces `.less` as alpha and optional
- v1.0 default remains an open decision; Lit compatibility must not be broken casually

## Consequences

**Positive:**

- Zero framework runtime cost for compiled components
- Fewer upgrade-order bugs because compiled components target the LessJS DSD model directly
- No upstream dependency issues (dprint, node-domexception, parse5)
- Simpler developer API: HTML + minimal script, no class boilerplate
- True tree-shaking: only used components produce code
- SSG becomes synchronous string concatenation

**Negative:**

- Not backward compatible with existing Lit code (migration needed)
- Custom compiler = custom bugs (parser edge cases, sourcemap complexity)
- HMR in dev mode needs special handling (fall back to Lit or implement compiler in watch mode)
- No access to Lit ecosystem components (unless bridge is provided)

## Open Questions

1. Dev mode: run compiler on save, or fall back to Lit runtime for HMR?
2. Islands in `.less` format — does the `<script>` get extracted as a lazy module?
3. Slot/projection semantics — full HTML spec compliance needed in template compiler?
4. SSR rendering — `template.innerHTML` is identical to client, but lifecycle hooks (connectedCallback) need SSG treatment
