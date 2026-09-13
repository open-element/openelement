---
title: 'ADR 0012: 将 lessjs() 统一入口从 @openelement/core 拆到 @openelement/app'
date: '2026-05-10'
lang: 'zh'
type: 'adr'
tags: ['architecture', 'decision']
draft: false
---

## Status

**ACCEPTED** — v0.9.x 架构简化

## Context

`lessjs()` 是 LessJS 的统一 Vite 插件入口，将 `less()` + `lessContent()` + `lessI18n()` 组合在一个调用中，通过显式传递 `LessBuildContext` 避免了 globalThis 桥接。

当前 `lessjs()` 放在 `@openelement/core` 中（`packages/core/src/index.ts` L349-396），使用动态 `import()` 加载 `@openelement/content` 和 `@openelement/i18n`：

```ts
// 当前：core 里动态 import 上层包
export async function lessjs(options = {}) {
  const ctx = new LessBuildContext({...});
  const plugins = [...less(coreOpts, ctx)];

  if (contentOpts) {
    const contentMod = await import('@openelement/content');  // 动态 import
    plugins.push(...contentMod.lessContent({...contentOpts, ctx}));
  }

  if (i18nOpts) {
    const i18nMod = await import('@openelement/i18n');  // 动态 import
    plugins.push(i18nMod.lessI18n({...i18nOpts, ctx}));
  }

  return plugins;
}
```

### 问题：依赖方向倒挂

`@openelement/core` 是基础层——`content` 和 `i18n` 都依赖 core。但 `lessjs()` 在 core 里 import content 和 i18n，形成概念上的循环依赖：

```
content → core → content   ← 概念倒挂（动态 import 打断了物理循环）
i18n    → core → i18n       ← 同上
```

动态 `import()` 虽然避免了运行时循环依赖错误，但：

- **语义不清**：core 不应该知道 content/i18n 的存在
- **try/catch 降级**：必须用 try/catch 处理"未安装"的情况，而这是一个正常的包管理问题
- **类型丢失**：动态 import 导致类型断言 `as Record<string, unknown>`，丧失编译时类型安全

### 替代方案评估

| 方案                          | 做法                       | 优点                                | 缺点                 |
| ----------------------------- | -------------------------- | ----------------------------------- | -------------------- |
| A. 留在 core，保持动态 import | 现状                       | 零改动                              | 概念倒挂，类型不安全 |
| B. 拆到 @openelement/app           | 新包依赖 core+content+i18n | 依赖方向干净，静态 import，类型安全 | 多一个包             |
| C. 留在 core，注册表模式      | core 定义 pluginRegistry   | core 不需知道子插件                 | 多一层间接，过度设计 |

## Decision

**选方案 B**：将 `lessjs()` 从 `@openelement/core` 拆到新包 `@openelement/app`。

### 新依赖图

```
@openelement/app
  ├── @openelement/core       (静态 import)
  ├── @openelement/content    (静态 import)
  └── @openelement/i18n       (静态 import)
```

依赖方向清晰：app 是"组装层"，core 是"基础层"，content/i18n 是"功能层"。无循环，无倒挂。

### 新发布顺序

```
rpc → ui → adapter-lit → signal → content → i18n → core → app → create
```

`@openelement/app` 排在 core 之后、create 之前。

### 代码变更

#### 1. 新建 `packages/app/`

```
packages/app/
  ├── deno.json
  └── src/
      └── index.ts      ← lessjs() 函数
```

#### 2. `packages/app/src/index.ts`

```ts
import type { Plugin } from 'vite';
import type { FrameworkOptions } from '@openelement/core';
import type { LessContentOptions } from '@openelement/content';
import type { LessI18nOptions } from '@openelement/i18n';
import type { LessBuildContext } from '@openelement/core/build-context';

import { less } from '@openelement/core';
import { LessBuildContext as LessBuildContextClass } from '@openelement/core/build-context';
import { lessContent } from '@openelement/content';
import { lessI18n } from '@openelement/i18n';
import { createLogger } from '@openelement/core/logger';

const log = createLogger('app');

export interface LessjsOptions extends FrameworkOptions {
  content?: LessContentOptions;
  i18n?: LessI18nOptions;
}

export async function lessjs(options: LessjsOptions = {}): Promise<Plugin[]> {
  const { content: contentOpts, i18n: i18nOpts, ...coreOpts } = options;
  const ctx: LessBuildContext = new LessBuildContextClass({
    ...coreOpts,
    routesDir: coreOpts.routesDir || 'app/routes',
    islandsDir: coreOpts.islandsDir || 'app/islands',
    componentsDir: coreOpts.componentsDir || 'app/components',
  });

  const plugins: Plugin[] = [...less(coreOpts, ctx)];

  if (contentOpts) {
    plugins.push(...lessContent({ ...contentOpts, ctx }));
  }

  if (i18nOpts) {
    plugins.push(lessI18n({ ...i18nOpts, ctx }));
  }

  return plugins;
}

export default lessjs;
```

关键变化：

- **静态 import**：不再需要 `await import()` + `try/catch`
- **类型安全**：直接 import `lessContent` / `lessI18n`，无需 `as Record<string, unknown>` 断言
- **安装即用**：如果 `@openelement/content` 未安装，Deno 会在启动时报错，而非运行时静默降级

#### 3. `packages/core/src/index.ts`

- 删除 `lessjs()` 函数（L349-396）
- 删除 `LessBuildContext` 的顶层 export（保留 `build-context` 子路径导出）
- `less()` 函数保留 `externalCtx` 参数不变

#### 4. 用户迁移

```ts
// Before (v0.9.x)
import { lessjs } from '@openelement/core';

// After (v0.10.x)
import { lessjs } from '@openelement/app';
```

`less()` 不受影响——仍在 `@openelement/core`。

### 为什么安装失败是正确的行为

当前 `lessjs()` 用 try/catch 静默降级未安装的子插件。这看似友好，但隐藏了配置错误：

- 用户在 `lessjs()` 中传了 `content: { blog: {...} }` 但忘了安装 `@openelement/content`
- 当前行为：**静默跳过**，不报错，用户困惑"博客功能为什么没生效"
- 新行为：**启动报错** `Cannot find module '@openelement/content'`，问题一目了然

如果用户不想用 content/i18n，**不传对应选项即可**——这是 opt-in 的正确姿势，不需要 try/catch。

## Consequences

### Positive

- **依赖方向正确**：app → core/content/i18n，无倒挂
- **类型安全**：静态 import 替代动态 import + 类型断言
- **core 保持纯粹**：core 只关心构建上下文、DSD 渲染、island 机制
- **错误更早暴露**：配置错误在启动时而非运行时发现
- **globalThis 彻底删除**：`getActiveContext`/`setActiveContext`/`clearActiveContext` 全部移除，不再有 `globalThis[Symbol.for()]` 桥接。ctx 只通过显式参数传递。
- **ADR 0008 最终完成**：从 4 个 globalThis 桥接到 0 个，ADR 0008 的 globalThis 消除目标彻底达成

### Negative

- **多一个包**：8 个包变为 9 个，维护成本略增
- **用户 import 路径变化**：`lessjs()` 从 `@openelement/core` 改为 `@openelement/app`（有迁移成本）
- **app 强依赖 content 和 i18n**：即使不用，也必须安装（node_modules 里有）
- **split-call 模式需要显式传 ctx**：`lessContent()` 和 `lessI18n()` 不再自动发现 ctx，必须通过 `ctx` 参数传入

### Neutral

- 分开调用模式 `less() + lessContent({ ctx }) + lessI18n({ ctx })` 仍然可用，但需显式传 ctx
- `lessjs()` 的 API 签名不变，只是 import 来源变了
- `@openelement/app` 的版本号从 0.1.0 开始，独立于 core 版本

## 参考

- [ADR 0008: 消除 createServer()、.less/ 临时文件与 globalThis 桥接](/blog/0008-eliminate-createserver-globalthis-bridges)
- [ADR 0011: 消除最后一个 globalThis 桥接](/blog/0011-eliminate-last-globalthis-via-closebundle)

---

_决策日期: 2026-05-10 | 版本: v0.9.0_
