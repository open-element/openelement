/**
 * Contributing Page - v4 lab page: mono/serif masthead, setup terminal,
 * PR checklist, numbered help rows, and a questions-first callout.
 */
import { definePage } from '@openelement/app';
import { siteHead } from '@openelement/site-ui/head.ts';
import { contentLocale } from '@openelement/site-ui/locale.ts';
import { localizePath } from '@openelement/site-ui/link.ts';
import PageContributing from '../components/page-contributing.tsx';

export const meta = { section: '', label: 'Contributing', order: 30 };

const content = {
  en: {
    headTitle: 'Contributing',
    headDescription:
      'A precise, Deno-first contributor workflow for the openElement Web Standards Lab: setup, PR checklist and where to help.',
    eyebrow: 'Contributing — Join the lab',
    monoLine: 'BUILD IT',
    serifLine: 'with us.',
    lede: 'A precise, Deno-first contributor workflow for the Web Standards Lab.',
    setupAriaLabel: 'Development setup',
    setupLabel: '§1 — Setup',
    setupCopyBefore:
      'openElement core CLI, SSG, serverless API, tests, publishing, and docs site tasks all use Deno 2.8+ as the default runtime. Vite runs via ',
    setupCopyVite: 'deno run -A npm:vite',
    setupCopyBetween: ' — no ',
    setupCopyNpm: 'npm',
    setupCopyAnd: ' or ',
    setupCopyNpx: 'npx',
    setupCopyAfter: ' needed for the main workflow.',
    releaseLabel: 'Release line',
    releaseItems: [
      {
        id: 'versions',
        before: 'Update version numbers (',
        code1: 'packages/*/deno.json',
        middle1: ')',
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
        code1: 'deno task test',
        middle1: '',
        code2: '',
        middle2: '',
        code3: '',
        after: '',
      },
      {
        id: 'publish',
        before: 'Publish via ',
        code1: 'deno task publish:jsr',
        middle1: ', ',
        code2: 'deno task publish:npm',
        middle2: ', ',
        code3: 'deno task pack:dry-run',
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
        text: 'deno fmt + deno lint stay clean',
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
        text: 'Gates green locally — deno task test before push',
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
        copy:
          'Lit / FAST / Stencil components that render through our DSD smoke pipeline, with evidence.',
      },
      {
        id: 'dogfood',
        index: '02',
        title: 'Dogfood something real',
        copy:
          'Build an application on the stable line and file what breaks. That is the pilot now.',
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
      '面向 openElement Web Standards Lab 的精确、Deno 优先的贡献者工作流：环境设置、PR 清单与入手方向。',
    eyebrow: '贡献 — 加入实验室',
    monoLine: 'BUILD IT',
    serifLine: '与我们一起。',
    lede: '面向 Web Standards Lab 的精确、Deno 优先的贡献者工作流。',
    setupAriaLabel: '开发环境设置',
    setupLabel: '§1 — 环境设置',
    setupCopyBefore:
      'openElement 核心 CLI、SSG、serverless API、测试、发布与文档站任务都以 Deno 2.8+ 作为默认运行时。Vite 通过 ',
    setupCopyVite: 'deno run -A npm:vite',
    setupCopyBetween: ' 运行——主工作流不需要 ',
    setupCopyNpm: 'npm',
    setupCopyAnd: ' 或 ',
    setupCopyNpx: 'npx',
    setupCopyAfter: '。',
    releaseLabel: '发布线',
    releaseItems: [
      {
        id: 'versions',
        before: '更新版本号（',
        code1: 'packages/*/deno.json',
        middle1: '）',
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
        code1: 'deno task test',
        middle1: '',
        code2: '',
        middle2: '',
        code3: '',
        after: '',
      },
      {
        id: 'publish',
        before: '通过 ',
        code1: 'deno task publish:jsr',
        middle1: '、',
        code2: 'deno task publish:npm',
        middle2: '、',
        code3: 'deno task pack:dry-run',
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
        text: 'deno fmt + deno lint 保持干净',
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
        text: '本地门禁全绿——推送前先跑 deno task test',
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
      discussionsHref: 'https://github.com/open-element/openelement/discussions',
      issuesHref: 'https://github.com/open-element/openelement/issues',
      changelogHref: localizePath('/changelog', resolved),
      roadmapHref: localizePath('/roadmap', resolved),
    };
  },
});
