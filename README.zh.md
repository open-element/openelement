<p align="center">
  <img src="./www/public/favicon.svg" alt="openElement 标志" width="64" height="64" />
</p>

# OpenElement

<p align="center">
  <a href="https://www.bestpractices.dev/projects/16052"><img src="https://www.bestpractices.dev/projects/16052/badge" alt="OpenSSF Best Practices: passing" /></a>
  <img src="https://img.shields.io/npm/v/%40openelement%2Frouter" alt="npm version" />
  <img src="https://badgen.net/npm/dm/%40openelement%2Felement" alt="npm monthly downloads" />
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="license: MIT" />
  <img src="https://img.shields.io/badge/node-%3E%3D24.2-informational" alt="node: >=24.2" />
</p>

[English](./README.md) | 简体中文

OpenElement 是用于服务端渲染 HTML 和构建交互式 Custom Elements 的框架。**Compiler** 将 TSX 编译为 Custom Elements 和服务端渲染器。**Element** 提供运行时。**Router** 负责路由、导航、loader 和 action。

## 预览当前源码

当前源码预览的是 `1.0.0-alpha.16`，支持服务端函数页面和编译器生成的 Custom Elements。setup 任务从当前源码构建包，并将其安装到临时示例应用。[发布状态](./docs/release/release-state.json)

```sh
pnpm install --frozen-lockfile
export STARTER_SMOKE_WORK_DIR="$(mktemp -d)"
pnpm exec vp run --no-cache --fail-if-no-match --filter @openelement/e2e-starter-smoke setup
cd "$STARTER_SMOKE_WORK_DIR/my-blog"
pnpm run dev
```

编辑 `app/routes/index.tsx` 即可体验文件路由。停止开发服务器后运行 `pnpm test` 和 `pnpm run build`。[脚手架包](./packages/create/README.md)

## 通过 npm 开始

需要 Node.js 24.2 或更新版本。该命令使用 npm `latest` 标签对应的脚手架版本，可用 `npm view @openelement/create dist-tags` 查询。

```sh
npm create @openelement my-app
cd my-app
npm run dev
```

打开开发服务器输出的地址。停止开发服务器后运行 `npm run build`。

## 仓库结构

| 目录 | 用途 |
| --- | --- |
| [packages](./packages) | [Element 运行时](./packages/element)、[编译器](./packages/compiler)、[协议契约](./packages/protocol)、[Router](./packages/router)、[脚手架 CLI](./packages/create)和[实验性 UI](./packages/ui) |
| [tests](./tests) | 跨包测试、脚手架冒烟测试和部署测试项目 |
| [tools](./tools) | 仓库检查、发布打包和打包消费者测试 |
| [docs](./docs/architecture/README.md) | 当前架构和[决策记录](./docs/adr/README.md) |
| [www](./www) | 官方文档站点及其浏览器测试 |
| [apps/saas](./apps/saas) | 独立治理的第一方应用 |

访问[官网](https://openelement.org)或阅读[贡献指南](./CONTRIBUTING.md)。如需报告安全问题，请参阅[安全策略](./SECURITY.md)。[MIT 许可证](./LICENSE)
