---
title: '@openelement/blog - Standalone Blog Package'
date: '2026-05-01'
lang: 'en'
type: 'adr'
tags: ['architecture', 'decision']
draft: false
---

## Status

**SUPERSEDED** — Blog functionality was merged into `@openelement/content` (Blog + Nav + Sitemap unified plugin) instead of shipping as a standalone `@openelement/blog` package. See `packages/content/` for the implementation.

## Context

LessJS currently has two hardcoded blog route pages (`/blog/` +
`/blog/less-compiler`) on its own docs site. These are hand-written custom
element pages, not a reusable system.

Users need a proper blog: drop in `.md` files, get automatic listing +
pagination + RSS + tags. Like VitePress's blog feature, but as a LessJS plugin.

## Constraints

The blog system should not require Lit. It should work first as a plain SSG
plugin, then gain `.less` compiler templates when the compiler exists:

- Post templates should be able to compile to vanilla Custom Elements when
  `.less` exists
- SSR must be synchronous string concatenation (`template.innerHTML`)
- No page-level client runtime for plain blog pages; interactive widgets remain
  islands
- The `.less` compiler is an optional future template backend, not a blocker
  for the first release

## Proposal

### `@openelement/blog` package

A Vite plugin that:

1. **Scans** a user-defined directory for `.md` files with YAML frontmatter
2. **Generates** route entries at build time (like route-scanner does for `.ts`
   files)
3. **Renders** listing pages, post pages, tag pages, and RSS feed during SSG

### User experience

```ts
// vite.config.ts
import { less } from '@openelement/core';
import { lessBlog } from '@openelement/blog';

export default defineConfig({
  plugins: [
    less(),
    lessBlog({
      dir: 'content/blog', // where your .md files live
      title: 'My Blog',
      postsPerPage: 10,
    }),
  ],
});
```

```md
# content/blog/hello-world.md

---
title: Hello World
date: 2026-05-01
tags: [lessjs, meta]
---

This is my first post.
```

### Generated routes

| Route               | Content                                |
| ------------------- | -------------------------------------- |
| `/blog/`            | Post listing (paginated, newest first) |
| `/blog/hello-world` | Individual post (rendered from .md)    |
| `/blog/page/2`      | Page 2 of listing                      |
| `/blog/tags/lessjs` | Filter by tag                          |
| `/blog/feed.xml`    | RSS 2.0 / Atom feed                    |

### Plugin architecture

The `lessBlog()` plugin hooks into the LessJS build pipeline:

```text
vite.config.ts
  -> lessBlog() reads content/blog/*.md
       extracts frontmatter -> metadata.json
       registers virtual routes
  -> deno task build
       Phase 1: Vite SSR build
       Phase 2: buildClient() (no island chunks needed for blog)
       Phase 3: buildSSG() renders /blog/* pages
            generates /feed.xml
  -> dist/
       blog/index.html
       blog/hello-world/index.html
       feed.xml
```

### Post rendering

With the `.less` compiler:

```less
<!-- blog post template (built into @openelement/blog) -->
<template>
  <article>
    <h1>{post.title}</h1>
    <time datetime="{post.isoDate}">{post.displayDate}</time>
    <div class="content">{post.html}</div>
    <nav class="tags">{post.tags}</nav>
  </article>
</template>

<script>
  // post data injected at compile time by the plugin
  post = { title: "", html: "", tags: [], isoDate: "", displayDate: "" }
</script>

<style>
  .content :host { max-width: 720px; margin: 0 auto; }
  time { font-size: 0.75rem; color: var(--less-text-muted); }
</style>
```

Without the `.less` compiler:

The same content can be rendered through the LessJS DSD renderer or a safe
server-side HTML template helper. It should not depend on Lit for plain Markdown
pages.

### MDX support (future)

The `.md` parser should support:

- **Basic**: Gray-matter frontmatter + marked/markdown-it
- **Extended (v2)**: MDX - embed Lit Components or `.less` components inline in
  markdown
- **Code blocks**: Syntax highlighting at build time (not client-side)

## Implementation order

1. v0.8.0 stabilizes core API (render-dsd split, component unification)
2. `@openelement/blog` development starts after v0.8.0 — SSG plugin form only
3. Dogfood on LessJS docs site during v0.9.0 phase
4. `.less` compiler support is added when v0.11.0 alpha is available
5. LessJS docs site eats its own dogfood and replaces the current hardcoded blog
   routes

## Open Questions

1. Markdown parser: `marked` (lightweight) vs `markdown-it` (plugin ecosystem)
   vs custom?
2. Should the blog template be customizable via
   `lessBlog({ template: "my-template.less" })`?
3. RSS vs Atom vs both?
4. Comments? (Disqus, utteranc.es, or leave it to the user)

## Consequences

- **Positive**: Users get a one-line blog setup, competitive with VitePress
- **Positive**: LessJS docs site can dogfood its own blog package
- **Positive**: Zero framework runtime for plain blog pages (with `.less`
  compiler)
- **Negative**: The ideal compiler-backed architecture comes later
- **Negative**: Markdown parsing at build time adds ~100ms to Phase 1
