---
title: '快速开始'
lede: 'OpenElement 是以 Web Components 为原生契约、static-first 的应用框架。从标准 Custom Elements、pages、routes 与按需升级开始，产出可部署的 Vite/Nitro 输出。'
order: 1
---

> {{SOURCE_LINE_NOTE}} registry 真值以 [`docs/release/release-state.json`](https://github.com/open-element/openelement/blob/main/docs/release/release-state.json) 为准，不提供从 0.x 的受支持迁移路径。

## 安装

三条命令跑起应用：

```bash
deno run --allow-read --allow-write --allow-env --allow-net --deny-ffi --no-prompt --minimum-dependency-age 0 npm:@openelement/create@alpha my-app
cd my-app
deno task dev
```

安装命令解析到的版本登记在 [`docs/release/release-state.json`](https://github.com/open-element/openelement/blob/main/docs/release/release-state.json)（仓库的 registry 核验真值）中；`--minimum-dependency-age 0` 让新兼容补丁发布后的首日仍可正常创建项目。

> 需要 Deno 2.9+：这是仓库锁定并在 CI 中运行、经过验证的下限。

## 探索

阅读 [文档](/zh/docs)、[API 参考](/zh/apilist) 与 [路线图](/zh/roadmap)，了解当前产品全貌。

## 构建

发布前运行 build、package、docs truth 与 visual smoke 门禁。

## 另见

- [核心概念](/zh/guide/core-concepts)——starter 文件背后的组件模型。
- [路由与数据](/zh/guide/routing-and-data)——页面、loader 与 action。
- [部署](/zh/guide/deployment)——`deno task build` 产出什么，以及如何验证。
