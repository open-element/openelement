---
title: 'Package 兼容性'
lede: 'openElement 把第三方 Custom Elements 视为基于标准的依赖。当前构建通过显式的 package island 配置与可用的 Custom Elements Manifest metadata 完成 SSR 准入。'
order: 90
section: 'Reference'
---

## 当前契约

`@openelement/element` 负责编写体验；`router` 包把应用行为与构建行为收敛在一个边界之内。

## 显式准入

已知包可配置为 package island，并利用可用的 CEM metadata，无需引入已退役的包接口。

## 当前诊断

当前版本线交付通用 DSD/light/client-only 分类、hydration 不匹配诊断与已跟踪的第三方 WC SSR 语料库——最初随 0.43 线交付，并在编译型版本线上由 CI 持续验证。准入仍依赖显式 package-island 配置与已观测 metadata，并不意味着对所有第三方组件作笼统认证。

## 另见

- [WC 标准契约](/zh/architecture/standards-registry)——被准入元素需要满足的标准表面。
- [当前架构](/zh/architecture)——该契约所属的包依赖图。
- [openElement 对比主流框架](/zh/architecture/comparison)——准入集合的横向对比。
