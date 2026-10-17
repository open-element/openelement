/**
 * Contributing Page - v4 lab page: mono/serif masthead, setup terminal,
 * PR checklist, numbered help rows, and a questions-first callout.
 */
import { definePage } from '@openelement/router';
import { trustedHtml, type TrustedHtml } from '@openelement/element';
import '@openelement/ui/open-code-block';
import '@openelement/ui/open-button';
import '#site-ui/open-reading-shell.tsx';
import '#site-ui/open-artifact-panel.tsx';
import '../islands/open-page-rail.tsx';
import { siteHead } from '#site-ui/head.ts';
import { contentLocale } from '#site-ui/locale.ts';
import { localizePath } from '#site-ui/link.ts';
import { contributingSetupCodeHtml } from '../data/_generated-page-code.ts';

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

/**
 * The contributing page as a server function page (alpha15 server
 * architecture): the route module's own exported TSX function, lowered by the
 * compiler into a generative HTML constructor. The page hook class
 * (`page-contributing`) scopes the former component sheet's authored rules in
 * the linked document stylesheet (www/site-chrome.css); the retired sheet's
 * shadow-only rules (`:host` box/ink, the universal box-sizing basis) retire
 * with the shadow root — the page is light DOM now and the document preflight
 * reaches it.
 *
 * Two class-list facts the compiler imposes here:
 *   - every class string is a static literal (the candidate scanner reads the
 *     `class` attribute only; no interpolation, no helper);
 *   - the checklist chip's class is the route's data-driven `checkboxClass`
 *     ('checkbox' / 'checkbox open'), and a list item's class attribute admits
 *     only a static literal or that single value — so the chip's box is
 *     authored on its list item with `[&>.checkbox…]` child-selector
 *     utilities.
 */
export function PageContributing(props: {
  eyebrow: string;
  monoLine: string;
  serifLine: string;
  lede: string;
  setupAriaLabel: string;
  setupCodeHtml: TrustedHtml;
  setupLabel: string;
  setupCopyBefore: string;
  setupCopyVite: string;
  setupCopyBetween: string;
  setupCopyNpm: string;
  setupCopyAnd: string;
  setupCopyNpx: string;
  setupCopyAfter: string;
  releaseLabel: string;
  releaseItems: Array<{
    id: string;
    before: string;
    code1: string;
    middle1: string;
    code2: string;
    middle2: string;
    code3: string;
    after: string;
  }>;
  beforePrLabel: string;
  checklist: Array<{ id: string; checkboxClass: string; mark: string; text: string }>;
  layeringCopy: string;
  helpLabel: string;
  helpRows: Array<{ id: string; index: string; title: string; copy: string }>;
  calloutLabel: string;
  calloutIntro: string;
  discussionsLabel: string;
  discussionsHref: string;
  calloutBetween: string;
  issuesLabel: string;
  issuesHref: string;
  calloutAfter: string;
  changelogLabel: string;
  changelogHref: string;
  roadmapLabel: string;
  roadmapHref: string;
}) {
  return (
    <div class='page-contributing' data-pagefind-body>
      <header class='masthead relative isolate px-[clamp(1.5rem,5vw,4.5rem)] pt-[clamp(4rem,11vh,8rem)] pb-[clamp(2.5rem,6vh,4.5rem)]'>
        <p class='eyebrow my-0 flex items-center gap-3 text-primary font-mono text-(length:--text-xs) font-extrabold tracking-[0.29em] uppercase [&:lang(zh)]:normal-case [&:lang(zh)]:tracking-[0.08em]'>
          {props.eyebrow}
        </p>
        <h1 class='mt-[clamp(1.5rem,4vh,3rem)] mb-0 leading-[0.92]'>
          <span class='block font-mono text-[clamp(3rem,8vw,7rem)] font-[800] tracking-[-0.05em] text-foreground'>
            {props.monoLine}
          </span>{' '}
          <span class='block font-serif text-[clamp(3.4rem,9vw,8rem)] font-normal italic tracking-[-0.02em] text-primary'>
            {props.serifLine}
          </span>
        </h1>
        <p class='mt-[clamp(1.25rem,3vh,2rem)] mb-0 max-w-[38rem] text-muted-foreground text-[clamp(1rem,1.2vw,1.1rem)] leading-[1.75]'>
          {props.lede}
        </p>
      </header>

      <section
        class='grid grid-cols-1 gap-[clamp(2rem,6vw,6rem)] border-t border-border px-[clamp(1.5rem,5vw,4.5rem)] py-[clamp(2.5rem,6vh,4.5rem)] min-[901px]:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]'
        aria-label={props.setupAriaLabel}
      >
        <div class='grid grid-cols-[minmax(0,1fr)] content-start gap-4'>
          <p class='my-0 text-primary font-mono text-(length:--text-xs) font-extrabold tracking-[0.24em] uppercase'>
            {props.setupLabel}
          </p>
          <open-code-block>
            <div innerHTML={props.setupCodeHtml} trustedHtml />
          </open-code-block>
          <p class='my-0 text-muted-foreground text-(length:--text-sm) leading-[1.75]'>
            {props.setupCopyBefore}
            <span class='rounded-md border-[0.5px] border-border bg-muted px-[0.375rem] py-[0.125rem] font-mono text-(length:--text-xs)'>
              {props.setupCopyVite}
            </span>
            {props.setupCopyBetween}
            <span class='rounded-md border-[0.5px] border-border bg-muted px-[0.375rem] py-[0.125rem] font-mono text-(length:--text-xs)'>
              {props.setupCopyNpm}
            </span>
            {props.setupCopyAnd}
            <span class='rounded-md border-[0.5px] border-border bg-muted px-[0.375rem] py-[0.125rem] font-mono text-(length:--text-xs)'>
              {props.setupCopyNpx}
            </span>
            {props.setupCopyAfter}
          </p>
          <p class='my-0 text-primary font-mono text-(length:--text-xs) font-extrabold tracking-[0.24em] uppercase'>
            {props.releaseLabel}
          </p>
          <ol class='release my-0 grid list-none gap-2 p-0 [counter-reset:release] text-muted-foreground font-mono text-(length:--text-xs) leading-[1.7]'>
            {props.releaseItems.map((item) => (
              <li class='grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-3' key={item.id}>
                <span>
                  {item.before}
                  <span class='empty:hidden rounded-md border-[0.5px] border-border bg-muted px-[0.375rem] py-[0.125rem] text-(length:--font-size-micro)'>
                    {item.code1}
                  </span>
                  {item.middle1}
                  <span class='empty:hidden rounded-md border-[0.5px] border-border bg-muted px-[0.375rem] py-[0.125rem] text-(length:--font-size-micro)'>
                    {item.code2}
                  </span>
                  {item.middle2}
                  <span class='empty:hidden rounded-md border-[0.5px] border-border bg-muted px-[0.375rem] py-[0.125rem] text-(length:--font-size-micro)'>
                    {item.code3}
                  </span>
                  {item.after}
                </span>
              </li>
            ))}
          </ol>
        </div>

        <div class='grid grid-cols-[minmax(0,1fr)] content-start gap-4'>
          <p class='my-0 text-primary font-mono text-(length:--text-xs) font-extrabold tracking-[0.24em] uppercase'>
            {props.beforePrLabel}
          </p>
          <ul class='checklist my-0 grid list-none gap-4 p-0'>
            {props.checklist.map((item) => (
              <li
                class='grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 text-muted-foreground font-mono text-(length:--text-sm) leading-[1.6] [&>.checkbox]:inline-grid [&>.checkbox]:size-5 [&>.checkbox]:place-items-center [&>.checkbox]:rounded-md [&>.checkbox]:bg-primary [&>.checkbox]:text-(length:--text-xs) [&>.checkbox]:font-extrabold [&>.checkbox]:text-primary-foreground [&>.checkbox.open]:border-[1.5px] [&>.checkbox.open]:border-[color-mix(in_srgb,var(--color-ring)_55%,transparent)] [&>.checkbox.open]:bg-transparent'
                key={item.id}
              >
                <span class={item.checkboxClass} aria-hidden='true'>
                  {item.mark}
                </span>
                <span>{item.text}</span>
              </li>
            ))}
          </ul>
          <p class='my-0 text-muted-foreground text-(length:--text-sm) leading-[1.75]'>
            {props.layeringCopy}
          </p>
        </div>
      </section>

      <section class='grid border-t border-border' aria-label={props.helpLabel}>
        <p class='my-0 px-[clamp(1.5rem,5vw,4.5rem)] pt-[clamp(2rem,5vh,3.5rem)] pb-4 text-primary font-mono text-(length:--text-xs) font-extrabold tracking-[0.24em] uppercase'>
          {props.helpLabel}
        </p>
        {props.helpRows.map((item) => (
          <div
            class='help-row grid grid-cols-[minmax(0,1fr)] items-center gap-2 border-t border-border px-[clamp(1.5rem,5vw,4.5rem)] py-[clamp(1.25rem,3vh,2rem)] min-[901px]:grid-cols-[minmax(4rem,0.14fr)_minmax(0,0.9fr)_minmax(0,1.1fr)] min-[901px]:gap-[clamp(1rem,4vw,4rem)]'
            key={item.id}
          >
            <span
              class='font-mono text-[clamp(2.2rem,4.5vw,3.4rem)] font-[800] leading-none text-transparent [-webkit-text-stroke:1.5px_color-mix(in_srgb,var(--color-ring)_55%,transparent)]'
              aria-hidden='true'
            >
              {item.index}
            </span>
            <span class='font-mono text-(length:--text-xl) font-[800] tracking-[-0.01em] text-foreground'>
              {item.title}
            </span>
            <p class='my-0 text-muted-foreground font-mono text-(length:--text-xs) leading-[1.7]'>
              {item.copy}
            </p>
          </div>
        ))}
      </section>

      <aside class='my-[clamp(2.5rem,6vh,4.5rem)] mx-[clamp(1.5rem,5vw,4.5rem)] rounded-lg border border-[color-mix(in_srgb,var(--color-ring)_40%,transparent)] border-s-4 border-s-primary bg-[color-mix(in_srgb,var(--color-secondary)_30%,var(--color-popover))] px-6 py-5'>
        <p class='mt-3 mb-0 text-muted-foreground font-mono text-(length:--text-sm) leading-[1.75] font-extrabold tracking-[0.16em] uppercase'>
          {props.calloutLabel}
        </p>
        <p class='mt-3 mb-0 text-muted-foreground font-mono text-(length:--text-sm) leading-[1.75]'>
          <span>{props.calloutIntro}</span>
          <a class='text-primary no-underline hover:underline' href={props.discussionsHref}>
            {props.discussionsLabel}
          </a>
          <span>{props.calloutBetween}</span>
          <a class='text-primary no-underline hover:underline' href={props.issuesHref}>
            {props.issuesLabel}
          </a>
          <span>{props.calloutAfter}</span>
        </p>
      </aside>

      <div class='flex flex-wrap gap-3 px-[clamp(1.5rem,5vw,4.5rem)] pt-0 pb-[clamp(3rem,8vh,6rem)]'>
        <open-button variant='ghost' size='sm' href={props.changelogHref}>
          {props.changelogLabel}
        </open-button>
        <open-button variant='ghost' size='sm' href={props.roadmapHref}>
          {props.roadmapLabel}
        </open-button>
      </div>
    </div>
  );
}

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
