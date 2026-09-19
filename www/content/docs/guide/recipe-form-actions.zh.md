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
import { element, OpenElement, property } from '@openelement/element';

@element('contact-page')
export default class ContactPage extends OpenElement {
  @property({ reflect: false, attribute: false })
  error = '';

  @property({ reflect: false, attribute: false })
  echoed = '';

  render() {
    return (
      <main>
        <h1>contact</h1>
        <form method='post' data-open-enhance>
          <input name='message' type='text' />
          <button type='submit'>Send</button>
          <button type='submit' formaction='?/shout'>Shout</button>
        </form>
        {this.error ? <p role='alert'>{this.error}</p> : <span></span>}
        {this.echoed ? <p>echo={this.echoed}</p> : <span></span>}
      </main>
    );
  }
}
```

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
