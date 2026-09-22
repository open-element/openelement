---
title: '配置'
lede: '配置贴近它所影响的 route、build 或 package 表面。'
order: 70
---

## openPipeline()

精简的 Vite 插件入口，在 `vite.config.ts` 中配置：`openPipeline({ mode, routes: { dir }, island: { dir, upgradeStrategy }, output: { outDir }, viewTransition, headExtras })`。默认值：routes 为 `app/routes`，islands 为 `app/islands`，components 为 `app/components`，`viewTransition` 开启。`headExtras` 是开发者可信输入，以 `trustedHtml` 信任级别原样透传——框架不做消毒。`script` 标签直接拒绝（脚本请走 `inject.scripts`），`style` 块不得携带可执行 CSS；其余内容（含 `base` 与 `meta http-equiv`）由片段作者负责。

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

`openElement()` 用统一的 SSG 与 island 插件集包装 `openPipeline`。在应用里它**不接受参数**：`plugins: [...openElement()]`。框架选项只有一个家，即 `openelement.config.ts`（见下）；当该文件已带选项时再内联传参是硬错误。需要自行搭管线的调用方仍可直接使用 `@openelement/router/vite` 的 `openPipeline()`，它有自己显式的配置形状。

## openelement.config.ts

可选且近乎为空的配置文件：`export default defineConfig({ ... })`，`defineConfig` 从 `@openelement/router` 导入。它省略的每个选项都由文件约定提供，而约定会跟着 `dirs` 一起移动：

| 选项 | 省略时的约定 |
| --- | --- |
| `dirs` | routes `app/routes`、islands `app/islands`、components `app/components` |
| 设计 token | `<共享基目录>/styles/tokens.css`（内联进每个文档 `<head>`） |
| app shell | `<共享基目录>/islands/app-shell.tsx`（自动注册；删除该文件是受支持的） |
| 文档头内容 | `<共享基目录>/head.tsx` |
| 站点标题 | `package.json` 的 `name` 字段 |

共享基目录是三个根的公共前缀：`dirs: { routes: 'src/routes', islands: 'src/islands', components: 'src/components' }` 会把 token 文件移到 `src/styles/tokens.css`、shell 移到 `src/islands/app-shell.tsx`、head 模块移到 `src/head.tsx`。部分覆盖的 `dirs` 不再与默认的 `app/*` 共享前缀（例如只写 `src/pages`），因此它只移动自己点名的根，约定仍留在 `app`。

可接受的键——其余任何键都会以这份列表报错并让构建失败：

- `renderer`——`'native'`（默认，编译后的 Part Program 序列化器）或 `'lit'`。
- `dirs`——`{ routes, islands, components }`。
- `appShell`——`false` 表示退出约定，或 `{ import, props }`。标签名由 import 的文件名推导，因此不可配置。
- `packageIslands`——构建额外接纳其 island 模块的包名，例如 `['@openelement/ui']`。加载器会把该列表并入 SSR 外部化列表（列出的包被打包而非运行时导入），因此没有 `ssr.noExternal` 键。
- `head`——结构化文档头通道：`title`、`description`、`lang`、`favicon`、`ogImage`、`stylesheets: string[]` 与 `scripts: { src, defer?, crossOrigin?, integrity? }[]`。脚本与样式表都经框架自己的 link/script 序列化器写出，因此配置条目与内联 `inject` 条目产出的字节完全一致。`inject` 本身——框架的原始 HTML 通道——刻意在这里没有家。
- `styles`——`{ tokens }`，把 token 约定指向另一个文件。
- `i18n`——`{ locales, defaultLocale }`；构建会在每个额外 locale 前缀下展开所有路由。
- `viewTransition` / `speculation`——布尔值。对象形式是这两个键将来可能的扩展方向。
- `build`——`{ manifestBudget }`，以 KB 为单位的建议性 manifest 预算。
- `middleware`——`{ corsOrigin }` 静态白名单数据；来源**回调**放在模块里（`middleware.use` / `middleware.corsOriginModule`），永远不进配置文件。

### app/head.tsx

URL 列表无法表达的结构性 head 内容——站点 meta 标签、字体预加载、图标与 feed 链接、内联关键 CSS——属于 head 约定模块，而不是配置文件。它会被编译进应用的模块图，因此可以按 URL 导入 CSS、从本地模块取常量；它不得使用宿主 API，因为它的产物是构建产物而不是运行时读取。

```tsx
// app/head.tsx —— 条目都是数据；由框架序列化。
export default [
  { meta: { property: 'og:site_name', content: 'My App' } },
  { link: { rel: 'preload', href: '/assets/inter.woff2', as: 'font', crossorigin: 'anonymous' } },
  { style: 'html{visibility:visible!important}' },
];
```

每个条目是 `{ meta }` 记录、`{ link }` 记录（`rel` 与 `href` 必填）或 `{ style }` CSS 字符串，按书写顺序输出。属性名、URL 协议与内联 CSS 都经过与其他 head 片段完全相同的 fail-closed 检查：不安全的属性名、`javascript:` URL、`@import` 或提前闭合的 `</style>` 会让构建失败，而不是被静默丢弃。需要文件字节原样进入文档时用 `?raw` 导入 CSS（`?inline` 会让它过一遍 Vite 的 CSS 管线）——本站固定的 Prism 主题就是这样导入的。

## 内容 collection 归站点所有

1.0 的 router 提供路由、locale/渲染上下文、SSG descriptor 与 Document 归属——不是 CMS，也不是内容数据库。站点的 Markdown 管线由站点自己拥有。本仓库的参考站点用声明式 schema 校验 frontmatter、用 `marked` 渲染、把渲染结果视为第一方可信内容（`www/lib/content.ts` 的 `trustCollectionHtml`，`trustedHtml` 信任级别——非可信来源请先在你自己的边界消毒），在 `www/lib/blog.ts` 中定义 collection，并用 `www/tools/generate-site-content-data.ts` 写出带类型的数据模块：

```sh
deno task --cwd www generate:content   # site:build 会在 router 构建前先运行
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

### app/routes/blog/[slug].tsx —— 使用模式

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

站点自有的 collection loader 把围栏代码块渲染为 `<pre><code class="language-x">`，无 token 级着色。collection 的 `markdown` 选项可以替换 renderer；其输出仍是第一方可信内容，hljs span 只追加 `class` 属性。路由/页面里的代码块则用 `<open-code-block>`（`@openelement/ui`）包裹——它通过全局 Prism 高亮，页面必须自行加载 Prism（core + 语言 grammar，参考本站 vendored 在 `public/assets/vendor/prism/` 并在 `www/openelement.config.ts` 声明的同源 script）；不加载 Prism 就只有 copy 按钮、没有 token 着色。

### lib/blog.ts —— 语法高亮配方（可选）

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

`middleware.use` 注册 WinterCG 形态的 fetch 中间件：`(request, next) => Promise<Response>`——不含任何 HTTP 框架方言。中间件链在生成的 handler 边界按洋葱序组合（`use[0]` 最外层：最先看到请求，最后看到响应），位于内置 `requestId`/`logger`/`cors`/`securityHeaders`/`csp` 中间件之外。中间件语义仅作用于请求时路径：静态 GET/HEAD 由构建产物直接给出（`tryStatic`），不经过 `middleware.use` 链与内置中间件，因此不要用中间件守卫预渲染页面。在请求时派发路径（dynamic 路由、POST 与非静态回退）上，dev server、`start` CLI、e2e fixture server 与 Nitro 生产入口运行同一条中间件链（由 request-time parity 契约测试锁定）。中间件可以不调用 `next()` 直接返回 `Response` 来短路。每一项是一个**模块路径**（解析方式与 `appShell.import` 相同）：模块默认导出中间件，生成的 server entry 直接 import 该模块——因此中间件可以闭包引用模块作用域，也可以 import 本地 helper 和第三方包。路由级 `_middleware.ts` 文件使用同一 WinterCG 形态：根级或嵌套的 `_middleware.ts` 默认导出 `(request, next) => Promise<Response>`，作用于其路由子树。

### vite.config.ts —— middleware.use

`middleware.use` 是唯一保留内联的框架选项：配置文件的 `middleware` 块只承载 `corsOrigin`，因此需要中间件链的项目通过 `openElement(...)` 传入，并把这次调用作为框架选项的家（非空的 `openelement.config.ts` 与内联选项同时存在是硬错误）。内联形式与配置文件**二选一**，不可并用。

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

## 另见

- [部署](/zh/guide/deployment)——配置好的产物如何生成与伺服。
- [安全](/zh/guide/security)——中间件、CORS 与 CSP 选项的上下文。
- [路由与数据](/zh/guide/routing-and-data)——路由、渲染模式与数据边界。
