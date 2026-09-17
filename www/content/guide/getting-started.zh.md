---
title: '快速开始'
lede: 'OpenElement 是以 Web Components 为原生契约、static-first 的应用框架。从标准 Custom Elements、pages、routes 与按需升级开始，产出可部署的 Vite/Nitro 输出。'
order: 1
---

> {{SOURCE_LINE_NOTE}} registry 真值以 `docs/release/release-state.json` 为准。不提供从 0.x 的受支持迁移路径——新项目请从 `@openelement/create` 开始。

## 安装

三条命令跑起应用：

```bash
deno run --allow-read --allow-write --allow-env --allow-net --deny-ffi --no-prompt --minimum-dependency-age 0 npm:@openelement/create@alpha my-app
cd my-app
deno task dev
```

`@openelement/*` 各包已发布的 npm 版本与 dist-tag——包括安装命令实际解析到的版本——登记在 `docs/release/release-state.json`（仓库的 registry 核验真值）中。`--minimum-dependency-age 0` 让新兼容补丁发布后的首日仍可正常创建项目；否则 Deno 默认的 `minimumDependencyAge` 会拒绝发布未满约 24 小时的包。

> 需要 Deno 2.9+：Deno 2.9 是经过验证的下限（仓库锁定并在 CI 中运行的工具链；未声明也未测试更早的版本）。生成的 starter 会写入 `minimumDependencyAge` 配置键，该键自 Deno 2.5.5 起存在。

## 探索

阅读 [文档](/zh/docs)、[API 参考](/zh/apilist) 与 [路线图](/zh/roadmap)，了解当前产品全貌。

## 构建

发布前运行 build、package、docs truth 与 visual smoke 门禁。
