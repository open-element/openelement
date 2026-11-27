---
title: '配置'
lede: '配置贴近它所影响的 route、build 或 package 表面。'
order: 70
---

## openPipeline()

精简的 Vite 插件入口，在 `vite.config.ts` 中配置：`openPipeline({ routes: { dir }, island: { dir, upgradeStrategy }, output: { outDir }, viewTransition, headExtras })`。默认值：routes 为 `app/routes`，islands 为 `app/islands`，`viewTransition` 开启。`headExtras` 是开发者可信输入，以 `trustedHtml` 信任级别原样透传——框架不做消毒。`<script>` 标签直接拒绝（脚本请走 `inject.scripts`），`<style>` 块不得携带可执行 CSS；其余内容（含 `base` 与 `meta http-equiv`）由片段作者负责。

### vite.config.ts

```ts
import { defineConfig } from 'vite';
import { openPipeline } from '@openelement/router/vite';

export default defineConfig({
  plugins: [
    openPipeline({
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
| layout | `<共享基目录>/layout.tsx`（自动注册；删除该文件是受支持的） |
| 文档头内容 | `<共享基目录>/head.tsx` |
| 站点标题 | `package.json` 的 `name` 字段 |

共享基目录是三个根的公共前缀：`dirs: { routes: 'src/routes', islands: 'src/islands', components: 'src/components' }` 会把 token 文件移到 `src/styles/tokens.css`、layout 移到 `src/layout.tsx`、head 模块移到 `src/head.tsx`。部分覆盖的 `dirs` 不再与默认的 `app/*` 共享前缀（例如只写 `src/pages`），因此它只移动自己点名的根，约定仍留在 `app`。

### tokens.css 与 theme.css

两张样式表职责不同：

- `tokens.css` 就是上表中的通用 token 约定：一张普通样式表，框架把它内联进每个文档 `<head>`，不经构建步骤、与 Tailwind 无关。触发它的是文件是否存在——建了这张表，它就会被内联进每个页面；`styles: { tokens }` 可把约定指向别的文件。
- `theme.css` 是 starter 的 Tailwind 样式表。它不是框架约定——脚手架通过 `openelement.config.ts` 里的 `tailwind: { theme: ['app/styles/theme.css'] }` 显式点名它。该键与上面的约定相互独立：dev 编译声明的源并在文档头以 link 交付编译产物，build 把同一份编译结果作为 `client/assets/` 下的内容寻址资产输出并链接（`/client/assets/<hash>.css`，文件名取自构建自身的 manifest，从不手写）。角色落在 Tailwind 的 `theme` 层，而不是一段原样内联的样式。

脚手架项目把 token 放在它声明的 `theme.css` 里，于是只有一个 token 来源而不是两个——但这是项目选择，不是框架强制的规则。框架真正强制的是「框架选项只有一个家」：`openelement.config.ts` 已带选项时再往 `openElement()` 内联传选项是硬错误。如果你同时保留 `tokens.css` 约定文件与 `tailwind.theme` 样式表，两者都会生效，保持一致的责任在使用方。

### 一条策略，两条样式表通道

样式面是两种交付，一张样式表走哪一条由它的**角色**决定，而不是它所在的文件：

| 通道 | 承载什么 | 如何交付 |
| --- | --- | --- |
| document | token/角色表、引擎的 preflight 层，以及 light DOM 用到的工具类 | 一份编译后、内容寻址的样式表，由每个文档的 `<head>` 链接（引擎自身的编译，由所选 provider 驱动） |
| component | 某个 **shadow root** 已准入 class 所需的工具类 | 同一 provider 针对 shadow 候选集的编译产物，经框架的样式资产协议交付——由每个 DSD 模板声明，并在每个 realm 内被采纳为一张共享的 `CSSStyleSheet` |

这个划分不是打包细节：把 reset 或 token 表放进组件的 shadow 树，会改变每一个既有组件的渲染方式，所以 component 样式表只承载工具类，document 样式表拥有一切全局内容。应用自己撰写的 `.css` 文件按它自己的 import 路径走；由引擎编译的样式表则由所选 provider 决定去向。

`tailwind` 决定这条管线是否存在，而包也可以自己声明这个需求。省略该键时，只有**被准入的包声明了需求**才会编译 Tailwind：被接纳的包——显式声明、或由应用真实导入推导而来（见下文 `packageIslands`）——其 manifest 里的 `openElement.tailwind` 块（`OpenElementExtensions`，框架在标准包 manifest 上的命名空间扩展——不是第二种元数据格式，也不是 `custom-elements.json`：Custom Elements Manifest 依旧是标签、属性、成员、事件、slot 与 part 的通用交换权威）要么要求编译（`required: true`——此时关闭该入口会让构建以带码诊断失败，而不是发出没有样式的组件），要么提供随它一起编译的包自有样式源（`sources: ['./theme.css']`，包内相对路径，在已安装的包内解析）。使用方无需重复属主的样式源：声明的源先编译，应用自己的 `theme` 条目在其后；同一个文件即使以不同写法出现两次也只编译一次（按解析到的文件去重）。应用本地的 class 不会自行打开这条管线——自己写 utility 的应用要自己声明 `tailwind`。`true` 只编译声明的源、不含应用自己的源；`false` 完全关闭管线（不加载 peer、不编译、不产出样式表），并在被准入组件要求编译时失败关闭。

可接受的键——其余任何键都会以这份列表报错并让构建失败：

- `renderer`——原生渲染后端，接受 `'native'`（默认值）。
- `dirs`——`{ routes, islands, components }`。
- `layout`——`false` 表示退出约定，或 `{ import, props }`。标签名由 import 的文件名推导，因此不可配置。
- `packageIslands`——组件包如何被接纳。省略或 `'auto'`（默认）：构建在 scan 期推导被接纳的集合——应用的路由、页面、布局、岛与组件真正导入的每一个包属主元素模块（经打包器解析）都按其属主包归因，拥有有效 openElement manifest 的包无需任何配置即被接纳。数组在推导之外追加显式条目（如 `['@openelement/ui']`）；两个包声明同名标签时，显式条目优先于推导条目。`'manual'` 关闭推导：只接纳列出的包，导入未列出组件包的行为会以显式声明的修法被报告。应用导入了某包的元素模块、而该包没有有效 manifest 时，它永远不会被接纳（无可接纳之物）并被报告——这是 auto 下保留的唯一真实失误类报告。推导还会把每个被接纳的包并入 SSR 外部化列表（被接纳的包被打包而非运行时导入），因此没有 `ssr.noExternal` 键。
- `head`——结构化文档头通道：`title`、`description`、`lang`、`favicon`、`ogImage`、`stylesheets: string[]` 与 `scripts: { src, defer?, crossOrigin?, integrity? }[]`。脚本与样式表都经框架自己的 link/script 序列化器写出，因此配置条目与内联 `inject` 条目产出的字节完全一致。`inject` 本身——框架的原始 HTML 通道——刻意在这里没有家。`lang` 设置 `<html lang>`，默认 `en`；配置了 `i18n` 时，按请求路径推导出的 locale 会覆盖它（ADR-0172）。
- `styles`——`{ tokens }`，把 token 约定指向另一个文件。
- `i18n`——`{ locales, defaultLocale }`；构建会在每个额外 locale 前缀下展开所有路由。
- `viewTransition` / `speculation`——布尔值。对象形式是这两个键将来可能的扩展方向。
  这里的 `viewTransition` 是构建侧开关（客户端导航是否携带 View Transition 元信息）。它与客户端路由的 `viewTransitions` 选项（`createRouter`，默认关）是两个不同的旋钮——后者把每次导航的渲染包进 `document.startViewTransition`，因输入抑制问题保持 opt-in（其 JSDoc 记录了原因）。

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

每个条目是 `{ meta }` 记录、`{ link }` 记录（`rel` 与 `href` 必填）或 `{ style }` CSS 字符串，按书写顺序输出。属性名、URL 协议与内联 CSS 都经过与其他 head 片段完全相同的 fail-closed 检查：不安全的属性名、`javascript:` URL、`@import` 或提前闭合的 `</style>` 会让构建失败，而不是被静默丢弃。需要文件字节原样进入文档时用 `?raw` 导入 CSS（`?inline` 会让它过一遍 Vite 的 CSS 管线）。

## 内容 collection 归站点所有

参考站点在 [`www/content-collections.ts`](https://github.com/open-element/openelement/blob/main/www/content-collections.ts) 定义指南和架构文档的 frontmatter schema。构建先校验并渲染 Markdown，再为每份指南生成共享的服务端文章视图所用的数据。传入 `trustedHtml` 的外部内容需要先经过清理。

## 代码块语法高亮

参考站点在构建期间使用 Shiki 高亮有语言标签的代码块。高亮后的 HTML 和主题样式随页面交付。向 Markdown 围栏添加语言标签，例如 `tsx` 或 `bash`，即可启用高亮。

## middleware.use

`middleware.use` 注册 WinterCG 形态的 fetch 中间件：`(request, next) => Promise<Response>`——不含任何 HTTP 框架方言。中间件链在生成的 handler 边界按洋葱序组合（`use[0]` 最外层：最先看到请求，最后看到响应），位于内置 `requestId`/`logger`/`cors`/`securityHeaders`/`csp` 中间件之外。中间件语义仅作用于请求时路径：静态 GET/HEAD 由构建产物直接给出（`tryStatic`），不经过 `middleware.use` 链与内置中间件，因此不要用中间件守卫预渲染页面。在请求时派发路径（dynamic 路由、POST 与非静态回退）上，dev server、`start` CLI、e2e fixture server 与 Nitro 生产入口运行同一条中间件链（由 request-time parity 契约测试锁定）。中间件可以不调用 `next()` 直接返回 `Response` 来短路。每一项是一个**模块路径**（解析方式与 `layout.import` 相同）：模块默认导出中间件，生成的 server entry 直接 import 该模块——因此中间件可以闭包引用模块作用域，也可以 import 本地 helper 和第三方包。路由级 `_middleware.ts` 文件使用同一 WinterCG 形态：根级或嵌套的 `_middleware.ts` 默认导出 `(request, next) => Promise<Response>`，作用于其路由子树。

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
