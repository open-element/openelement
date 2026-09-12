---
title: '部署'
lede: '部署围绕生成的静态输出与 adapter 各自的运行时边界展开。'
order: 100
---

## Build、start、preview

脚手架生成的项目把 Deno task 接到 adapter CLI 子路径：`deno task build` 运行 `@openelement/adapter-vite/cli/build`；`deno task start` 运行 `cli/start`——一条命令伺服构建产物：静态文件来自 `dist/`，当 `dist/server/index.js` 存在时，dynamic 路由与变更请求分派给它（端口取 `OPEN_ELEMENT_PORT` 或 `PORT`，默认 4173；主机取 `OPEN_ELEMENT_HOST`）。同一条命令加 `--mode=preview` 即只伺服静态产物，发现 `dist/server` 时会拒绝运行并指向 start 模式。

## 静态输出

docs 站点通过 SSG 管线生成。

## 请求时服务器

当任何路由声明 `renderIntent: { mode: 'dynamic' }` 时,构建还会产出 `dist/server/index.js`——挂在同一个 SSR bundle 上、可由 Nitro 挂载的处理器——以及列出请求时路由的 `server-manifest.json`,以及独立生产入口 `dist/server/serve.mjs`(`node dist/server/serve.mjs`;支持 Node 24+、Deno、Bun),无需 CLI 即可伺服静态树并分派请求时路由。纯静态构建三者都不产出；该输出契约已按 ADR-0122 冻结。

## Nitro 预设

Nitro 是第一方生产部署 adapter。用 `@openelement/adapter-vite/nitro-mount` 的 `createOpenElementNitroHandler` 把构建出的 handler 桥接进 Nitro v3 event——在 fetch 原生接缝上近乎透传：event 的标准 `Request`（`event.req`）进，handler 的 `Response` 出；两个受支持的预设——`node-server` 与 `cloudflare_module`（Workers）——都由 `deno task nitro:proof:node` / `nitro:proof:workers` 门禁对真实 Nitro 产物背书。

## Dev 服务器

`deno task dev` 启动 Vite dev server；adapter 通过 `@hono/vite-dev-server` 伺服生成的 Hono 入口，routes、loader 与 action 在 dev 下运行在与构建相同的生成入口上。

## 验证

发布或推送 release 变更前应检查构建产物。
