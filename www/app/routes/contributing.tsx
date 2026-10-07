/**
 * Contributing Page - v4 lab page: mono/serif masthead, setup terminal,
 * PR checklist, numbered help rows, and a questions-first callout.
 */
import { definePage } from '@openelement/router';
import { trustedHtml } from '@openelement/element';
import { siteHead } from '#site-ui/head.ts';
import { contentLocale } from '#site-ui/locale.ts';
import { localizePath } from '#site-ui/link.ts';
import { contributingSetupCodeHtml } from '../data/_generated-page-code.ts';
import PageContributing from '../components/page-contributing.tsx';

export const meta = { section: '', label: 'Contributing', order: 30 };

const content = {
  en: {
    headTitle: 'Contributing',
    headDescription:
      'A precise, Node-first contributor workflow for the openElement Web Standards Lab: setup, PR checklist and where to help.',
    eyebrow: 'Contributing — Join the lab',
    monoLine: 'BUILD IT',
    serifLine: 'with us.',
    lede: 'A precise, Node-first contributor workflow for the Web Standards Lab.',
    setupAriaLabel: 'Development setup',
    setupLabel: '§1 — Setup',
    setupCopyBefore:
      'openElement core CLI, SSG, serverless API, tests, publishing, and docs site tasks all run on Node 24.2+ with pnpm as the package manager. Tasks go through ',
    setupCopyVite: 'pnpm run <task>',
    setupCopyBetween: ' or the vp task runner — no ',
    setupCopyNpm: 'npm',
    setupCopyAnd: ' or ',
    setupCopyNpx: 'npx',
    setupCopyAfter: ' global installs in the main workflow.',
    releaseLabel: 'Release line',
    releaseItems: [
      {
        id: 'versions',
        before: 'Run ',
        code1: 'pnpm --dir tools/repo run version-bump',
        middle1: '',
        code2: '',
        middle2: '',
        code3: '',
        after: '',
      },
      {
        id: 'changelog',
        before: 'Update the changelog',
        code1: '',
        middle1: '',
        code2: '',
        middle2: '',
        code3: '',
        after: '',
      },
      {
        id: 'test',
        before: 'Run ',
        code1: 'pnpm test',
        middle1: '',
        code2: '',
        middle2: '',
        code3: '',
        after: '',
      },
      {
        id: 'publish',
        before: 'Publish via ',
        code1: 'pnpm --dir tools/release run pack:dry-run',
        middle1: ', ',
        code2: 'pnpm run release:check',
        middle2: ', ',
        code3: 'pnpm --dir tools/release run publish:npm',
        after: '',
      },
      {
        id: 'release',
        before: 'Create the GitHub Release',
        code1: '',
        middle1: '',
        code2: '',
        middle2: '',
        code3: '',
        after: '',
      },
    ],
    beforePrLabel: '§2 — Before a PR',
    checklist: [
      {
        id: 'format',
        checkboxClass: 'checkbox',
        mark: '✓',
        text: 'pnpm run fmt + pnpm run lint stay clean',
      },
      {
        id: 'commits',
        checkboxClass: 'checkbox',
        mark: '✓',
        text: 'Conventional Commits (feat / fix / docs / refactor / test / chore)',
      },
      {
        id: 'gates',
        checkboxClass: 'checkbox',
        mark: '✓',
        text: 'Gates green locally — pnpm run check + pnpm test before push',
      },
      {
        id: 'adr',
        checkboxClass: 'checkbox open',
        mark: '',
        text: 'Architectural change? Write the ADR first',
      },
    ],
    layeringCopy:
      'Layering discipline: before adding a feature, check whether it can be solved at a lower level — L0 HTML, L1 CSS, L2 Browser API, L3 Hono/Vite/Lit, then L4 custom code.',
    helpLabel: '§3 — Where to help',
    helpRows: [
      {
        id: 'corpus',
        index: '01',
        title: 'Third-party WC corpus',
        copy: 'Lit / FAST / Stencil components that render through our DSD smoke pipeline, with evidence.',
      },
      {
        id: 'dogfood',
        index: '02',
        title: 'Dogfood something real',
        copy: 'Build an application on the stable line and file what breaks. That is the pilot now.',
      },
      {
        id: 'docs',
        index: '03',
        title: 'Documentation truth',
        copy: 'Run the docs gates, fix stale claims, and keep the public surface evidence-backed.',
      },
    ],
    calloutLabel: 'Questions first',
    calloutIntro: 'Use ',
    discussionsLabel: 'GitHub Discussions',
    calloutBetween: ' for usage and design. ',
    issuesLabel: 'Issues',
    calloutAfter: ' for reproducible bugs, documentation defects, and agreed proposals.',
    changelogLabel: 'Changelog',
    roadmapLabel: 'Roadmap',
  },
  zh: {
    headTitle: '贡献指南',
    headDescription:
      '面向 openElement Web Standards Lab 的精确、Node 优先的贡献者工作流：环境设置、PR 清单与入手方向。',
    eyebrow: '贡献 — 加入实验室',
    monoLine: '构建它',
    serifLine: '与我们一起。',
    lede: '面向 Web Standards Lab 的精确、Node 优先的贡献者工作流。',
    setupAriaLabel: '开发环境设置',
    setupLabel: '§1 — 环境设置',
    setupCopyBefore:
      'openElement 核心 CLI、SSG、serverless API、测试、发布与文档站任务都运行在 Node 24.2+ 上，以 pnpm 作为包管理器。任务通过 ',
    setupCopyVite: 'pnpm run <task>',
    setupCopyBetween: ' 或 vp 任务器驱动——主工作流不需要 ',
    setupCopyNpm: 'npm',
    setupCopyAnd: ' 或 ',
    setupCopyNpx: 'npx',
    setupCopyAfter: ' 的全局安装。',
    releaseLabel: '发布线',
    releaseItems: [
      {
        id: 'versions',
        before: '运行 ',
        code1: 'pnpm --dir tools/repo run version-bump',
        middle1: '',
        code2: '',
        middle2: '',
        code3: '',
        after: '',
      },
      {
        id: 'changelog',
        before: '更新 changelog',
        code1: '',
        middle1: '',
        code2: '',
        middle2: '',
        code3: '',
        after: '',
      },
      {
        id: 'test',
        before: '运行 ',
        code1: 'pnpm test',
        middle1: '',
        code2: '',
        middle2: '',
        code3: '',
        after: '',
      },
      {
        id: 'publish',
        before: '通过 ',
        code1: 'pnpm --dir tools/release run pack:dry-run',
        middle1: '、',
        code2: 'pnpm run release:check',
        middle2: '、',
        code3: 'pnpm --dir tools/release run publish:npm',
        after: ' 发布',
      },
      {
        id: 'release',
        before: '创建 GitHub Release',
        code1: '',
        middle1: '',
        code2: '',
        middle2: '',
        code3: '',
        after: '',
      },
    ],
    beforePrLabel: '§2 — 提交 PR 之前',
    checklist: [
      {
        id: 'format',
        checkboxClass: 'checkbox',
        mark: '✓',
        text: 'pnpm run fmt + pnpm run lint 保持干净',
      },
      {
        id: 'commits',
        checkboxClass: 'checkbox',
        mark: '✓',
        text: 'Conventional Commits（feat / fix / docs / refactor / test / chore）',
      },
      {
        id: 'gates',
        checkboxClass: 'checkbox',
        mark: '✓',
        text: '本地门禁全绿——推送前先跑 pnpm run check 和 pnpm test',
      },
      {
        id: 'adr',
        checkboxClass: 'checkbox open',
        mark: '',
        text: '涉及架构变更？先写 ADR',
      },
    ],
    layeringCopy:
      '分层纪律：新增功能之前，先检查能否在更低层解决——L0 HTML、L1 CSS、L2 浏览器 API、L3 Hono/Vite/Lit，最后才是 L4 自定义代码。',
    helpLabel: '§3 — 可以从哪里入手',
    helpRows: [
      {
        id: 'corpus',
        index: '01',
        title: '第三方 WC 语料库',
        copy: '让 Lit / FAST / Stencil 组件跑通我们的 DSD 冒烟管线，并留下证据。',
      },
      {
        id: 'dogfood',
        index: '02',
        title: '真实 dogfood',
        copy: '在稳定线上构建一个真实应用，把遇到的问题记录下来。这就是当前的试点。',
      },
      {
        id: 'docs',
        index: '03',
        title: '文档真值',
        copy: '运行文档门禁，修掉过期论断，让公开面始终有证据支撑。',
      },
    ],
    calloutLabel: '先提问',
    calloutIntro: '用法与设计问题请使用 ',
    discussionsLabel: 'GitHub Discussions',
    calloutBetween: '。',
    issuesLabel: 'Issues',
    calloutAfter: ' 用于可复现的 bug、文档缺陷与已达成共识的提案。',
    changelogLabel: 'Changelog',
    roadmapLabel: 'Roadmap',
  },
} as const;

export default definePage(PageContributing, {
  head({ locale }) {
    const resolved = contentLocale(locale ?? 'en');
    const copy = content[resolved];
    return siteHead({
      route: '/contributing',
      locale: resolved,
      title: copy.headTitle,
      description: copy.headDescription,
    });
  },
  props({ locale }) {
    const resolved = contentLocale(locale ?? 'en');
    const text = content[resolved];
    return {
      ...text,
      // The setup code block is pre-highlighted by the shared site highlighter
      // (lib/markdown.ts via generate:content) — never a JSX copy.
      setupCodeHtml: trustedHtml(contributingSetupCodeHtml),
      discussionsHref: 'https://github.com/open-element/openelement/discussions',
      issuesHref: 'https://github.com/open-element/openelement/issues',
      changelogHref: localizePath('/changelog', resolved),
      roadmapHref: localizePath('/roadmap', resolved),
    };
  },
});
