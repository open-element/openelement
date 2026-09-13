---
title: 'Configuration'
lede: 'Configuration stays close to the route, build or package surface it affects.'
order: 70
---

## openPipeline()

The lean Vite plugin entry, configured in `vite.config.ts`: `openPipeline({ mode, routes: { dir }, island: { dir, upgradeStrategy }, output: { outDir }, viewTransition, headExtras })`. Defaults: routes `app/routes`, islands `app/islands`, components `app/components`, `viewTransition` on. `headExtras` is sanitized on injection against a head allowlist — only `link`/`meta`/`noscript`/`title` survive, `base` and `meta http-equiv` are stripped, and `script` tags are rejected outright (use `inject.scripts` for scripts) (#931; frozen under ADR-0122).

### vite.config.ts

```ts
import { defineConfig } from 'vite';
import { openPipeline } from '@openelement/router/vite';

export default defineConfig({
  plugins: [
    openPipeline({
      mode: 'ssg', // default; 'spa' produces a client-only app
      routes: { dir: 'app/routes' },
      island: { dir: 'app/islands', upgradeStrategy: 'visible' },
      output: { outDir: 'dist' },
      viewTransition: true,
    }),
  ],
});
```

## openElement() umbrella

`openElement()` wraps `openPipeline` with the unified SSG and island plugin set. It takes the flat framework options — `routesDir`, `islandsDir`, `componentsDir`, `packageIslands`, `html`, `inject`, `middleware` — plus `i18n: { locales, defaultLocale }` for locale-prefixed builds and `ssg: { dynamicRouteFailure: 'fail' | 'warn' }` for the SSG render-failure policy. Content collections are not part of it; markdown/frontmatter parsing, schemas, collections, navigation and document-route mapping are site-owned.

## Content collections are site-owned

The 1.0 router ships routing, locale/render context, the SSG descriptor and Document ownership — not a CMS or content database. A site owns its Markdown pipeline. This repository's reference site validates frontmatter against declarative schemas, renders with `marked`, sanitizes with `sanitizeHtml` from `@openelement/element/sanitize` (`www/lib/content.ts`), defines collections in `www/lib/blog.ts`, and writes typed data modules with `tools/generate-www-content-data.ts`:

```sh
deno task generate:www-content-data   # www:build runs this before the router build
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

### app/routes/blog/[slug].tsx — usage pattern (#924)

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

The site-owned collection loader renders fenced blocks as `<pre><code class="language-x">` with no token-level colors. A collection's `markdown` option replaces the renderer; its output still crosses the shared sanitizer allow-list (`sanitizeHtml` in `www/lib/content.ts`), and hljs spans only add `class` attributes, which pass untouched. For code blocks in routes/pages, wrap them in `<open-code-block>` (`@openelement/ui`) — it highlights via a global Prism that your page must load (core + language grammars, e.g. the CDN scripts this site injects in `www/vite.config.ts`); without Prism you get the copy button but no token spans.

### lib/blog.ts — syntax highlighting recipe (optional, #930)

```ts
import { marked } from 'npm:marked@^15';
import hljs from 'npm:highlight.js@^11';
import type { CollectionOptions } from '../lib/content.ts';

// Default marked behavior + hljs token spans. hljs output only adds class
// attributes to <code>, which the sanitizer allowlist keeps.
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

Custom renderer output still passes the same sanitizer allowlist (class attributes are kept).

## middleware.use

`middleware.use` (ADR-0123, #858) registers fetch middleware with the WinterCG shape `(request, next) => Promise<Response>` — no HTTP-framework dialect. The chain is composed around the generated handler in onion order (`use[0]` is outermost: first to see the request, last to see the response), outside the built-in `requestId`/`logger`/`cors`/`securityHeaders`/`csp` middleware, and runs with identical semantics in the dev server, the `start` CLI, the e2e fixture server, and the Nitro production entry (locked by the request-time parity contract test). A middleware may short-circuit by returning a `Response` without calling `next()`. One constraint: middleware sources are inlined into the generated server entry (same mechanism as a function-valued `corsOrigin`), so each middleware must be self-contained — no closures over the `vite.config.ts` module scope. Route-scoped `_middleware.ts` files keep the Hono dialect and remain available inside the app.

### vite.config.ts — middleware.use (#858)

```ts
import { defineConfig } from 'vite';
import { openElement } from '@openelement/router/vite';
import type { Middleware } from '@openelement/element';

// Self-contained: the source is inlined into the generated server entry,
// so it cannot close over vite.config.ts module scope.
const responseTime: Middleware = async (request, next) => {
  const started = Date.now();
  const response = await next();
  response.headers.set('x-response-time', String(Date.now() - started));
  return response;
};

const guard: Middleware = (request, next) => {
  // Short-circuit: skip next() and return a Response directly.
  if (new URL(request.url).pathname.startsWith('/internal')) {
    return Promise.resolve(new Response('Forbidden', { status: 403 }));
  }
  return next();
};

export default defineConfig({
  plugins: [
    ...openElement({
      // Onion order: responseTime wraps guard wraps the app handler.
      middleware: { use: [responseTime, guard] },
    }),
  ],
});
```

## mode: 'spa'

`openPipeline({ mode: 'spa' })` produces a client-only app (no SSR). Bootstrap with `defineApp({ mode: 'spa', routes })` from `@openelement/router`: each route is `{ path, tagName, loader?, action?, guard? }`, paths take `:id` params and the `:path{.+}` multi-segment catch-all (Hono-style). `mount(selector)` attaches the client router. Page classes are compiled `@element` classes whose `@property` fields carry the loader data; the bootstrap imports each page module so its class is registered before `mount`.

### app/main.ts — SPA bootstrap

```tsx
// app/components/page-home.tsx — compiled by the open:compiled-element transform
import { element, OpenElement, property } from '@openelement/element';

@element('page-home', { root: 'shadow-open' })
export default class HomePage extends OpenElement {
  @property({ reflect: false, attribute: false })
  now = '';

  render() {
    return <main><h1>home</h1><p>{this.now}</p></main>;
  }
}
```

```ts
// app/main.ts
import { defineApp } from '@openelement/router';
import './components/page-home.tsx';
// import 'page-doc' the same way

const app = defineApp({
  mode: 'spa',
  routes: [
    {
      path: '/',
      tagName: 'page-home',
      loader: async () => ({ now: new Date().toISOString() }),
    },
    // multi-segment catch-all (Hono-style)
    { path: '/docs/:path{.+}', tagName: 'page-doc' },
  ],
});

app.mount('#app');
```

`redirect()`/`notFound()` still work on the SPA chain: a redirect navigates the client router, a notFound rides the page error projector; any other throw is normalized into action data.

## SPA vs SSG chains

SPA loaders/actions run client-side with only `{ params }` (actions also get `formData`) and signal failure by throwing; the SSG/request-time chain runs on the server with the Web-standard context and the `fail()`/`redirect()` protocol. The names are intentionally parallel, the contexts are not (ADR-0119 frozen SPA semantics).
