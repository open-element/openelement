---
title: '快速开始'
lede: 'OpenElement 是以 Web Components 为原生契约、static-first 的应用框架。从标准 Custom Elements、pages、routes 与按需升级开始，产出可部署的 Vite/Nitro 输出。'
order: 1
---

> {{SOURCE_LINE_NOTE}} registry 真值以 [`docs/release/release-state.json`](https://github.com/open-element/openelement/blob/main/docs/release/release-state.json) 为准，不提供从 0.x 的受支持迁移路径。

## 安装

三条命令跑起应用：

```bash
{{INSTALL_COMMAND}}
cd my-app
deno task dev
```

安装命令解析到的版本登记在 [`docs/release/release-state.json`](https://github.com/open-element/openelement/blob/main/docs/release/release-state.json)（仓库的 registry 核验真值）中；`--minimum-dependency-age 0` 让新兼容补丁发布后的首日仍可正常创建项目。

> 需要 Deno 2.9+：这是仓库锁定并在 CI 中运行、经过验证的下限。

## 探索

阅读 [文档](/zh/docs)、[API 参考](/zh/reference) 与 [路线图](/zh/roadmap)，了解当前产品全貌。

## 构建

`deno task build` 把可部署的站点产出到 `dist/`——每条静态路由的预渲染 HTML、`public/` 下按原样复制的内容，以及应用含 island 或请求时路由时一并生成的客户端 chunk 与服务端入口。那个目录就是产物：可以上传到任意静态托管，或让 Node/Workers 部署指向 `dist/server/index.js`。

三个任务覆盖整个循环：

```bash
deno task build     # 预渲染到 dist/（需要时另有 dist/client、dist/server）
deno task start     # 起真实构建产物，包含请求时路由
deno task preview   # 纯静态预览；存在 dist/server 时会拒绝运行
```

校验改动应该用 `deno task start`：它起的是与生产一致的输出，并把动态路由与表单 POST 分派给生成的服务端入口。`deno task preview` 刻意更窄——它拒绝带服务端的构建，而不是悄悄把它藏起来，因此只对没有请求时路由的应用有意义。端口取自 `OPEN_ELEMENT_PORT`（回退到 `PORT`，默认 4173），host 取自 `OPEN_ELEMENT_HOST`。

上线前，`deno task check` 对应用做类型检查，`deno task test` 跑测试；两者都已在 starter 的任务里接好，无需额外配置。完整的输出契约——构建写了哪些文件、每个文件回答什么——见[部署](/zh/guide/deployment)。

## 另见

- [核心概念](/zh/guide/core-concepts)——starter 文件背后的组件模型。
- [路由与数据](/zh/guide/routing-and-data)——页面、loader 与 action。
- [部署](/zh/guide/deployment)——`deno task build` 产出什么，以及如何验证。
