---
title: '部署到 Cloudflare'
lede: '一个构建决策决定 Cloudflare 目标：纯静态的 `dist/` 以文件形式直传 Pages，请求时路由经 Nitro 挂载部署到 Workers。'
order: 101
---

`pnpm build` 会替你决定目标。当它不产出 `dist/server/` 时，产物就是一棵普通文件树——上传到 Cloudflare Pages 即可，完全不涉及服务端代码。当任何路由保持请求时行为（`'dynamic'` 路由或 action）时，构建还会产出 `dist/server/index.js`：与 `pnpm start` 本地运行的同一个 `fetch(Request) -> Response` 处理器。这就是全部服务器契约——一个处理器，可部署到任何 fetch 原生宿主——因此从 Pages 换到 Workers 是宿主决策，不是重写。

## 纯静态：Cloudflare Pages

脚手架的 404 路由出厂就在请求时路径上：

```ts
// app/routes/404.tsx — starter 默认
export default definePage(NotFoundPage, {
  renderIntent: { mode: "dynamic" },
  head: { title: "404 — openElement" },
});
```

这一行正是 starter 构建产出 `dist/server/` 的原因：请求时服务器对未匹配路径以真实 404 状态渲染该页，因此不会写出静态 404 文件。删掉 `renderIntent` 一行，该路由即变为可预渲染——没有其它请求时路由的构建随之产出纯静态的 `dist/`：

```bash
pnpm build
ls dist/
# 404.html  assets/  index.html
```

构建自身会确认该模式（`Pure-static build: removed build-time SSR bundle (dist/server)`），且不存在会被带进上传的 `dist/server/` 目录。把这个目录作为 Pages 项目上传：

```bash
npx wrangler pages deploy dist
```

首次部署会创建项目（用 `--project-name` 命名，或让 CLI 交互提示）；后续部署上传新文件，站点随之更新。Pages 的静态资源约定会对任何未匹配文件的路径伺服顶层 `404.html`——带 404 状态——因此带样式的预渲染 404 就是站点的 not-found 页，零服务端代码。

验证产物，而不是日志（把 pages.dev 主机换成你的）：

```bash
BASE=https://your-project.pages.dev
test "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/")" = 200
test "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/no-such-page")" = 404
echo 'Pages artifact answers: home 200, miss 404'
```

## 请求时路由：经 Nitro 上 Workers

当 `pnpm build` 产出 `dist/server/` 时，把构建出的处理器部署到 Cloudflare Workers，宿主是两文件的 Nitro 工程。挂载（`@openelement/router/nitro-mount`）在 fetch 原生接缝上近乎透传：event 的标准 `Request` 进，handler 的 `Response` 出。

```ts
// server/routes/[...path].ts
import { createOpenElementNitroHandler } from '@openelement/router/nitro-mount';
import openElementServer from '../../dist/server/index.js';

// 覆盖 Nitro 静态层（nitro-public/）的 catch-all：预渲染文件优先，
// 其余——dynamic 路由、action、404——落到构建出的 handler。
export default createOpenElementNitroHandler({
  handler: (request, context) =>
    openElementServer({
      req: request,
      env: (context?.env ?? {}) as Record<string, string>,
    }),
});
```

```ts
// nitro.config.ts
export default defineNitroConfig({
  serverDir: 'server',
  publicAssets: [{ dir: 'nitro-public' }],
  compatibilityDate: '2026-06-12',
  cloudflare: { nodeCompat: true },
});
```

`env` 转发正是把 Workers 绑定送进 loader 与 action 的通道。在 Workers 上，h3 v2 把绑定放在请求自身（`req.runtime.cloudflare.env`）——h3 event 本身没有 `env` 字段——而挂载会先解析该运行时通道，其次显式的 `event.env`，再次挂载选项。按上面转发 `context.env`，loader 或 action 里的 `ctx.env` 读到的就是你的 Workers 绑定。

部署顺序：

1. `pnpm build`
2. 把预渲染树发布给 Nitro 的静态层。`dist/server/` 是服务端代码，不是公开资源，绝不能作为公开资源发布：

   ```bash
   mkdir -p nitro-public
   cp -R dist/. nitro-public/
   rm -rf nitro-public/server
   ```

3. 用本仓库在 tools/release/nitro-compatibility.ts 中锁定的兼容 Nitro 版本构建 Workers 产物：

   ```bash
   npx nitro@3.0.260610-beta build --preset=cloudflare_module
   ```

4. 部署 `.output/`。Nitro 产出 `server/index.mjs`——导出 `default fetch(request, env, context)` 的 Workers 模块——外加 `public/` 和生成的 `server/wrangler.json`（compatibility date、`nodejs_compat`，以及指向 `public/` 的 `ASSETS` 绑定）。在项目根用 `npx nitro deploy --prebuilt` 部署，或在 `.output/` 里用生成 `nitro.json` 记录的 wrangler 命令（`npx wrangler --cwd ./ deploy`）。

部署之前，先在你 curl 得到的宿主上证明接线无误：同样两个文件不加修改地以 `--preset=node-server` 构建，`.output/server/index.mjs` 入口设好 `PORT` 与 `HOST` 即可在 Node 下启动——curl 静态首页（由静态层伺服）、一条 `'dynamic'` 路由（经挂载由 `dist/server` 渲染）、一条未匹配路径（带真实 404 状态的带样式 404）。静态文件优先于 catch-all 是预期行为，这也正是 `dist/server` 必须留在 `nitro-public/` 之外的原因。

绑定值得一次显式检查：给 Worker 一个测试绑定，并在某个 loader 里经 `ctx.env` 读取。它出现了，整条通道就是通的——Workers env → `req.runtime.cloudflare.env` → 挂载 → `dist/server` → `ctx.env`。

## 另见

- [部署](/zh/guide/deployment)——构建产物契约、本地 start/preview 与 Node 宿主。
- [路由与数据](/zh/guide/routing-and-data)——`renderIntent`、loader 与 action。
- [安全](/zh/guide/security)——生成的 handler 在请求时强制执行的内容。
