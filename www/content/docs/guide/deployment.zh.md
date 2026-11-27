---
title: '部署'
lede: '部署围绕生成的静态输出与 adapter 各自的运行时边界展开。'
order: 100
---

## Build、start、preview

脚手架生成的项目把脚本接到 router 的 bin——`oe`（短名；`openelement` 是同一个 dispatcher）：

```bash
npm run build  # 生成公开目录与请求时产物
npm start      # 伺服 dist-public/；dynamic 路由与变更请求分派给 dist/server
npm run dev    # Vite 开发服务器
```

`npm start` 静态伺服 `dist-public/`，并在 `dist/server/index.js` 存在时把 dynamic 路由与变更请求分派给它。端口取 `OPEN_ELEMENT_PORT`（其次 `PORT`，默认 4173），主机取 `OPEN_ELEMENT_HOST`。同一条命令加 `--mode=preview`（`openelement start --mode=preview`）即只伺服静态产物，发现 `dist/server` 时会拒绝运行并指向 start 模式——只对没有请求时路由的项目使用它。

### 部署在代理之后

保护表单提交的同源检查，是把浏览器的 `Origin` 头与服务端所看到的请求来源作比较。TLS 终止代理转发过来的是明文 HTTP，于是服务端自己推断出的是 `http://…`、浏览器给的是 `https://…`，一条完全合法的同源 POST 会被判成跨站而拒绝。两个环境变量用来补上服务端无法自行得知的信息：

- `OPEN_ELEMENT_PUBLIC_ORIGIN=https://example.com`——站点对浏览器可见的来源。这是最直接的答案，优先用它。
- `OPEN_ELEMENT_TRUST_PROXY=1`——读取入站请求上的 `Forwarded` / `X-Forwarded-Proto` / `X-Forwarded-Host`。**只在**除你自己的代理之外没有任何东西能访问该端口时设置：在可被直接访问的服务端上，这些头就是客户端输入，信任它们等于让调用方自行选择检查所依据的来源。

两者都不设时，来源保持 `http://<Host>`——对于自己直接面向公网的服务端，这就是正确答案。

## 静态输出

`npm run build` 生成独立的 `dist-public/`。其中包含预渲染页面、`public/` 中的公开资源、浏览器代码和样式，以及每页的 island 清单。浏览器 URL 仍使用 `/client/` 资源前缀。

`dist/publish-manifest.json` 记录每个公开文件的相对路径、字节数、SHA-256 和缓存策略。上传到静态托管前，运行 `npx oe publish --check` 验证目录与清单完全一致。静态宿主只接收 `dist-public/`，可以为目录下的 `index.html` 和站点的 `404.html` 配置相应规则。需要请求时路由或 action 的应用另行部署服务端入口。

### 纯静态：Cloudflare Pages

要将脚手架项目改为纯静态，删除 `app/routes/404.tsx` 中的 `renderIntent: { mode: 'dynamic' }`，让构建预渲染 `404.html`。删除示例请求时端点 `app/routes/api/ping.ts` 及其对应的 ping 测试。按纯静态应用部署前，还要确认应用没有其他请求时路由或 action。

```bash
set -e
npm run build
test ! -e dist/server
npx oe publish --check
test -f dist-public/404.html
npx wrangler pages deploy dist-public --project-name=your-project
```

如果 Pages 项目使用 Git 集成，将输出目录设为 `dist-public`，并在构建命令中加入 `npx oe publish --check`。[Cloudflare Pages 会用顶层的 `404.html` 处理未匹配的路径](https://developers.cloudflare.com/pages/configuration/serving-pages/#not-found-behavior)。部署后，在 Pages 站点验证首页返回 200，未知路径返回 404。

## 请求时服务器

当任何路由声明 `renderIntent: { mode: 'dynamic' }` 或任何页面导出 action 时，构建还会产出 `dist/server/`：

- `index.js`——接入同一个 SSR bundle 的请求时入口。默认导出接收 Nitro 请求事件，返回 `Response`。
- `server-manifest.json`——请求时（`'dynamic'`）路由，含路径、参数名与 action 标记。
- `package.json`——把该目录标记为 ESM。

混合页（静态 GET + action）的 GET 仍由预渲染产物伺服，其 POST 按方法分派到服务器。纯静态构建不会生成 `dist/server/`。为托管平台打包前，可以用 `npm start` 在本地运行请求时入口。

### 公开文件校验

`oe start` 和静态预览在启动时验证 `dist-public/` 的完整清单。静态 GET 和 HEAD 仅使用清单列出的文件，并检查实际路径与内容。`dist/` 是构建工作目录，`dist/server/` 是请求时服务端产物。公开路径的首段 `server` 保留给框架。

## Nitro 预设

Nitro 接收同一次构建生成的请求时入口和校验过的公开目录。兜底路由接收 Nitro 原生的 fetch 请求事件。静态 GET 由预渲染文件响应，动态路由、action 和请求时 404 交给生成的处理器。

```ts
// server/routes/[...path].ts
export { default } from '../../dist/server/index.js';
```

```ts
// nitro.config.ts
import { fileURLToPath } from 'node:url';

const publicDir = fileURLToPath(new URL('./dist-public', import.meta.url));

export default defineNitroConfig({
  serverDir: 'server',
  publicAssets: [{ dir: publicDir }],
  modules: [
    ({ options }) => {
      options.publicAssets = options.publicAssets.filter(({ dir }) => dir === publicDir);
    },
  ],
  compatibilityDate: '2026-06-12',
  cloudflare: { nodeCompat: true },
});
```

Nitro 模块将静态资源发现范围限定在 `dist-public/`。两个预设使用同一份配置。

```bash
npm run build
npx oe publish --check
```

### Node 服务器

```bash
npx nitro@3.0.260610-beta build --preset=node-server
HOST=127.0.0.1 PORT=4173 node .output/server/index.mjs
```

用本地来源运行下方的冒烟脚本。部署 Node 产物时，按托管平台要求设置 `HOST` 和 `PORT`。

### 请求时路由：经 Nitro 上 Workers

```bash
npx nitro@3.0.260610-beta build --preset=cloudflare_module
```

Nitro 将 Worker 模块写入 `.output/server/index.mjs`，将校验过的静态文件写入 `.output/public/`，并生成 `.output/server/wrangler.json`。检查配置是否开启 Node.js 兼容，并确认 `ASSETS` 指向打包后的公开目录。Router 生成的入口从 Nitro 请求中读取 Workers 绑定，使 loader 和 action 可以通过 `ctx.env` 访问它们。

对 `/guestbook` 这样的混合页面，Cloudflare 静态资源路由可能在 Worker 收到 POST 之前返回 405。在 Nitro 配置中将 `cloudflare.wrangler.assets.run_worker_first` 设为混合页面路径列表，例如 `['/guestbook']`。如果 Workers 绑定存在，兜底路由将这些路径的 GET 和 HEAD 转发给 `event.req.runtime.cloudflare.env.ASSETS.fetch(event.req)`，其余方法交给 Router 生成的处理器。如果 Router 声明 `/guestbook` 这类不带尾斜杠的路径，将 `cloudflare.wrangler.assets.html_handling` 设为 `'drop-trailing-slash'`，使页面表单提交到 action 对应的路径。[Cloudflare 静态资源路由](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/)

仓库 fixture 用 Wrangler 的本地 workerd 运行时对生成的 Worker 执行 HTTP 验证。取得目标 Cloudflare 账号的部署权限后，从项目根目录运行 `npx nitro@3.0.260610-beta deploy --prebuilt` 部署校验过的产物。在部署后的来源再次运行冒烟脚本，并确认请求时 loader 能读取预期的绑定且响应不包含绑定值。[Router/Nitro fixture](https://github.com/open-element/openelement/tree/main/tests/fixtures/router-nitro)

## Dev 服务器

`npm run dev` 启动 Vite dev server；router 的 dev 管线通过 `@hono/vite-dev-server` 伺服生成的 Hono 入口，因此 routes、loader 与 action 在 dev 下运行在与构建相同的生成入口上。

## 验证

构建并启动应用后，检查 HTTP 响应。

1. `ls dist/server/` 直接告诉你构建是否产出了请求时服务器。纯静态项目应当没有 `dist/server` 目录。
2. `npm start` 会打印它加载了哪种模式——`request-time server entry loaded (dynamic routes enabled)`，或 `no dist/server — static-only preview`。这一行是产物自己的答案；若它与你的路由不符，要检查的是构建。
3. `curl -i http://localhost:4173/` 对静态路由必须返回 200 与预渲染 HTML。
4. `curl -i http://localhost:4173/server/index.js` 必须返回 `404`（而不是生成的入口）：私有产物不属于公开输出。
5. `curl -i -X POST -H 'x-openelement-action: true' --data 'message=' http://localhost:4173/你的表单路由` 必须到达 action。该头选择的是 fetch 通道，它的应答是数据而不是导航——以下为本次构建的实测：

   | 通道 | 提交无效 | 提交有效 |
   | --- | --- | --- |
   | native 表单（不带该头） | `422`，重新渲染的表单 | `303` 加 `Location` 头 |
   | fetch（`x-openelement-action: true`） | `422`，`application/json`，响应体 `{"type":"failure","status":422,"data":{…}}` | `200`（不是 303），`application/json`，响应体 `{"type":"redirect","status":303,"location":"…"}` |

   PRG 状态出现在 fetch 通道的响应体里，因为那条应答是数据、不是一次可跟随的重定向。`application/problem+json` 是这个通道的协议错误形状（被拒的跨站提交、未知 action、无法解析的请求体），不是校验失败用的形状。
6. 用 loader 会读取的两个不同输入请求同一条动态路由。确认每个响应包含各自的值，且响应头包含 `Cache-Control: private, no-cache`。

### 冒烟脚本

将 `BASE` 设为本地或部署后的来源，将 `FORM_PATH` 设为拒绝空消息并返回 422 的路由。所有状态检查通过后才会输出结果。

```bash
set -e
BASE=http://localhost:4173
FORM_PATH=/your-form-route
test "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/")" = 200
test "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/server/index.js")" = 404
test "$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  -H "Origin: $BASE" -H 'x-openelement-action: true' --data 'message=' \
  "$BASE$FORM_PATH")" = 422
echo 'artifact answers: static 200, private 404, action 422'
```

## 产物兼容性

每次部署都使用同一次 `npm run build` 的完整输出，同时更新静态 HTML、浏览器资源和请求时服务端入口。静态托管器只应接收公开输出，服务端模块和清单留在应用部署环境。

## 另见

- [构建与配置](/zh/guide/configuration)——决定产物形态的构建、路由与中间件选项。
- [Form action](/zh/guide/recipe-form-actions)——表单校验、原生重定向与增强提交。
- [安全](/zh/guide/security)——生成的 handler 在请求时强制执行的内容。
- [测试](/zh/guide/testing)——针对构建产物值得运行的检查。
