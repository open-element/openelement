---
title: '配置'
lede: '配置贴近它所影响的 route、build 或 package 表面。'
order: 70
---

## openPipeline()

精简的 Vite 插件入口，在 `vite.config.ts` 中配置：`openPipeline({ mode, routes: { dir }, island: { dir, upgradeStrategy }, output: { outDir }, viewTransition, headExtras })`。默认值：routes 为 `app/routes`，islands 为 `app/islands`，components 为 `app/components`，`viewTransition` 开启。`headExtras` 注入前按 head allowlist 消毒——仅放行 `link`/`meta`/`noscript`/`title`，`base` 与 `meta http-equiv` 被剔除，`script` 标签直接拒绝（脚本请走 `inject.scripts`）（#931，已按 ADR-0122 冻结）。

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

## openElement() 伞入口

`openElement()` 用统一的 SSG 与 island 插件集包装 `openPipeline`。它接受扁平框架选项——`routesDir`、`islandsDir`、`componentsDir`、`packageIslands`、`html`、`inject`、`middleware`——外加用于 locale 前缀构建的 `i18n: { locales, defaultLocale }`，以及 SSG 渲染失败策略 `ssg: { dynamicRouteFailure: 'fail' | 'warn' }`。内容 collection 不在其中；markdown/frontmatter 解析、schema、collection、导航与文档路由映射均由站点自己拥有。

## 内容 collection 归站点所有

1.0 的 router 提供路由、locale/渲染上下文、SSG descriptor 与 Document 归属——不是 CMS，也不是内容数据库。站点的 Markdown 管线由站点自己拥有。本仓库的参考站点用声明式 schema 校验 frontmatter、用 `marked` 渲染、用 `@openelement/element/sanitize` 的 `sanitizeHtml` 清洗（`www/lib/content.ts`），在 `www/lib/blog.ts` 中定义 collection，并用 `tools/generate-www-content-data.ts` 写出带类型的数据模块：

```sh
deno task generate:www-content-data   # www:build 会在 router 构建前先运行
```

生成模块通过站点自己的 import-map 别名消费——不存在框架虚拟模块：

```json
{
  "imports": {
    "@openelement/generated/blog-data": "./app/data/_generated-blog-data.ts"
  }
}
```

每篇 `content/blog/*.md` 编译为一个 post；draft 文章在 production 构建中被排除。frontmatter 支持 `title`、`date`、`draft`、`tags`、`excerpt`、`type`、`lang`。

collection 声明自己的目录、base path 与 schema：

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

### app/routes/blog/[slug].tsx —— 使用模式（#924）

```tsx
// app/components/page-blog-post.tsx —— 由 open:compiled-element transform 编译
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
// app/routes/blog/[slug].tsx —— scanner 发现的路由模块
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

`getStaticPaths()` 预渲染每个 slug；`innerHTML` + `trustedHtml` 是渲染 markdown HTML 的显式信任边界。

## 代码块语法高亮（可选）

站点自有的 collection loader 把围栏代码块渲染为 `<pre><code class="language-x">`，无 token 级着色。collection 的 `markdown` 选项可以替换 renderer；其输出仍会经过同一道 sanitizer 白名单（`www/lib/content.ts` 的 `sanitizeHtml`），hljs span 只追加 `class` 属性，原样通过。路由/页面里的代码块则用 `<open-code-block>`（`@openelement/ui`）包裹——它通过全局 Prism 高亮，页面必须自行加载 Prism（core + 语言 grammar，参考本站在 `www/vite.config.ts` 注入的 CDN script）；不加载 Prism 就只有 copy 按钮、没有 token 着色。

### lib/blog.ts —— 语法高亮配方（可选，#930）

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

自定义 renderer 的输出仍会经过同一道 sanitizer 白名单（class 属性保留）。

## middleware.use

`middleware.use`（ADR-0123，#858）注册 WinterCG 形态的 fetch 中间件：`(request, next) => Promise<Response>`——不含任何 HTTP 框架方言。中间件链在生成的 handler 边界按洋葱序组合（`use[0]` 最外层：最先看到请求，最后看到响应），位于内置 `requestId`/`logger`/`cors`/`securityHeaders`/`csp` 中间件之外，并在 dev server、`start` CLI、e2e fixture server 与 Nitro 生产入口四个运行时中保持完全一致的语义（由 request-time parity 契约测试锁定）。中间件可以不调用 `next()` 直接返回 `Response` 来短路。一个约束：中间件源码会被内联进生成的 server entry（与函数形态的 `corsOrigin` 同一机制），因此每个中间件必须自包含——不能闭包引用 `vite.config.ts` 模块作用域的变量。路由级 `_middleware.ts` 文件保留 Hono 方言，在应用内部依然可用。

### vite.config.ts —— middleware.use（#858）

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

`openPipeline({ mode: 'spa' })` 产出纯客户端应用（无 SSR）。用 `@openelement/router` 的 `defineApp({ mode: 'spa', routes })` 启动：每条路由是 `{ path, tagName, loader?, action?, guard? }`，路径支持 `:id` 参数与 `:path{.+}` 多段 catch-all（Hono 风格）。`mount(selector)` 挂载 client router。页面类是编译的 `@element` 类，loader 数据由其 `@property` 字段承载；bootstrap 需导入每个页面模块，使其类在 `mount` 前完成注册。

### app/main.ts —— SPA 启动

```tsx
// app/components/page-home.tsx —— 由 open:compiled-element transform 编译
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
// 'page-doc' 以同样方式导入

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

SPA 链上 `redirect()`/`notFound()` 仍然有效：redirect 交给 client router 导航，notFound 走页面 error 投影器；其余 throw 会被规整为 action 数据。

## SPA 与 SSG 两链

SPA 的 loader/action 运行在客户端，上下文只有 `{ params }`（action 另有 `formData`），通过抛出异常表达失败；SSG/request-time 链运行在服务端，使用 Web 标准上下文与 `fail()`/`redirect()` 协议。两者命名刻意平行，上下文并不相同（ADR-0119 已冻结的 SPA 语义）。
