---
title: '测试'
lede: '使用与变更表面匹配的检查：routes 用 type checks，生成产物用 build checks，设计变更用 visual checks。'
order: 110
---

## 类型检查

生成的项目用一个快速信号对着真实的框架类型做检查：

```bash
deno task check   # deno check --config deno.json app/ vite.config.ts
```

它用真实的 `@openelement/*` 声明检查每个 route 与 component 源文件，因此 `definePage` 上写错的选项、与 loader 数据不匹配的 `props` 投影器、不受支持的装饰器选项或断掉的 import 都会在这里失败——在任何构建运行之前，且不需要浏览器。

loader 与 action 都是普通函数，因此可以直接测试。在 `deno test` 文件里 import 路由模块，用 `Request` 调用 loader、用 `FormData` 调用 action，然后断言返回的值：成功对象、`fail()` 产出的 `OpenElementActionFailure`（其 `status` 与 `data` 字段），或抛出的 `redirect()`/`notFound()`。

```ts
import { assertEquals } from '@std/assert';
import { action } from '../app/routes/guestbook.tsx';

Deno.test('空消息在校验阶段失败', () => {
  const formData = new FormData();
  formData.set('message', '');
  const failure = action({ formData });
  assertEquals(failure.status, 422);
});
```

这条路径不需要服务器、DOM 或框架运行时：校验、回显与 PRG 目标全部由函数的返回值决定。

### 重定向是抛出来的

成功不返回——它抛出携带目标与状态的 `OpenElementRedirect`（默认 302 在 POST 分派时被收敛为 303，即 PRG），所以测试断言的是抛出，而不是值：

```ts
import { assertEquals } from '@std/assert';
import { OpenElementRedirect } from '@openelement/router';
import { action } from '../app/routes/guestbook.tsx';

Deno.test('合法消息跳转到回显', () => {
  const formData = new FormData();
  formData.set('message', 'hello');
  let thrown: unknown;
  try {
    action({ formData });
  } catch (error) {
    thrown = error;
  }
  if (!(thrown instanceof OpenElementRedirect)) {
    throw new Error('合法消息必须跳转');
  }
  assertEquals(thrown.location, '/guestbook?echoed=hello');
});
```

### Loader 返回数据

loader 同理——普通异步函数，直接调用：

```ts
import { assertEquals } from '@std/assert';
import { loader } from '../app/routes/guestbook.tsx';

Deno.test('loader 返回条目列表', async () => {
  const data = await loader();
  assertEquals(Array.isArray(data.entries), true);
});
```

## 构建检查

构建是第二道门禁，也是某些契约唯一能检查的地方——预渲染、路由发现、静态路径展开与请求时输出都只在这里发生：

```bash
deno task build
deno task start   # 伺服 dist/；dist/server 存在时向它分派
```

要检查产物本身，而不只是相信日志。纯静态项目应当为每个路由产出 HTML，且完全不产出 `dist/server` 目录；含 `'dynamic'` 路由或 action 的项目应当产出 `dist/server/index.js`（可移植的 `fetch(Request) -> Response` 处理器）与列出请求时路由的 `dist/server/server-manifest.json`。`deno task start` 会打印它发现的是哪种模式，并且只伺服被构建出来的东西，所以在 `deno task dev` 里正常、在这里不对的页面，原因一定在构建期。

## 视觉检查

布局、DSD 层与 hydration 都是浏览器事实。伺服一次构建（`deno task start`），让浏览器自动化跑在它上面——Playwright 与 Web Test Runner 都能直接驱动构建产物——然后断言渲染后的 DOM，而不是 HTML 源码：shadow root 的内容只有页面解析之后才能查询，upgrade 也只有 island 的 chunk 加载之后才会发生。

任何交互组件都值得有的两条断言：在 island 的模块运行之前文档已完整且已样式化（static-first 契约）；upgrade 之后组件仍能响应真实的用户输入。本仓库自己的站点测试套件就是这种形态——端到端用例针对构建产物覆盖 DSD 层、hydration 行为、island 响应性与导航。

### 第一个浏览器冒烟测试

挡住客户端 bundle，页面必须照样绘制——static-first 契约浓缩为一个测试：

```ts
import { expect, test } from '@playwright/test';

test('挡住 island chunk 页面照样绘制', async ({ page }) => {
  await page.route('**/client/**', (route) => route.abort());
  await page.goto('http://localhost:4173/');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
});
```

## 另见

- [部署](/zh/guide/deployment)——构建产出什么，以及如何验证产物。
- [错误处理](/zh/guide/error-handling)——这些测试所断言的失败通道。
- [API 路由](/zh/guide/api)——值得直接测试的 handler 形态。
