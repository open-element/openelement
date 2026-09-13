---
title: '迁移到 0.41.0'
lede: '自 0.40.x 以来的全部 breaking change，按发布版本分组。'
order: 75
---

> 历史档案：本页归档 0.40.x → 0.41/0.42 的迁移记录，面向已退役的运行时创作线。当前版本线（{{OPENELEMENT_VERSION}}）通过 `@openelement/create` 全新接入——不提供 0.43 → 0.44 的原位升级路径。新项目请从当前 starter 与[上手指南](/zh/guide/getting-started)开始。

## 0.41.x → 0.42

稳定的 0.42 版本线新增 request-time 面——loader、action、渐进增强表单、redirect 与 Nitro 服务端输出。静态面升级没有破坏 0.41 冻结面；ADR-0122 记录了已接受的 0.42.0 契约。

## 从 0.40.x 升级

消费包图收敛为五包；`core`/`signal`/`router`/`protocol`/`content`/`ssg` 已退役。用 `defineElement`/`definePage`/`defineApp` 创作、`buildApp()` 构建。`defineLayout` 已删除；分发改为 npm-first。

## Alpha.17–19

构建助手移至 `element/build-utils`；router 类型离开 app 根；`renderIntent.streaming` 删除；动态路由 500 默认 fail build；星型缝类型（`SafeHtml`/`UnsafeHtml`/`StyleSheetRule`）离开 element 根；ui 控件改为方形（`radius-1`）。

## 0.41.0 冻结

adapter-vite 内部子路径（`app-vite`、`build-context`、`head-injection`、`i18n-plugin`、`plugin`、`generated-data-resolver`、`plugin-mdx`、`route-manifest`、`cli/build-client`、`cli/build-ssg`）已修剪。请改用 root、`nitro-mount`、`cli/build` 与 `sitemap`。

## 升级后验证

冻结重装依赖、重新构建，并 grep 已删除导入：`renderIntent.streaming`、`open-element-render`、`open-element-hydration`、`app-vite`、`SafeHtml`、`*TagName`。ui 几何变更后请重录视觉基线。

完整的逐条迁移指南（含 before/after 导入对照）见仓库 [docs/release/v0.41.0-migration.md](https://github.com/open-element/openelement/blob/main/docs/release/v0.41.0-migration.md)。
