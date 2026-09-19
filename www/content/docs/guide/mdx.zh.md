---
title: 'MDX'
lede: '文档内容编译进与手写页面相同的 route 与 component 体系。'
order: 50
---

## 内容来源

routes 目录下的 `.mdx` 文件与其他路由一样是路由：`app/routes/about.mdx` 伺服 `/about`，被同一个路由扫描器发现，并在构建时预渲染。文件里是纯 Markdown，受支持的子集是刻意划定的——标题、段落、emphasis/strong/delete、链接、图片、列表、代码、引用块与水平线。

构建会先把该文件降级为编译页面模块，再运行 compiled-element transform，因此 MDX 页面与手写的 `.tsx` 页面走完全相同的 Part Program 管线；元素标签由路由相对路径派生，以保证生成入口注册的标签与程序声明的标签一致。Markdown 的任何部分都不会到达浏览器：输出是普通 HTML，页面内容位于宿主的 shadow root 中。

Markdown 解析是这条路径唯一的依赖，而它是 `@openelement/router` 的可选 peer——只有真正有 `.mdx` 文件进入构建时才会解析它。把它加进应用的 import map：

```json
{
  "imports": {
    "marked": "npm:marked@^15.0.0"
  }
}
```

如果存在 `.mdx` 路由却没有该解析结果，构建会带着安装指引失败，而不是产出一个坏页面。

## 组件

静态子集是契约本身，不是起点。`.mdx` 里的原始 HTML 块、JSX 表达式、ESM `import`/`export` 语句以及组件使用都会以带源码位置的构建错误 fail closed。Markdown 页面是文档；交互行为属于 `.tsx` 路由或组件里的编译元素，那里有完整的编译器表面——属性、signal、事件处理器、slot。

需要更丰富写法的站点把管线留在自己手里。router 提供路由、渲染上下文与 Document 所有权——不是内容数据库——因此 frontmatter schema、集合加载、导航映射与任何自定义 Markdown 渲染器都属于你。本仓库自己的站点就用这个划分：集合加载器把 Markdown 渲染为第一方可信 HTML，编译页面通过 props 收到结果。

## 构建路径

`deno task build` 会连同整棵路由树一起编译 `.mdx` 路由。它们与任何页面遵循同样的渲染规则——默认 `renderIntent` 模式是 static，因此会被预渲染到 `dist/` 下的路由路径，并与其他路由一样进入 sitemap。

失败发生在构建期而不是请求期：不受支持的构造、无法解析的 `marked` import、无法派生的标签都会以带源码位置的信息中止构建。`deno task check` 与此同时对应用的 TypeScript 源码做类型检查，所以手写 `.tsx` 页面保留自己的快速信号，而 `.mdx` 页面由构建本身覆盖。

## 另见

- [配置](/zh/guide/configuration)——内容管线为何留在站点一侧。
- [路由与数据](/zh/guide/routing-and-data)——MDX 页面加入的路由契约。
- [样式](/zh/guide/styling)——渲染出的内容在页面上如何被样式化。
