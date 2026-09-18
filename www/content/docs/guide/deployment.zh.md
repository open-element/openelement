---
title: '部署'
lede: '部署围绕生成的静态输出与 adapter 各自的运行时边界展开。'
order: 100
---

## Build、start、preview

脚手架生成的项目把 Deno task 接到 router CLI 子路径：

```bash
deno task build     # SSG + 请求时服务器，产出到 dist/
deno task start     # 伺服 dist/；dynamic 路由与变更请求分派给 dist/server
deno task preview   # 纯静态预览；存在 dist/server 时拒绝运行
deno task dev       # Vite 开发服务器
```

`deno task start` 静态伺服 `dist/`，并在 `dist/server/index.js` 存在时把 dynamic 路由与变更请求分派给它。端口取 `OPEN_ELEMENT_PORT`（其次 `PORT`，默认 4173），主机取 `OPEN_ELEMENT_HOST`。同一条 CLI 加 `--mode=preview` 即只伺服静态产物，发现 `dist/server` 时会拒绝运行并指向 start 模式——只对没有请求时路由的项目使用它。

## 静态输出

`deno task build` 把预渲染站点写入 `dist/`：

- `dist/<route>/index.html`，每个预渲染路由一份，另有 not-found 路由的 `dist/404.html`。
- `public/` 下的内容原样拷贝——favicon、`robots.txt`、图片。
- 应用存在 island 或增强表单时产出 `dist/client/`：共享入口 `client.js`，以及 `dist/client/islands/` 下每个 island 标签一个 chunk。
- `dist/island-manifests/page-<hash>.json`，每页一份，列出该页每个 island 的标签、chunk URL、策略与层级——构建产物自己回答「这个页面加载哪些 JavaScript」。

没有 island、没有增强表单、没有 action、也没有 `'dynamic'` 路由的项目，产物就是这样一个目录：上传到任意静态托管即可，完全不涉及服务端代码。不需要浏览器行为的组件在这些文件里就是普通 HTML，因此预渲染产物在无 JavaScript 时依然样式完整、可读。

## 请求时服务器

当任何路由声明 `renderIntent: { mode: 'dynamic' }` 或任何页面导出 action 时，构建还会产出 `dist/server/`：

- `index.js`——挂在同一个 SSR bundle 上的可移植 `fetch(Request) -> Response` 处理器。
- `server-manifest.json`——请求时（`'dynamic'`）路由，含路径、参数名与 action 标记。
- `package.json`——把该目录标记为 ESM。

混合页（静态 GET + action）的 GET 仍由预渲染产物伺服，其 POST 按方法分派到服务器。纯静态构建三者都不产出，该输出契约已冻结。本地预览由 `deno task start` 提供，它在 `Deno.serve` 上运行同一个处理器——这是部署前在浏览器之外演练请求时路径的唯一方式。

## Nitro 预设

Nitro 是第一方生产部署 adapter，挂载在 fetch 原生接缝上近乎透传：event 的标准 `Request` 进，handler 的 `Response` 出。添加一条把静态层不负责的请求转发下去的路由：

```ts
// server/routes/[...path].ts
import { createOpenElementNitroHandler } from '@openelement/router/nitro-mount';
import openElementServer from '../../dist/server/index.js';

// 覆盖 Nitro 静态层（nitro-public/）的 catch-all：预渲染文件优先，
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
  publicAssets: [{ dir: 'nitro-public' }],
});
```

部署顺序：

1. `deno task build`
2. 把 `dist/` 下除 `server/` 之外的一切拷进 `nitro-public/`。`dist/server` 是服务端代码，不是公开资源，绝不能作为公开资源发布。
3. 构建宿主：`deno run --allow-read --allow-write --allow-run --allow-env --allow-net npm:nitro@3.0.260610-beta build`——本仓库 Nitro 证明锁定的版本（`NITRO_VERSION`）；`preset` 选择 `node-server` 或 `cloudflare_module`。
4. 运行产物（`node-server` 为 `.output/server/index.mjs`），并按平台要求设置 `PORT` 与 `HOST`。

两个预设都对真实 Nitro 产物做过验证：预渲染文件、dynamic 路由、action、重定向、404 与一条 Nitro 缓存路由规则。

## Dev 服务器

`deno task dev` 启动 Vite dev server；router 的 dev 管线通过 `@hono/vite-dev-server` 伺服生成的 Hono 入口，因此 routes、loader 与 action 在 dev 下运行在与构建相同的生成入口上。

## 验证

验证产物，而不是日志。`deno task build` 之后：

1. `ls dist/server/` 直接告诉你构建是否产出了请求时服务器。纯静态项目应当没有 `dist/server` 目录。
2. `deno task start` 会打印它加载了哪种模式——`request-time server entry loaded (dynamic routes enabled)`，或 `no dist/server — static-only preview`。这一行是产物自己的答案；若它与你的路由不符，要检查的是构建。
3. `curl -i http://localhost:4173/` 对静态路由必须返回 200 与预渲染 HTML。
4. `curl -i -X POST -H 'x-openelement-action: true' --data 'message=' http://localhost:4173/你的表单路由` 必须到达 action：校验失败以 `422` 与 `application/problem+json` 应答，成功以 `303` 与 `Location` 头应答。
5. 连续请求同一个 `'dynamic'` 路由两次，确认响应体与 `dist/` 中磁盘上的文件不同——那说明请求时路径在工作。

### 冒烟脚本

第 3–4 步合为一块可复制的脚本（把表单路由换成你的）。第一个错误状态即失败，可直接做部署门禁：

```bash
set -e
BASE=http://localhost:4173
test "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/")" = 200
test "$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  -H 'x-openelement-action: true' --data 'message=' \
  "$BASE/你的表单路由")" = 422
echo 'artifact answers: static 200, action 422'
```

## 另见

- [构建与配置](/zh/guide/configuration)——决定产物形态的构建、路由与中间件选项。
- [安全](/zh/guide/security)——生成的 handler 在请求时强制执行的内容。
- [测试](/zh/guide/testing)——针对构建产物值得运行的检查。
