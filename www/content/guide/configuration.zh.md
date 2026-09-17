---
title: '配置'
lede: '配置贴近它所影响的 route、build 或 package 表面。'
order: 70
---

## openPipeline()

精简的 Vite 插件入口，在 `vite.config.ts` 中配置：`openPipeline({ mode, routes: { dir }, island: { dir, upgradeStrategy }, output: { outDir }, viewTransition, headExtras })`。默认值：routes 为 `app/routes`，islands 为 `app/islands`，components 为 `app/components`，`viewTransition` 开启。`headExtras` 是开发者可信输入，以 `trustedHtml` 信任级别原样透传——框架不做消毒。`script` 标签直接拒绝（脚本请走 `inject.scripts`），`style` 块不得携带可执行 CSS；其余内容（含 `base` 与 `meta http-equiv`）由片段作者负责（#931）。

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

## openElement() 伞入口

`openElement()` 用统一的 SSG 与 island 插件集包装 `openPipeline`。它接受扁平框架选项——`routesDir`、`islandsDir`、`componentsDir`、`packageIslands`、`html`、`inject`、`middleware`——外加用于 locale 前缀构建的 `i18n: { locales, defaultLocale }`，以及 SSG 渲染失败策略 `ssg: { dynamicRouteFailure: 'fail' | 'warn' }`。内容 collection 不在其中；markdown/frontmatter 解析、schema、collection、导航与文档路由映射均由站点自己拥有。

## 内容 collection 归站点所有

1.0 的 router 提供路由、locale/渲染上下文、SSG descriptor 与 Document 归属——不是 CMS，也不是内容数据库。站点的 Markdown 管线由站点自己拥有。本仓库的参考站点用声明式 schema 校验 frontmatter、用 `marked` 渲染、把渲染结果视为第一方可信内容（`www/lib/content.ts` 的 `trustCollectionHtml`，`trustedHtml` 信任级别——非可信来源请先在你自己的边界消毒），在 `www/lib/blog.ts` 中定义 collection，并用 `tools/repo/generate-site-content-data.ts` 写出带类型的数据模块：

```sh
deno task --cwd tools/repo generate:site-content-data   # site:build 会在 router 构建前先运行
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

站点自有的 collection loader 把围栏代码块渲染为 `<pre><code class="language-x">`，无 token 级着色。collection 的 `markdown` 选项可以替换 renderer；其输出仍是第一方可信内容，hljs span 只追加 `class` 属性。路由/页面里的代码块则用 `<open-code-block>`（`@openelement/ui`）包裹——它通过全局 Prism 高亮，页面必须自行加载 Prism（core + 语言 grammar，参考本站在 `www/vite.config.ts` 注入的 vendored 同源 script，来自 `public/assets/vendor/prism/`）；不加载 Prism 就只有 copy 按钮、没有 token 着色。

### lib/blog.ts —— 语法高亮配方（可选，#930）

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

自定义 renderer 的输出保持在同一第一方信任边界内。

## middleware.use

`middleware.use`（ADR-0123（已退役，可从 Git 历史恢复），#858）注册 WinterCG 形态的 fetch 中间件：`(request, next) => Promise<Response>`——不含任何 HTTP 框架方言。中间件链在生成的 handler 边界按洋葱序组合（`use[0]` 最外层：最先看到请求，最后看到响应），位于内置 `requestId`/`logger`/`cors`/`securityHeaders`/`csp` 中间件之外。中间件语义仅作用于请求时路径：静态 GET/HEAD 由构建产物直接给出（`tryStatic`），不经过 `middleware.use` 链与内置中间件，因此不要用中间件守卫预渲染页面。在请求时派发路径（dynamic 路由、POST 与非静态回退）上，dev server、`start` CLI、e2e fixture server 与 Nitro 生产入口运行同一条中间件链（由 request-time parity 契约测试锁定）。中间件可以不调用 `next()` 直接返回 `Response` 来短路。每一项是一个**模块路径**（解析方式与 `appShell.import` 相同）：模块默认导出中间件，生成的 server entry 直接 import 该模块——因此中间件可以闭包引用模块作用域，也可以 import 本地 helper 和第三方包。路由级 `_middleware.ts` 文件使用同一 WinterCG 形态：根级或嵌套的 `_middleware.ts` 默认导出 `(request, next) => Promise<Response>`，作用于其路由子树。

### vite.config.ts —— middleware.use（#858）

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

`middleware.corsOrigin` 接受静态白名单数据（`string | string[]`），以 JSON 形式序列化进生成的 entry。当白名单需要逻辑判断时，用 `middleware.corsOriginModule` 指向一个默认导出 `(origin: string) => string | undefined` 的模块——entry 会 import 该模块并引用这个回调，因此它可以像 `middleware.use` 模块一样 import 依赖、闭包引用模块作用域。两个选项互斥（同时配置会在构建期报配置错误）。
