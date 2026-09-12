---
title: 'LessJS 全仓库简化方案 — ADR 0009'
date: '2026-05-10'
lang: 'zh'
type: 'adr'
tags: ['architecture', 'decision']
draft: false
archived: true
---

> **基于**: ADR 0008 (消除 createServer + globalThis + .less/ IPC)
> **扩展**: 在 ADR 0008 基础上，对整个仓库进行功能不变前提下的解耦、复用、轻量、简化与合并
> **当前代码量**: core 5846 行 / ui 3063 行 / adapter-lit 739 行 / content 892 行 / rpc 270 行 / i18n 162 行

---

## 一、ADR 0008 执行层（已完成设计，直接落地）

ADR 0008 的 Phase C+B → A → D 是管线级重构，不在此重复。本方案将其作为 Layer 0 基础，在其之上叠加 Layer 1–3 的简化。

| Layer | 范围 | 性质 |
|-------|------|------|
| **Layer 0** | ADR 0008: C+B → A → D | 管线级：消除 createServer、globalThis、.less/ IPC、runtime-shim |
| **Layer 1** | @openelement/core 内部简化 | 模块级：删除多余抽象、消除重复、合并薄层 |
| **Layer 2** | 跨包解耦与复用 | 包级：统一 escape 模式、统一 logger、消除重复数据流 |
| **Layer 3** | 入口与导出精简 | API 级：合并 re-export 链、清理死代码导出 |

---

## 二、Layer 1 — @openelement/core 内部简化

### 2.1 删除 `CodeBuilder` 类 → 用 `string[]` 替代

**文件**: `entry-renderer.ts:29-42`

```ts
// 当前：14 行类定义 + 所有函数接受 b: CodeBuilder
class CodeBuilder {
  private lines: string[] = [];
  push(line: string): void { this.lines.push(line); }
  blank(): void { this.lines.push(''); }
  toString(): string { return this.lines.join('\n'); }
}
```

**改为**: `renderEntry()` 内部声明 `const lines: string[] = []`，所有 `render*` 函数改为接受 `lines: string[]`，`b.blank()` 改为 `lines.push('')`。

**收益**: 消除一个无值抽象，减少 14 行，降低函数签名耦合。

---

### 2.2 合并 `hono-entry.ts` 到 `entry-renderer.ts`

**文件**: `hono-entry.ts` (48 行)

`generateHonoEntryCode()` 只有 3 行有效逻辑：

```ts
const descriptor = buildEntryDescriptor(routes, options);
return renderEntry(descriptor);
```

同时该文件 re-export 了 `buildEntryDescriptor`、`renderEntry`、`EntryDescriptor`——三者已各自在原文件中独立导出。

**方案**:
- 将 `generateHonoEntryCode` + `HonoEntryOptions` 移到 `entry-renderer.ts` 底部
- 删除 `hono-entry.ts`
- 所有导入点改为从 `entry-renderer.ts` 导入
- `index.ts` 改为 `import { generateHonoEntryCode } from './entry-renderer.js'`

**收益**: 减少 1 个文件 + 48 行，消除 re-export 链。

**测试影响**: 两个测试文件需改导入路径：`entry-renderer.test.ts` 和 `entry-descriptor.test.ts`。

---

### 2.3 消除内联 HTML 转义 → 使用 `escapeHtml()`

**文件**: `entry-renderer.ts:238-239` (生成的代码中)

```ts
// 当前：160 字符的 replace 链
const safeErr = String(err.stack || err).replace(/&/g,'&amp;').replace(/</g,'&lt;')...
```

**改为**: 在 `buildEntryDescriptor()` 中给 `imports` 增加 `escapeHtml` 的导入声明，生成的代码改为：

```ts
import { escapeHtml } from '@openelement/core/html-escape';
// ...
const safeErr = escapeHtml(String(err.stack || err));
```

**同理**: `ssr-handler.ts:31` 的内联 `.replace(/</g, '&lt;').replace(/>/g, '&gt;')` 也改为使用 `escapeHtml()`（该文件已从 `html-escape.ts` 导入 `wrapInDocument`）。

**收益**: 消除两处逻辑重复，减少生成代码体积，单一真相源。

---

### 2.4 合并 `renderPageRoute` 的 wrapInDocument 分支

**文件**: `entry-renderer.ts:209-228`

当前有两个分支，`wrapInDocument` 的 5 行参数完全相同，仅第一个参数不同（`wrapped` vs `html`）。

**改为**: 统一变量名，消除分支：

```ts
lines.push(`    let content = html`);
for (const renderer of matchingRenderers) {
  lines.push(`    content = ${renderer.varName}.default.wrap(content, c)`);
}
lines.push(`    return c.html(wrapInDocument(content, {`);
lines.push(`      title: ..., lang: ..., headExtras: ..., cspNonce: ...`);
lines.push(`    }))`);
```

当 `matchingRenderers.length === 0` 时，循环不执行，`content === html`，行为不变。

**收益**: 消除 6 行重复，逻辑更清晰。

---

### 2.5 合并 `renderCorsOrigin` 的重复分支

**文件**: `entry-renderer.ts:53-62`

```ts
// 当前：string 和 Array 两个分支做同样的事
if (typeof origin === 'string') { return JSON.stringify(origin); }
if (Array.isArray(origin))   { return JSON.stringify(origin); }
```

**改为**:

```ts
function renderCorsOrigin(origin: CorsOriginConfig): string {
  if (typeof origin === 'object' && !Array.isArray(origin)) return origin.body;
  return JSON.stringify(origin);
}
```

**收益**: 减少 4 行。

---

### 2.6 合并 `ssr-handler.ts` 到 `html-escape.ts`

**文件**: `ssr-handler.ts` (63 行)

当前 `ssr-handler.ts` 只做两件事：
1. Re-export `wrapInDocument`（从 `html-escape.ts`）
2. 定义 `renderSsrError()` 函数

`html-escape.ts` 已经有 `wrapInDocument`、`escapeHtml`、`escapeAttr` 等——`renderSsrError()` 是 HTML 错误页面渲染，与 `html-escape.ts` 的"HTML 输出工具"定位完全一致。

**方案**:
- 将 `renderSsrError()` 移入 `html-escape.ts`
- `ssr-handler.ts` 改为纯 re-export 文件（兼容性），或直接删除
- `index.ts` 的 `export { renderSsrError, wrapInDocument } from './ssr-handler.js'` 改为 `from './html-escape.js'`

**收益**: 减少 1 个文件的概念负担，HTML 渲染工具统一。

---

### 2.7 将 `__ssr` 辅助函数从生成代码移到 `less-runtime.ts`

**文件**: `entry-renderer.ts:386-401` (每次构建都生成的 ~16 行代码)

`__ssr()` 是一个完全确定性的辅助函数，逻辑只依赖 `renderDSD` 和 `log`——两者都在 `less-runtime.ts` 中已导出。

**方案**: 将 `__ssr` 移到 `less-runtime.ts` 导出，生成的 entry 代码只需 `import { ..., __ssr } from '@openelement/core/less-runtime'`。

**注意**: 这会增加 `less-runtime.ts` 的导出，但 `__ssr` 在 SSG bundle 中是 tree-shakeable 的（如果不被使用就不会包含）。

**替代方案（更安全）**: 如果担心 `less-runtime.ts` 的职责膨胀，可以新建 `less-ssr-helper.ts` 并在 `entry-renderer.ts` 生成的代码中 `import { __ssr } from '@openelement/core/less-ssr-helper'`。

**收益**: 每个入口模块减少 ~200 字节生成代码。

---

### 2.8 消除 `__less_get_default_export` 辅助函数

**文件**: `entry-renderer.ts:348`

```ts
const __less_get_default_export = (module) => module && module.default
```

这个函数只是 `module?.default` 的别名。可以直接内联：

```ts
const __island_component_x = __island_x?.default
```

**收益**: 消除一个生成代码中的辅助函数，更符合 JS 惯例。

---

### 2.9 删除 `LessBuildContext.userResolveAlias`

**文件**: `build-context.ts:42`

`userResolveAlias` 的存在是为了 `createServer()` 路径下传递 resolve alias——ADR 0008 Phase C 消除 `createServer()` 后，此字段不再需要。

**时机**: 与 ADR 0008 Phase C 同步。

---

## 三、Layer 2 — 跨包解耦与复用

### 3.1 统一 escape 模式：`render-dsd.ts` 的 re-export 链

**文件**: `render-dsd.ts:30-36`

```ts
export {
  escapeAttr, escapeAttrValue, escapeHtml,
  type SafeHtml, type UnsafeHtml,
} from './html-escape.js';
```

`render-dsd.ts` re-export `html-escape.ts` 的所有内容——这意味着消费者可以从 `@openelement/core/render-dsd` 或 `@openelement/core/html-escape` 两处导入同一函数。

**问题**: 这是历史遗留。`render-dsd.ts` 的核心职责是 DSD 渲染，不应承担 escape 工具的导出。

**方案**:
- 保留 `deno.json` 中 `./html-escape` 导出路径
- 在 `render-dsd.ts` 的 re-export 块上方添加 `@deprecated` 注释
- 下一个大版本移除 re-export

---

### 3.2 `runtime-shim.ts` 的巨型字符串化代码是最大的技术债

**文件**: `runtime-shim.ts` (3 行，但字符串内容 ~2000+ 字符)

这是 `generate-runtime-shim.ts` 脚本从源码 AST 提取 + 编译 + 字符串化产物的硬编码副本。每次修改 `render-dsd.ts`、`html-escape.ts`、`render-nested.ts` 都必须重新运行脚本。

**方案**: ADR 0008 Phase D 完成后，整个机制删除。这是 ADR 0008 的核心收益之一，不重复。

**优先级**: 与 ADR 0008 Phase D 绑定。

---

### 3.3 `@openelement/content` 的 `blog-data.ts` → 与 `i18n-data.ts` 对齐

**文件**: `packages/content/src/blog/blog-data.ts`

当前使用 `globalThis[Symbol.for()]` 桥接，而 `@openelement/i18n` 的 `i18n-data.ts` 使用干净的模式（纯模块变量）。

**方案**: ADR 0008 Phase B 已覆盖。执行后两者模式完全一致。

---

### 3.4 `entry-generators.ts` 的客户端入口代码可以简化

**文件**: `entry-generators.ts` (115 行)

生成的客户端入口代码内联了一个 `log` stub：

```js
var log = {
  warn: function() { var a = ['[LessJS]']; a.push.apply(a, arguments); ... },
  error: function() { ... },
};
```

这个 stub 与 `logger.ts` 的 `LessLogger` 逻辑重复，但因为它要运行在浏览器端且不能依赖模块系统，所以内联是合理的。

**评估**: 此项不做简化——浏览器端 shim 的内联是刻意为之，避免引入构建时依赖。

---

### 3.5 `ssg-postprocess.ts` 的 HTML 遍历模式重复

**文件**: `ssg-postprocess.ts`

`injectClientScript`、`injectCspMeta`、`injectDsdPolyfill`、`injectViewTransitionMeta`、`injectSpeculationRules` 五个函数都有相同的外层循环：

```ts
const entries = readdirSync(dir, { withFileTypes: true });
for (const entry of entries) {
  const fullPath = join(dir, entry.name);
  if (entry.isDirectory()) { /* 递归 */ }
  else if (entry.name.endsWith('.html')) { /* 读取 → 修改 → 写入 */ }
}
```

**方案**: 提取 `walkHtmlFiles(dir, visitor: (fullPath, content) => string | null)` 高阶函数：

```ts
function walkHtmlFiles(dir: string, visitor: (content: string, fullPath: string) => string | null): void {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) { walkHtmlFiles(fullPath, visitor); return; }
    if (entry.name.endsWith('.html')) {
      const content = readFileSync(fullPath, 'utf-8');
      const result = visitor(content, fullPath);
      if (result !== null) writeFileSync(fullPath, result, 'utf-8');
    }
  }
}
```

**收益**: 消除 5 处相同的目录遍历代码，减少 ~60 行重复。

---

### 3.6 `build-manifest.ts` 的 `collectFiles` 与 `ssg-postprocess.ts` 的遍历重复

**文件**: `build-manifest.ts:59-88`

`collectFiles()` 也是递归遍历文件系统，但与 `walkHtmlFiles` 不同——它收集信息不修改文件。两者可以共享 `walkDir` 基础函数。

**方案**: 如果 3.5 提取了 `walkHtmlFiles`，可以进一步抽象为 `walkDir(dir, { onFile, onDir, filter })` 通配遍历器。但优先级低——`build-manifest.ts` 是纯可观察性工具，不影响功能。

**评估**: 标记为 P2，不做在本轮。

---

## 四、Layer 3 — 入口与导出精简

### 4.1 `render-dsd.ts` 的 re-export 链清理

如 3.1 所述，`render-dsd.ts` re-export 了 `html-escape.ts` 和 `types.ts` 的内容。在 ADR 0008 完成后，`render-dsd.ts` 应只导出与 DSD 渲染直接相关的内容：

**保留导出**:
- `renderDSD`, `renderDSDByName` (核心功能)
- `camelToKebab` (被 SSR 代码使用)
- `renderNestedCustomElements` (从 render-nested.ts)

**标记 @deprecated 的 re-export**:
- `escapeAttr`, `escapeAttrValue`, `escapeHtml`, `SafeHtml`, `UnsafeHtml`
- `ComponentLayer`, `DsdComponent`, `DsdOptions`, `HydrateEventDescriptor`, `RenderAdapter`, `registerAdapter`

这些应引导消费者使用 `@openelement/core/html-escape` 和 `@openelement/core` 主入口。

---

### 4.2 `less-runtime.ts` 的导出精简

**文件**: `less-runtime.ts` (15 行)

```ts
export { log };
export { registerAdapter, renderDSD, renderDSDByName } from './render-dsd.js';
export { Hono } from 'hono';
export { wrapInDocument } from './ssr-handler.js';
```

问题：`export { Hono } from 'hono'` 让 `less-runtime` 成了 Hono 的 re-export 点。SSR bundle 已经 `import { Hono } from 'hono'`，不需要通过 `less-runtime` 间接获取。

**方案**: 移除 `export { Hono }`，生成的 entry 代码直接 `import { Hono } from 'hono'`。

**收益**: `less-runtime.ts` 职责更清晰——只导出 LessJS 自己的运行时 API。

---

### 4.3 `index.ts` 导出审计

**文件**: `index.ts` (305 行)

当前 `index.ts` 导出了大量内部细节，如：
- `extractCustomElementTags` (island-manifest 内部)
- `buildSpeculationRulesJson` (ssg-postprocess 内部)
- `buildIslandChunkMap` (ssg-postprocess 内部)
- `printBuildManifest`, `scanClientBuild`, `scanSSGOutput` (build-manifest 内部)

这些都是 CLI 工具的内部函数，不应通过公共 API 暴露。

**方案**:
- 将 CLI 专用函数标记为 `@internal`（在 deno.json 的 exports 中不导出）
- 或将其移到 `@openelement/core/cli/*` 导出路径下

**收益**: 公共 API 表面更小，减少破坏性变更的风险。

---

### 4.4 `types.ts` 的职责拆分

**文件**: `types.ts` (375 行)

`types.ts` 承担了三个职责：
1. **公共类型定义** (`FrameworkOptions`, `RouteEntry`, `DsdComponent` 等)
2. **运行时状态** (`_adapter`, `registerAdapter`, `getAdapter`)
3. **DSD 类型** (`DsdOptions`, `ComponentLayer`, `HydrateEventDescriptor`)

其中第 2 项（模块级 `_adapter` + accessor）违反了"类型文件不应有运行时状态"的原则。

**方案**: 将 `registerAdapter` / `getAdapter` + `_adapter` 移到 `adapter-registry.ts`（或 `less-runtime.ts`），`types.ts` 只保留类型定义。

**收益**: 类型文件回到纯类型职责，运行时状态有明确的家。

---

## 五、简化后的文件结构预期

### 变更汇总

| 操作 | 文件 | 说明 |
|------|------|------|
| **删除** | `hono-entry.ts` | 合并到 entry-renderer.ts |
| **删除** | `runtime-shim.ts` | ADR 0008 Phase D |
| **删除** | `scripts/generate-runtime-shim.ts` | ADR 0008 Phase D |
| **删除** | `ssr-handler.ts` | 合并到 html-escape.ts（留 re-export 兼容） |
| **合并** | `CodeBuilder` → `string[]` | entry-renderer.ts 内部 |
| **提取** | `walkHtmlFiles()` | ssg-postprocess.ts 内部，消除 5 处重复 |
| **提取** | `__ssr` → less-runtime.ts | 或新建 less-ssr-helper.ts |
| **移动** | `registerAdapter`/`getAdapter` | types.ts → adapter-registry.ts |
| **移除** | `export { Hono }` | less-runtime.ts |
| **标记** | `@deprecated` re-exports | render-dsd.ts 对 html-escape 的 re-export |
| **清理** | `userResolveAlias` | build-context.ts（ADR 0008 Phase C 后） |

### 预期行数变化

| 文件 | 当前 | 预期 | 变化 |
|------|------|------|------|
| entry-renderer.ts | 472 | ~440 | -32 (删除 CodeBuilder + 合并分支 + 合并 CORS 分支) |
| hono-entry.ts | 48 | 0 | -48 (删除) |
| html-escape.ts | 137 | ~170 | +33 (接收 renderSsrError) |
| ssr-handler.ts | 63 | ~5 | -58 (改 re-export) |
| ssg-postprocess.ts | 409 | ~360 | -49 (提取 walkHtmlFiles) |
| less-runtime.ts | 15 | ~30 | +15 (接收 __ssr) |
| types.ts | 375 | ~345 | -30 (移出 adapter 状态) |
| build-context.ts | 61 | ~55 | -6 (移出 userResolveAlias) |
| **核心总计** | **5846** | **~5500** | **~350 行减少** |

---

## 六、执行顺序与依赖

```
Layer 0: ADR 0008 (Phase C+B → A → D)
  │
  │ ← 必须先完成，Layer 1 的一些简化依赖其结果
  │
  ├─→ Layer 1.1: 删除 CodeBuilder            (独立，随时可做)
  ├─→ Layer 1.2: 合并 hono-entry.ts           (独立，随时可做)
  ├─→ Layer 1.3: 消除内联 escape               (独立，随时可做)
  ├─→ Layer 1.4: 合并 renderPageRoute 分支     (独立，随时可做)
  ├─→ Layer 1.5: 合并 renderCorsOrigin 分支    (独立，随时可做)
  ├─→ Layer 1.6: 合并 ssr-handler.ts          (独立，随时可做)
  ├─→ Layer 1.7: __ssr 移到 less-runtime       (需 ADR 0008 Phase C 后)
  ├─→ Layer 1.8: 消除 __less_get_default_export (独立)
  ├─→ Layer 1.9: 移除 userResolveAlias        (需 ADR 0008 Phase C 后)
  │
  ├─→ Layer 2.1: render-dsd.ts re-export 标记   (独立)
  ├─→ Layer 2.2: runtime-shim 删除              (ADR 0008 Phase D)
  ├─→ Layer 2.3: blog-data.ts 对齐             (ADR 0008 Phase B)
  ├─→ Layer 2.5: 提取 walkHtmlFiles            (独立)
  │
  └─→ Layer 3.1-3.4: 导出精简与拆分            (Layer 1 完成后)
```

**关键约束**:
- Layer 1.1–1.6 和 1.8 **全部互相独立**，可以并行执行
- Layer 1.7 和 1.9 **依赖 ADR 0008 Phase C**
- Layer 3 的导出变更 **依赖 Layer 1 完成后**（避免中途改导出路径两次）

---

## 七、风险矩阵

| 变更 | 破坏性 | 风险 | 缓解 |
|------|--------|------|------|
| 删除 CodeBuilder | 内部 | 零 | 纯机械替换 |
| 合并 hono-entry.ts | 测试导入路径 | 低 | 2 个测试文件改路径 |
| 消除内联 escape | 生成代码变化 | 低 | 快照测试覆盖 |
| 合并 renderPageRoute 分支 | 生成代码变化 | 低 | 行为等价验证 |
| 合并 ssr-handler.ts | 公共导出路径 | 中 | 保留 re-export 兼容层 |
| __ssr 移到 less-runtime | 运行时依赖链 | 中 | 需验证 tree-shaking |
| 移除 `export { Hono }` | 生成代码导入 | 低 | 改为直接 import |
| 提取 walkHtmlFiles | 内部 | 低 | 纯重构 |
| types.ts 拆分 | 导入路径 | 中 | 保留 re-export 兼容层 |

---

## 八、不在本方案范围内的事项

| 事项 | 原因 |
|------|------|
| `entry-generators.ts` 的客户端 log stub | 浏览器端不能依赖模块系统，内联合理 |
| `build-manifest.ts` 的文件遍历 | 纯可观察性工具，P2 |
| `navigation.ts` 的 Navigation API 类型声明 | 标准 API 模拟，改动风险高收益低 |
| `island.ts` 的 connectedCallback 包装 | 核心功能，不能简化 |
| `render-nested.ts` 的 parse5 AST 遍历 | 性能关键路径，不能简化 |

---

_方案日期: 2026-05-10 | 基于 ADR 0008 + 全仓库审查_
