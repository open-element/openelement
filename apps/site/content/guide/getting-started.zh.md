---
title: '快速开始'
lede: 'OpenElement 是以 Web Components 为原生契约、static-first 的应用框架。从标准 Custom Elements、pages、routes 与按需升级开始，产出可部署的 Vite/Nitro 输出。'
order: 1
---

> `1.0.0-alpha.1` 是 Element 与 Router 的新基线。不提供从 0.x 的受支持迁移路径——新项目请从 `@openelement/create` 开始。

## 安装

三条命令跑起应用：

```bash
deno run -A --minimum-dependency-age 0 npm:@openelement/create@alpha my-app
cd my-app
deno task dev
```

`@alpha` dist-tag 跟踪 1.0 预发布线。`--minimum-dependency-age 0` 让新兼容补丁发布后的首日仍可正常创建项目；否则 Deno 默认的 `minimumDependencyAge` 会拒绝发布未满约 24 小时的包。

> 需要 Deno 2.8+——生成的 starter 会写入 `minimumDependencyAge` 配置键，更旧的 Deno 版本不认识该键。

## 探索

阅读 [文档](/zh/docs)、[API 参考](/zh/apilist) 与 [路线图](/zh/roadmap)，了解当前产品全貌。

## 构建

发布前运行 build、package、docs truth 与 visual smoke 门禁。
