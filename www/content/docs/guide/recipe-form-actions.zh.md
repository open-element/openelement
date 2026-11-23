---
title: '端到端表单 action'
lede: '一个联系表单：校验、回显失败、成功跳转——不需要任何客户端 JavaScript。'
navLabel: '表单 action'
order: 120
section: 'Recipes'
---

## 闭环

一个路由、一个表单、三种结果：空提交以 422 重渲染并回显，合法提交以 303 回答到 PRG 目标，命名 action 在同一表单上提供第二个动词。这是[路由与数据](/zh/guide/routing-and-data)中的应用闭环，压缩到最小可运行形态。

## 组件

```tsx
// app/components/page-contact.tsx — the form's own markup, no client behavior.
import { computed } from '@openelement/element';
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  tag: 'contact-page',
  // The page root is a shadow root: the compiler's DSD host producer renders it,
  // which is what puts the form in the first response with no script.
  root: 'shadow',
  properties: {
    // One row per projector key. Both values are attribute-free: the projector
    // is their only channel, so nothing can leak into a host attribute.
    error: { attribute: false, default: '' },
    echoed: { attribute: false, default: '' },
  },
});

export default function ContactPage(props: { error: string; echoed: string }) {
  // Derived, not stored: the flags are projections of the rows, so they can
  // never disagree with the values they gate.
  const hideError = computed(() => props.error === '');
  const hideEcho = computed(() => props.echoed === '');

  return (
    <main>
      <h1>contact</h1>
      <form method='post' data-open-enhance>
        <input name='message' type='text' />
        <button type='submit'>Send</button>
        <button type='submit' formaction='?/shout'>Shout</button>
      </form>
      <p role='alert' hidden={hideError.value}>{props.error}</p>
      <p hidden={hideEcho.value}>echo=<span>{props.echoed}</span></p>
    </main>
  );
}
```

两个消息元素刻意放在任何条件分支之外。分支只准入一个 JSX 元素或 `null`，而取值为文本的分支——`{props.error ? 'has an error' : null}`——会以 `OEC9042`（"a conditional branch must be JSX or null"）失败关闭。这份配方让两条消息无条件渲染，并为每一行派生一个布尔 `computed()`，改为切换 `hidden` attribute。因此回显值仍是普通的文本插值：它有一个稳定的节点，永远不会成为分支必须重新创建的东西。

## 路由

```ts
import { definePage, fail, redirect } from '@openelement/router';
import ContactPage from '../components/page-contact.tsx';

export function action(ctx: { formData: FormData }) {
  const message = String(ctx.formData.get('message') ?? '').trim();
  if (!message) {
    return fail(422, { error: 'message is required' });
  }
  throw redirect('/contact?echoed=' + encodeURIComponent(message));
}

export const actions = {
  shout(ctx: { formData: FormData }): never {
    const message = String(ctx.formData.get('message') ?? '').trim() || 'silence';
    throw redirect('/contact?echoed=' + encodeURIComponent(message.toUpperCase()));
  },
};

export default definePage(ContactPage, {
  renderIntent: { mode: 'dynamic' },
  props({ actionData, request }) {
    const data = actionData as { error?: string } | undefined;
    const echoed = request ? new URL(request.url).searchParams.get('echoed') : undefined;
    return { error: data?.error ?? '', echoed: echoed ?? '' };
  },
});
```

## 为什么不需要 JavaScript 也能工作

表单是纯 HTML：浏览器 POST，action 以 422 或 303 回答，路由重渲染。`data-open-enhance` 只在 island 已 hydrate 的地方升级体验（fetch + 就地 morph）。action 必须在校验失败后可安全重跑——正是这个约束让无 JS 路径与增强路径跑同一份代码。

## 另见

- [路由与数据](/zh/guide/routing-and-data)——loader、完整 guestbook 与冻结的闭环语义。
- [术语表](/zh/guide/glossary)——action、PRG、`trustedHtml` 一处速查。
