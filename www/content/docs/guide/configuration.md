---
title: 'Configuration'
lede: 'Configuration stays close to the route, build or package surface it affects.'
order: 70
---

## openPipeline()

The lean Vite plugin entry, configured in `vite.config.ts`: `openPipeline({ mode, routes: { dir }, island: { dir, upgradeStrategy }, output: { outDir }, viewTransition, headExtras })`. Defaults: routes `app/routes`, islands `app/islands`, components `app/components`, `viewTransition` on. `headExtras` is developer-trusted input passed through verbatim at the `trustedHtml` trust level — the framework does not sanitize it. `<script>` tags are rejected outright (use `inject.scripts` for scripts), and `<style>` blocks must not carry executable CSS; anything else, including `base` and `meta http-equiv`, is the fragment author's responsibility.

### vite.config.ts

```ts
import { defineConfig } from 'vite';
import { openPipeline } from '@openelement/router/vite';

export default defineConfig({
  plugins: [
    openPipeline({
      mode: 'ssg', // default
      routes: { dir: 'app/routes' },
      island: { dir: 'app/islands', upgradeStrategy: 'visible' },
      output: { outDir: 'dist' },
      viewTransition: true,
    }),
  ],
});
```

## openElement() umbrella

`openElement()` wraps `openPipeline` with the unified SSG and island plugin set. In an application **it takes no arguments**: `plugins: [...openElement()]`. Framework options have exactly one home, `openelement.config.ts` (see below), and passing them inline while that file carries options is a hard error. The low-level `openPipeline()` from `@openelement/router/vite` keeps its own explicit config shape for callers that build a pipeline directly.

## openelement.config.ts

The optional, near-empty config file: `export default defineConfig({ ... })` from `@openelement/router`. Every option it omits comes from a file convention, and the conventions follow the `dirs` block:

| Option | Convention when omitted |
| --- | --- |
| `dirs` | routes `app/routes`, islands `app/islands`, components `app/components` |
| design tokens | `<shared base>/styles/tokens.css` (inlined into every document `<head>`) |
| app shell | `<shared base>/islands/app-shell.tsx` (auto-registered; deleting the file is supported) |
| document head content | `<shared base>/head.tsx` |
| site title | the `name` field of `package.json` |

The shared base is the three roots' longest common directory: `dirs: { routes: 'src/routes', islands: 'src/islands', components: 'src/components' }` moves the tokens file to `src/styles/tokens.css`, the shell to `src/islands/app-shell.tsx` and the head module to `src/head.tsx`. A partial `dirs` has no shared segment left (`src/pages` against the default `app/*`), so it moves only what it names and the conventions stay at `app`.

Accepted keys — anything else fails the build with this list:

- `renderer` — `'native'` (default, the compiled Part Program serializer) or `'lit'`.
- `dirs` — `{ routes, islands, components }`.
- `appShell` — `false` to opt out, or `{ import, props }`. The tag name is derived from the import's basename, so it is not configurable.
- `packageIslands` — extra package names whose island modules the build admits, e.g. `['@openelement/ui']`. The loader folds the list into the SSR externalization list (a listed package is bundled, not imported at run time), which is why there is no `ssr.noExternal` key.
- `head` — the structured document-head channel: `title`, `description`, `lang`, `favicon`, `ogImage`, `stylesheets: string[]` and `scripts: { src, defer?, crossOrigin?, integrity? }[]`. Scripts and stylesheets serialize through the framework's own link/script writer, so a config entry and an inline `inject` entry emit identical bytes. `inject` itself — the framework's raw-HTML channel — deliberately has no home here.
- `styles` — `{ tokens }` to point the token convention at another file.
- `i18n` — `{ locales, defaultLocale }`; the build expands every route under each additional locale prefix.
- `viewTransition` / `speculation` — booleans. The object forms are a possible future widening of these two keys.
- `build` — `{ manifestBudget }`, an advisory per-entry manifest budget in KB.
- `middleware` — `{ corsOrigin }` static allowlist data; the origin *callback* lives in a module (`middleware.use` / `middleware.corsOriginModule`), never in the config file.

### app/head.tsx

Structural head content a URL list cannot express — site meta tags, font preloads, icon and feed links, inline critical CSS — belongs in the head convention module, not in the config file. It is compiled into the app's module graph, so it may import CSS by URL and pull constants from local modules; it must not use host APIs, because its output is a build artifact rather than a runtime read.

```tsx
// app/head.tsx — entries are data; the framework serializes them.
export default [
  { meta: { property: 'og:site_name', content: 'My App' } },
  { link: { rel: 'preload', href: '/assets/inter.woff2', as: 'font', crossorigin: 'anonymous' } },
  { style: 'html{visibility:visible!important}' },
];
```

Each entry is a `{ meta }` record, a `{ link }` record (`rel` and `href` required) or a `{ style }` CSS string, emitted in the order written. Attribute names, URL protocols and inline CSS all pass the same fail-closed checks as every other head fragment: an unsafe attribute name, a `javascript:` URL, an `@import` or a `</style>` that closes the block early fails the build instead of being dropped. Import CSS with `?raw` when the file must reach the document byte-for-byte (`?inline` runs it through Vite's CSS pipeline) — this site's pinned Prism theme is imported that way.

## Content collections are site-owned

The 1.0 router ships routing, locale/render context, the SSG descriptor and Document ownership — not a CMS or content database. A site owns its Markdown pipeline. This repository's reference site validates frontmatter against declarative schemas, renders with `marked`, treats the rendered HTML as first-party trusted content (`trustCollectionHtml` in `www/lib/content.ts`, `trustedHtml` trust level — untrusted sources must be sanitized at your own boundary first), defines collections in `www/lib/blog.ts`, and writes typed data modules with `www/tools/generate-site-content-data.ts`:

```sh
deno task --cwd www generate:content   # site:build runs this before the router build
```

Generated modules are consumed through the site's own import-map alias — there is no framework virtual module:

```json
{
  "imports": {
    "@openelement/generated/blog-data": "./app/data/_generated-blog-data.ts"
  }
}
```

Every `content/blog/*.md` compiles to one post; draft posts are excluded from production builds. frontmatter supports `title`, `date`, `draft`, `tags`, `excerpt`, `type`, `lang`.

A collection declares its directory, base path and schema:

```ts
import type { CollectionOptions } from '../lib/content.ts';

export const blogCollection: CollectionOptions = {
  contentDir: 'content/blog',
  basePath: '/blog',
  schema: {
    fields: {
      title: 'string',
      date: 'string',
      draft: 'boolean',
      tags: 'string[]',
    },
  },
};
```

### app/routes/blog/[slug].tsx — usage pattern

```tsx
// app/components/page-blog-post.tsx — compiled by the open:compiled-element transform
import { element, OpenElement, property } from '@openelement/element';

@element('blog-post-page', { root: 'shadow-open' })
export default class BlogPostPage extends OpenElement {
  @property({ reflect: false, attribute: false })
  title = '';

  @property({ reflect: false, attribute: false })
  html = '';

  render() {
    return (
      <>
        <h1>{this.title}</h1>
        {/* post.html is markdown authored in this repo — explicit trust boundary */}
        <article class='post-body' innerHTML={this.html} trustedHtml></article>
      </>
    );
  }
}
```

```ts
// app/routes/blog/[slug].tsx — the route module the scanner discovers
import { definePage, notFound } from '@openelement/router';
import { getPostBySlug, posts } from '@openelement/generated/blog-data';
import BlogPostPage from '../../components/page-blog-post.tsx';

export function getStaticPaths(): Array<Record<string, string>> {
  return posts.map((post) => ({ slug: post.slug }));
}

export default definePage(BlogPostPage, {
  renderIntent: { mode: 'static' },
  props({ params }) {
    const post = getPostBySlug(params.slug);
    if (!post) notFound(`Post not found: ${params.slug}`);
    return { title: post.frontmatter.title, html: post.html };
  },
});
```

`getStaticPaths()` pre-renders every slug; `innerHTML` + `trustedHtml` is the explicit trust boundary for markdown HTML.

## Code-block highlighting (optional)

The site-owned collection loader renders fenced blocks as `<pre><code class="language-x">` with no token-level colors. A collection's `markdown` option replaces the renderer; its output is still first-party trusted content, and hljs spans only add `class` attributes. For code blocks in routes/pages, wrap them in `<open-code-block>` (`@openelement/ui`) — it highlights via a global Prism that your page must load (core + language grammars, e.g. the vendored same-origin scripts this site vendors under `public/assets/vendor/prism/` and declares in `www/openelement.config.ts`); without Prism you get the copy button but no token spans.

### lib/blog.ts — syntax highlighting recipe (optional)

```ts
import { marked } from 'npm:marked@^15';
import hljs from 'npm:highlight.js@^11';
import type { CollectionOptions } from '../lib/content.ts';

// Default marked behavior + hljs token spans. hljs output only adds class
// attributes to <code>.
const markdown = (content: string) =>
  marked(content, {
    async: true,
    renderer: {
      code(code: string, lang: string | undefined) {
        const language = hljs.getLanguage(lang ?? '') ? lang : 'plaintext';
        const html = hljs.highlight(code, { language }).value;
        return `<pre><code class="language-${language}">${html}</code></pre>`;
      },
    },
  });

export const blogCollection: CollectionOptions = {
  contentDir: 'content/blog',
  basePath: '/blog',
  markdown,
};
```

Custom renderer output stays within the same first-party trust boundary.

## middleware.use

`middleware.use` registers fetch middleware with the WinterCG shape `(request, next) => Promise<Response>` — no HTTP-framework dialect. The chain is composed around the generated handler in onion order (`use[0]` is outermost: first to see the request, last to see the response), outside the built-in `requestId`/`logger`/`cors`/`securityHeaders`/`csp` middleware. Middleware semantics are request-time only: a static GET/HEAD is served straight from the built artifacts (`tryStatic`) and never passes through the `middleware.use` chain or the built-in middleware, so do not rely on middleware to guard prerendered pages. On the request-time dispatch path (dynamic routes, POSTs, and non-static fallbacks) the same chain runs in the dev server, the `start` CLI, the e2e fixture server, and the Nitro production entry (locked by the request-time parity contract test). A middleware may short-circuit by returning a `Response` without calling `next()`. Each entry is a **module path** (resolved like `appShell.import`): the module default-exports the middleware, and the generated server entry imports it — so middleware may close over module scope and import local helpers and third-party packages. Route-scoped `_middleware.ts` files use the same WinterCG shape: a root or nested `_middleware.ts` default-exports `(request, next) => Promise<Response>`, applied to its route subtree.

### vite.config.ts — middleware.use

`middleware.use` is the one framework option that stays inline: the config file's `middleware` block carries `corsOrigin` only, so a project that needs a middleware chain passes it through `openElement(...)` and therefore keeps that call as its framework-options home (a non-empty `openelement.config.ts` next to inline options is a hard error). Use the inline form *or* the file, never both.

```ts
import { defineConfig } from 'vite';
import { openElement } from '@openelement/router/vite';

export default defineConfig({
  plugins: [
    ...openElement({
      // Onion order: responseTime wraps guard wraps the app handler.
      middleware: {
        use: ['./app/middleware/response-time.ts', './app/middleware/guard.ts'],
      },
    }),
  ],
});
```

### app/middleware/response-time.ts

```ts
import type { Middleware } from '@openelement/element';

// A real module: close over module scope, import helpers and packages.
const started = () => performance.now();

const responseTime: Middleware = async (_request, next) => {
  const begin = started();
  const response = await next();
  response.headers.set('x-response-time', String(started() - begin));
  return response;
};

export default responseTime;
```

### app/middleware/guard.ts

```ts
import type { Middleware } from '@openelement/element';

const guard: Middleware = (request, next) => {
  // Short-circuit: skip next() and return a Response directly.
  if (new URL(request.url).pathname.startsWith('/internal')) {
    return Promise.resolve(new Response('Forbidden', { status: 403 }));
  }
  return next();
};

export default guard;
```

### middleware.corsOrigin / middleware.corsOriginModule

`middleware.corsOrigin` takes static allowlist data (`string | string[]`), serialized into the generated entry as JSON. When the allowlist needs logic, point `middleware.corsOriginModule` at a module default-exporting `(origin: string) => string | undefined` — the entry imports the module and references the callback, so it can import dependencies and close over module scope just like a `middleware.use` module. The two options are mutually exclusive (configuring both is a build-time config error).

## See also

- [Deployment](/guide/deployment) — how the configured output is emitted and served.
- [Security](/guide/security) — the middleware, CORS and CSP options in context.
- [Routing and Data](/guide/routing-and-data) — routes, rendering modes and data boundaries.
