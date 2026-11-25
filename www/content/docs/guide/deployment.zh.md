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

## 请求时服务器

当任何路由声明 `renderIntent: { mode: 'dynamic' }` 或任何页面导出 action 时，构建还会产出 `dist/server/`：

- `index.js`——挂在同一个 SSR bundle 上的可移植 `fetch(Request) -> Response` 处理器。
- `server-manifest.json`——请求时（`'dynamic'`）路由，含路径、参数名与 action 标记。
- `package.json`——把该目录标记为 ESM。

混合页（静态 GET + action）的 GET 仍由预渲染产物伺服，其 POST 按方法分派到服务器。纯静态构建三者都不产出，该输出契约已冻结。本地预览由 `npm start`（router 的 start CLI）提供，它在 Node 的 `node:http` 上运行同一个处理器——这是部署前在浏览器之外演练请求时路径的唯一方式。

### 公开文件校验

`oe start` 和静态预览在启动时验证 `dist-public/` 的完整清单。静态 GET 和 HEAD 仅使用清单列出的文件，并检查实际路径与内容。`dist/` 是构建工作目录，`dist/server/` 是请求时服务端产物。公开路径的首段 `server` 保留给框架。

## Nitro 预设

Nitro 是第一方生产部署 adapter，挂载在 fetch 原生接缝上近乎透传：event 的标准 `Request` 进，handler 的 `Response` 出。添加一条把静态层不负责的请求转发下去的路由：

```ts
// server/routes/[...path].ts
import { createOpenElementNitroHandler } from '@openelement/router/nitro-mount';
import openElementServer from '../../dist/server/index.js';

// 覆盖 Nitro 静态层（dist-public/）的 catch-all：预渲染文件优先，
// 其余——dynamic 路由、action、404——落到构建出的 handler。
export default createOpenElementNitroHandler({
  handler: (request, context) =>
    openElementServer({ req: request, env: (context?.env ?? {}) as Record<string, string> }),
});
```

```ts
// nitro.config.ts
export default defineNitroConfig({
  serverDir: 'server',
  preset: 'node-server', // Workers 用 'cloudflare_module'
  publicAssets: [{ dir: 'dist-public' }],
});
```

部署顺序：

1. `npm run build`
2. 运行 `npx oe publish --check`，将已验证的 `dist-public/` 交给 Nitro 的静态层。
3. 构建宿主：`npx nitro@3.0.260610-beta build`——本仓库 Nitro 证明锁定的版本（`NITRO_VERSION`）；`preset` 选择 `node-server` 或 `cloudflare_module`。
4. 运行产物（`node-server` 为 `.output/server/index.mjs`），并按平台要求设置 `PORT` 与 `HOST`。

两个预设都对真实 Nitro 产物做过验证：预渲染文件、dynamic 路由、action、重定向、404 与一条 Nitro 缓存路由规则。

## Dev 服务器

`npm run dev` 启动 Vite dev server；router 的 dev 管线通过 `@hono/vite-dev-server` 伺服生成的 Hono 入口，因此 routes、loader 与 action 在 dev 下运行在与构建相同的生成入口上。

## 验证

验证产物，而不是日志。`npm run build` 之后：

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
6. 连续请求同一个 `'dynamic'` 路由两次，确认响应体与 `dist/` 中磁盘上的文件不同——那说明请求时路径在工作。

### 冒烟脚本

第 3–5 步合为一块可复制的脚本（把表单路由换成你的）。第一个错误状态即失败，可直接做部署门禁：

```bash
set -e
BASE=http://localhost:4173
test "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/")" = 200
test "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/server/index.js")" = 404
test "$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  -H 'x-openelement-action: true' --data 'message=' \
  "$BASE/你的表单路由")" = 422
echo 'artifact answers: static 200, private 404, action 422'
```

## 产物兼容性

每次部署都使用同一次 `npm run build` 的完整输出，同时更新静态 HTML、浏览器资源和请求时服务端入口。静态托管器只应接收公开输出，服务端模块和清单留在应用部署环境。

## 另见

- [构建与配置](/zh/guide/configuration)——决定产物形态的构建、路由与中间件选项。
- [安全](/zh/guide/security)——生成的 handler 在请求时强制执行的内容。
- [测试](/zh/guide/testing)——针对构建产物值得运行的检查。
