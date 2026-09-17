---
title: '性能与基准测试'
lede: '零噪音。只列我们实际测量的数据。'
order: 100
navLabel: '性能'
section: 'Reference'
---

## 产物体积

以下数字于 2026-09-17 量自 docs 站点自身的构建（`www/dist`，在本仓库 commit `c953ac80` 上由 `deno task site:build` 生成）。每一行旁边都给出复现命令；页面数与 URL 数随路由集合变化，内容变更后请重跑。

| 指标                 | 数值                                             |
| -------------------- | ------------------------------------------------ |
| 预渲染文档           | 64 个 HTML 文件                                  |
| `sitemap.xml` URL 数 | 62                                               |
| 静态产物总量         | 7.2 MB                                           |
| island manifest      | 64 份——每页一份                                  |
| 搜索索引             | 每个语言 31 页（en、zh），62 个 fragment，1.1 MB |

```bash
deno task site:build                        # 先重新生成以下全部内容
find www/dist -name '*.html' | wc -l        # 64
grep -c '<loc>' www/dist/sitemap.xml        # 62
du -sh www/dist                             # 7.2M
ls www/dist/island-manifests | wc -l        # 64
cat www/dist/pagefind/pagefind-entry.json   # 每种语言 page_count 31
```

## Island bundle

docs 站点就是一个普通的 openElement 应用（同样有 island），所以它的客户端产物是有代表性的样本。以下是全部产出的 chunk 的原始体积与 gzip 体积：

| Chunk                          | 原始字节 | gzip -9 |
| ------------------------------ | -------- | ------- |
| `client.js`（共享入口）        | 7,103    | 1,849   |
| `island-open-layout`           | 88,337   | 16,183  |
| `island-open-cinematic-scroll` | 78,176   | 23,894  |
| `open-button`                  | 16,043   | —       |
| `island-open-dragon-live-gaze` | 14,161   | —       |
| `island-open-page-rail`        | 8,250    | 2,120   |
| `open-code-block`              | 8,254    | 2,688   |
| `island-open-hero-polish`      | 4,436    | —       |
| `open-badge`                   | 4,010    | —       |

```bash
ls -l www/dist/client/islands/*.js
gzip -9 -c www/dist/client/islands/client.js | wc -c
```

页面实际下载什么，由它自己的 island manifest 决定，而不是由总量决定：

| 路由                     | 客户端载荷（原始） | 不同 chunk 数 |
| ------------------------ | ------------------ | ------------- |
| `/guide/mdx`             | 103,690 B          | 3             |
| `/guide/getting-started` | 111,944 B          | 4             |
| `/`                      | 200,467 B          | 6             |

64 份页面 manifest 合计声明了 10 个 island 标签、284 条记录：外壳 island（`open-layout`、`open-search`、`open-theme-toggle`）出现在每一页，`open-page-rail` 出现在 54 页，`open-code-block` 出现在 22 页，其余标签只在少数页面上。

```bash
cat www/dist/island-manifests/page-<hash>.json   # 单页的 island 集合：标签、chunk、策略、层级
python3 -c "import json,glob,collections; print(collections.Counter(t for f in glob.glob('www/dist/island-manifests/*.json') for t in (i['tagName'] for i in json.load(open(f))['islands'])))"
```

没有 island、也没有增强表单的项目完全不产出客户端入口：DSD 组件不需要框架的虚拟 DOM 运行时，因此纯静态页面保持无脚本。

## 渲染

| 指标        | 行为                                                                                |
| ----------- | ----------------------------------------------------------------------------------- |
| DSD SSR     | 组件序列化为 Declarative Shadow DOM；浏览器原生解析 shadow root，没有脚本解析成本。 |
| Island 水合 | 按组件粒度，由其声明的策略门控（`load` / `idle` / `visible` / `only`）。            |
| 导航        | 浏览器原生导航；View Transitions 与 Speculation Rules 均为可选。                    |
| 强制运行时  | 没有。客户端 JavaScript 只存在于模块声明了 island、或表单选择增强的地方。           |

## 另见

- [当前架构](/zh/architecture/architecture)——这些数字所对应的分层。
- [Island 深入解析](/zh/architecture/islands-deep)——四层组件模型及其策略。
- [设计体系](/zh/architecture/design-system)——站点自身样式与 token 的组合方式。
