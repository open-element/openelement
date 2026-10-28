import { definePage } from '@openelement/router';
import { siteHead } from '#site-ui/head.ts';
import { contentLocale } from '#site-ui/locale.ts';
import { localizePath } from '#site-ui/link.ts';
import { packageCountModifier, sourceLineStamp } from '../../data/version.ts';
import { quickstartCommandCountPhrase } from '../../data/quickstart.ts';

// The hub is the manual's first entry: it opens the guide section the rest of
// /guide/* fills, so the sidebar tree and the URL tree name the same family.
export const meta = { section: 'Guide', label: 'Docs', order: 0 };

// Package-count phrases derive from release-state truth (data/version.ts), so
// the hub copy moves with the surface and no hand-written numeral can go stale.
const countEn = packageCountModifier('en');
const countZh = packageCountModifier('zh');

// The Get-started entrance advertises how long the quickstart is. That count is
// a claim about getting-started's own Install fence, so it derives from the
// sequence (data/quickstart.ts) — the hub said 3 while the fence listed 4, and
// core-concepts repeated the stale number in both locales.
const quickstartEn = quickstartCommandCountPhrase('en');
const quickstartZh = quickstartCommandCountPhrase('zh');

// Where the example cards point: the exact repository file (or fixture tree)
// that implements the scenario. These are real, current sources — no invented
// demo links and no hosted preview exists to link to.
const REPO = 'https://github.com/open-element/openelement';

const content = {
  en: {
    headTitle: 'Documentation',
    headDescription: `openElement documentation: guides, architecture notes and the supported public surface of the ${countEn} consumer set.`,
    sidenote: 'Docs index',
    eyebrow: 'Docs — The manual',
    serifLine: 'Read the',
    monoLine: 'MANUAL.',
    lede: 'Five entrances cover the whole manual.',
    navLabel: 'Documentation entrances',
    examplesTitle: 'Examples',
    examplesKicker: '4 scenarios · no hosted preview',
    examplesLabel: 'Example scenarios',
    examplesLede:
      'Four scenarios, each tied to the repository file that implements it and the command that builds it. These are honest, local examples: the repository has no hosted demo app, so no card pretends to be one.',
    examplesNote:
      'Every card is reproducible from a fresh checkout at the source line shown above. The run steps are the fixture’s own package scripts, not invented commands; request-time scenarios need a Node server, the static scenario does not.',
    examplesPrepare:
      'Prepare once, from the repository root: clone https://github.com/open-element/openelement and install the workspace (pnpm install). Then run each card’s command from that same root — these are repository fixtures, not commands for an already-created app.',
    fieldSource: 'Source',
    fieldRun: 'Run (repo root)',
    fieldDoc: 'Related doc',
    fieldLimits: 'Limits',
    examples: [
      {
        index: '01',
        title: 'Static-first page',
        useCase:
          'A content or marketing page that ships complete HTML and needs no client JavaScript: docs pages, landing pages, article routes.',
        sourceLabel: 'router-static-only fixture',
        sourceHref: `${REPO}/tree/main/tests/fixtures/router-static-only`,
        sourceFile: 'app/routes/index.tsx',
        run: 'pnpm --dir tests/fixtures/router-static-only run build',
        docLabel: 'Getting started',
        docHref: '/guide/getting-started',
        limits:
          'Fixture only — no hosted preview. The build lands in the fixture’s gitignored dist/; the fixture consumes workspace sources, so it proves this checkout, not an npm release.',
      },
      {
        index: '02',
        title: 'Reusable Custom Element',
        useCase:
          'A component reused across pages: a standard Custom Element authored as compiled TSX with @element / @property, optionally shadow-rooted as DSD.',
        sourceLabel: 'create starter · my-counter',
        sourceHref: `${REPO}/blob/main/packages/create/templates/app/islands/my-counter.tsx.tmpl`,
        sourceFile: 'packages/create/templates/app/islands/my-counter.tsx.tmpl',
        run: 'npm create @openelement my-app  # then: npm run dev',
        docLabel: 'Core concepts',
        docHref: '/guide/core-concepts',
        limits:
          'The starter counter is a demo, not a data contract; the file ships as a .tmpl and is written by the generator. No hosted preview — the quickstart is the run path.',
      },
      {
        index: '03',
        title: 'SSR + island',
        useCase:
          'A server-rendered page that activates one interactive region: a notes app whose counter island hydrates on a request-time page.',
        sourceLabel: 'router-native-framework · note-counter',
        sourceHref: `${REPO}/blob/main/tests/fixtures/router-native-framework/app/islands/note-counter.tsx`,
        sourceFile: 'app/islands/note-counter.tsx',
        run: 'pnpm --dir tests/fixtures/router-native-framework run build',
        docLabel: 'Islands and SSR',
        docHref: '/guide/islands-and-ssr',
        limits:
          'Fixture only — no hosted preview. Request-time pages need a Node server: the fixture’s e2e harness serves the built app, and workspace sources (not a published package) are what get proven.',
      },
      {
        index: '04',
        title: 'Form + routing',
        useCase:
          'A form that keeps validation and routing server-owned: native POST plus redirect, with optional client-side enhancement.',
        sourceLabel: 'router-request-time · page-form',
        sourceHref: `${REPO}/blob/main/tests/fixtures/router-request-time/app/components/page-form.tsx`,
        sourceFile: 'app/components/page-form.tsx',
        run: 'pnpm --dir tests/fixtures/router-request-time run build',
        docLabel: 'Form actions end to end',
        docHref: '/guide/recipe-form-actions',
        limits:
          'Request-time server required — this is not a static-hosting example. Fixture only, no hosted preview; the recipe page walks the same mechanics step by step.',
      },
    ],
  },
  zh: {
    headTitle: '文档',
    headDescription: `openElement 文档：指南、架构说明，以及${countZh}消费面的受支持公开接口。`,
    sidenote: '文档索引',
    eyebrow: '手册',
    serifLine: '通读',
    monoLine: '手册。',
    lede: '五个入口覆盖全部手册。',
    navLabel: '文档入口',
    examplesTitle: '示例',
    examplesKicker: '4 个场景 · 无托管预览',
    examplesLabel: '示例场景',
    examplesLede:
      '四个场景，每张卡片都绑定实现它的仓库文件与构建它的命令。它们是诚实的本地示例：仓库没有托管演示站，因此没有卡片把自己伪装成在线 demo。',
    examplesNote:
      '每张卡片都可以从全新检出按上方所示源码线复现。运行步骤取自各 fixture 自己的 package script，不是编造的命令；请求时场景需要 Node 服务端，静态场景不需要。',
    examplesPrepare:
      '先在仓库根目录准备一次：克隆 https://github.com/open-element/openelement 并安装工作区（pnpm install）。之后在同一个根目录执行每张卡片的命令——这些是仓库 fixture，不是已创建应用里的命令。',
    fieldSource: '源码',
    fieldRun: '运行（仓库根目录）',
    fieldDoc: '相关文档',
    fieldLimits: '限制',
    examples: [
      {
        index: '01',
        title: '静态优先页面',
        useCase:
          '输出完整 HTML、不需要客户端 JavaScript 的内容页或营销页：文档页、落地页、文章路由。',
        sourceLabel: 'router-static-only fixture',
        sourceHref: `${REPO}/tree/main/tests/fixtures/router-static-only`,
        sourceFile: 'app/routes/index.tsx',
        run: 'pnpm --dir tests/fixtures/router-static-only run build',
        docLabel: '快速开始',
        docHref: '/guide/getting-started',
        limits:
          '仅仓库示例——无托管预览。构建产物落在 fixture 的 gitignored dist/；fixture 直接消费 workspace 源码，证明的是当前检出而非 npm 发布版。',
      },
      {
        index: '02',
        title: '可复用 Custom Element',
        useCase:
          '跨页面复用的组件：以编译型 TSX 编写、带 @element / @property 的标准 Custom Element，可按需使用 DSD 影子根。',
        sourceLabel: 'create 起手模板 · my-counter',
        sourceHref: `${REPO}/blob/main/packages/create/templates/app/islands/my-counter.tsx.tmpl`,
        sourceFile: 'packages/create/templates/app/islands/my-counter.tsx.tmpl',
        run: 'npm create @openelement my-app  # 然后运行 npm run dev',
        docLabel: '核心概念',
        docHref: '/guide/core-concepts',
        limits:
          '起手计数器只是 demo，不是数据契约；该文件以 .tmpl 形式发布，由生成器写出。无托管预览——快速开始就是运行路径。',
      },
      {
        index: '03',
        title: 'SSR + island',
        useCase: '服务端渲染页面只激活一个交互区域：笔记应用中的计数器 island 在请求时页面上水合。',
        sourceLabel: 'router-native-framework · note-counter',
        sourceHref: `${REPO}/blob/main/tests/fixtures/router-native-framework/app/islands/note-counter.tsx`,
        sourceFile: 'app/islands/note-counter.tsx',
        run: 'pnpm --dir tests/fixtures/router-native-framework run build',
        docLabel: 'Islands 与 SSR',
        docHref: '/guide/islands-and-ssr',
        limits:
          '仅仓库示例——无托管预览。请求时页面需要 Node 服务端：fixture 的 e2e harness 会服务构建产物，证明的是 workspace 源码而非已发布包。',
      },
      {
        index: '04',
        title: '表单 + 路由',
        useCase: '把校验与路由留在服务端的表单：原生 POST 加重定向，可选客户端增强。',
        sourceLabel: 'router-request-time · page-form',
        sourceHref: `${REPO}/blob/main/tests/fixtures/router-request-time/app/components/page-form.tsx`,
        sourceFile: 'app/components/page-form.tsx',
        run: 'pnpm --dir tests/fixtures/router-request-time run build',
        docLabel: '端到端表单 action',
        docHref: '/guide/recipe-form-actions',
        limits:
          '需要请求时服务端——这不是静态托管示例。仅仓库示例、无托管预览；配方文档逐步讲解同一套机制。',
      },
    ],
  },
} as const;

const entrances = {
  en: [
    ['Get started', `Zero to a running application in ${quickstartEn}.`, '/guide/getting-started'],
    ['Tutorial', 'Build a page, an island and a form action, step by step.', '/guide/tutorial'],
    ['API reference', `The ${countEn} surface, export by export.`, '/reference'],
    ['Architecture', 'Who owns what, and why the boundaries hold.', '/architecture'],
    ['Roadmap', 'Where the stable line goes next.', '/roadmap'],
  ],
  zh: [
    ['快速开始', `${quickstartZh}，从零到可运行的应用。`, '/guide/getting-started'],
    ['教程', '逐步构建一个页面、一个 island 与一个表单 action。', '/guide/tutorial'],
    ['API 参考', `${countZh}接口面，逐个 export 列出。`, '/reference'],
    ['架构', '谁负责什么，以及边界为何成立。', '/architecture'],
    ['路线图', 'stable 线的下一步走向。', '/roadmap'],
  ],
} as const;

/**
 * The docs hub as a server function page (alpha15 server architecture): the
 * route module's own exported TSX function, lowered by the compiler into a
 * generative HTML constructor. The page hook class (`page-docs`) scopes the
 * former component sheet's authored rules (www/site-chrome.css).
 */
export function PageDocs(props: {
  sidenote: string;
  eyebrow: string;
  serifLine: string;
  monoLine: string;
  lede: string;
  navLabel: string;
  version: string;
  entrances: Array<{ index: string; title: string; copy: string; href: string }>;
  examplesTitle: string;
  examplesKicker: string;
  examplesLabel: string;
  examplesLede: string;
  examplesNote: string;
  examplesPrepare: string;
  fieldSource: string;
  fieldRun: string;
  fieldDoc: string;
  fieldLimits: string;
  examples: Array<{
    index: string;
    title: string;
    useCase: string;
    sourceLabel: string;
    sourceHref: string;
    sourceFile: string;
    run: string;
    docLabel: string;
    docHref: string;
    limits: string;
    fieldSource: string;
    fieldRun: string;
    fieldDoc: string;
    fieldLimits: string;
  }>;
}) {
  return (
    <div class='page-docs bg-background text-foreground' data-pagefind-body>
      <header class='masthead relative isolate px-[clamp(1.5rem,5vw,4.5rem)] pt-[clamp(4rem,11vh,8rem)] pb-[clamp(2.5rem,6vh,4.5rem)]'>
        <span
          class='absolute right-[clamp(0.5rem,1.5vw,1.5rem)] bottom-[clamp(1rem,4vh,2.5rem)] hidden font-mono text-(length:--font-size-micro) tracking-[0.2em] text-muted-foreground uppercase select-none [writing-mode:vertical-rl] min-[721px]:block'
          aria-hidden='true'
        >
          {props.sidenote}
        </span>
        <div class='flex items-baseline justify-between gap-4'>
          <p class='eyebrow m-0 flex items-center gap-3 font-mono text-(length:--text-xs) font-extrabold tracking-[0.29em] text-primary uppercase [&:lang(zh)]:normal-case [&:lang(zh)]:tracking-[0.08em]'>
            {props.eyebrow}
          </p>
          <span class='font-mono text-(length:--text-xs) tracking-[0.08em] text-muted-foreground uppercase'>
            {props.version}
          </span>
        </div>
        <h1 class='mt-[clamp(1.5rem,4vh,3rem)] mb-0 leading-[0.92]'>
          <span class='block font-serif text-[length:clamp(3.4rem,9vw,8rem)] font-normal tracking-[-0.02em] text-primary italic'>
            {props.serifLine}
          </span>{' '}
          <span class='block font-mono text-[length:clamp(3rem,8vw,7rem)] font-extrabold tracking-[-0.05em] text-foreground'>
            {props.monoLine}
          </span>
        </h1>
        <p class='mt-[clamp(1.25rem,3vh,2rem)] mb-0 max-w-[34rem] font-mono text-[length:clamp(1rem,1.2vw,1.1rem)] leading-[1.75] text-muted-foreground'>
          {props.lede}
        </p>
      </header>
      <nav class='grid border-t border-border' aria-label={props.navLabel}>
        {props.entrances.map((entrance) => (
          <a
            class='group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-[clamp(1rem,4vw,4rem)] border-b border-border px-[clamp(1.5rem,5vw,4.5rem)] py-[clamp(1.25rem,3.5vh,2.5rem)] text-inherit no-underline transition-[background] duration-150 ease-[ease] hover:bg-[linear-gradient(90deg,color-mix(in_srgb,var(--color-primary)_8%,transparent),transparent)] min-[721px]:grid-cols-[minmax(5rem,0.16fr)_minmax(0,1fr)_auto]'
            key={entrance.href}
            href={entrance.href}
          >
            <span
              class='hidden font-mono text-[length:clamp(3rem,7vw,6rem)] font-extrabold leading-none text-transparent transition-[-webkit-text-stroke-color] duration-150 ease-[ease] [-webkit-text-stroke:1.5px_color-mix(in_srgb,var(--color-ring)_55%,transparent)] group-hover:[-webkit-text-stroke-color:var(--color-primary)] min-[721px]:block'
              aria-hidden='true'
            >
              {entrance.index}
            </span>
            <div>
              <span class='block font-mono text-[length:clamp(1.5rem,2.8vw,2.4rem)] font-extrabold leading-[1.05] tracking-[-0.02em] text-foreground transition-[color] duration-150 ease-[ease] group-hover:text-primary'>
                {entrance.title}
              </span>
              <p class='mt-2 mb-0 font-mono text-(length:--text-xs) leading-[1.6] text-muted-foreground'>
                {entrance.copy}
              </p>
            </div>
            <span
              class='font-mono text-(length:--text-5xl) text-ring transition-[transform,color] duration-150 ease-[ease] group-hover:translate-x-2 group-hover:text-primary'
              aria-hidden='true'
            >
              →
            </span>
          </a>
        ))}
      </nav>
      {/*
        WEB-201 (P2): an honest Examples entry. Four scenarios, each bound to a
        REAL repository source and the command that builds it. There is no
        hosted demo app, so no card may simulate one — the section says that
        explicitly and every link is a repository/route link that exists today.
      */}
      <section
        class='border-t border-border px-[clamp(1.5rem,5vw,4.5rem)] py-[clamp(2.5rem,6vh,4.5rem)]'
        aria-label={props.examplesLabel}
      >
        <div class='flex flex-wrap items-baseline justify-between gap-3'>
          <h2 class='m-0 font-mono text-[length:clamp(1.6rem,3.2vw,2.4rem)] font-extrabold tracking-[-0.02em] text-foreground'>
            {props.examplesTitle}
          </h2>
          <span class='font-mono text-(length:--font-size-micro) tracking-[0.14em] text-muted-foreground uppercase'>
            {props.examplesKicker}
          </span>
        </div>
        <p class='mt-3 mb-0 max-w-[46rem] font-mono text-(length:--text-sm) leading-[1.7] text-muted-foreground'>
          {props.examplesLede}
        </p>
        <p class='mt-3 mb-0 max-w-[46rem] font-mono text-(length:--text-xs) leading-[1.6] text-muted-foreground'>
          {props.examplesPrepare}
        </p>
        <ol class='mt-[clamp(1.5rem,4vh,2.5rem)] grid list-none grid-cols-1 gap-4 p-0 min-[901px]:grid-cols-2'>
          {props.examples.map((example) => (
            <li
              class='flex min-w-0 flex-col rounded-xl border border-border bg-popover/58 p-[clamp(1rem,2.5vw,1.5rem)]'
              key={example.index}
            >
              <h3 class='m-0 flex items-baseline gap-3 font-mono text-(length:--text-xs) font-extrabold tracking-[0.24em] text-primary uppercase [&:lang(zh)]:normal-case [&:lang(zh)]:tracking-[0.08em]'>
                <span
                  class='font-mono text-(length:--text-base) tracking-normal'
                  aria-hidden='true'
                >
                  {example.index}
                </span>
                <span>{example.title}</span>
              </h3>
              <p class='mt-3 mb-0 text-(length:--text-sm) leading-[1.7] text-foreground'>
                {example.useCase}
              </p>
              <dl class='mt-4 mb-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 font-mono text-(length:--text-xs) leading-[1.6]'>
                <dt class='text-muted-foreground uppercase tracking-[0.08em]'>
                  {example.fieldSource}
                </dt>
                <dd class='m-0 min-w-0 [overflow-wrap:anywhere]'>
                  <a
                    class='text-primary no-underline hover:underline'
                    href={example.sourceHref}
                    target='_blank'
                    rel='noopener noreferrer'
                  >
                    {example.sourceLabel}
                  </a>
                  <span class='block text-muted-foreground'>{example.sourceFile}</span>
                </dd>
                <dt class='text-muted-foreground uppercase tracking-[0.08em]'>
                  {example.fieldRun}
                </dt>
                <dd class='m-0 min-w-0 [overflow-wrap:anywhere]'>
                  <code class='block rounded-md bg-muted px-2 py-1 text-foreground'>
                    {example.run}
                  </code>
                </dd>
                <dt class='text-muted-foreground uppercase tracking-[0.08em]'>
                  {example.fieldDoc}
                </dt>
                <dd class='m-0 min-w-0'>
                  <a class='text-primary no-underline hover:underline' href={example.docHref}>
                    {example.docLabel}
                  </a>
                </dd>
                <dt class='text-muted-foreground uppercase tracking-[0.08em]'>
                  {example.fieldLimits}
                </dt>
                <dd class='m-0 min-w-0 text-muted-foreground'>{example.limits}</dd>
              </dl>
            </li>
          ))}
        </ol>
        <p class='mt-4 mb-0 max-w-[46rem] font-mono text-(length:--text-xs) leading-[1.7] text-muted-foreground'>
          {props.examplesNote}
        </p>
      </section>
    </div>
  );
}

export default definePage(PageDocs, {
  head({ locale }) {
    const resolved = contentLocale(locale ?? 'en');
    const copy = content[resolved];
    return siteHead({
      route: '/docs',
      locale: resolved,
      title: copy.headTitle,
      description: copy.headDescription,
    });
  },
  props({ locale }) {
    const resolved = contentLocale(locale ?? 'en');
    const {
      headTitle: _headTitle,
      headDescription: _headDescription,
      examples,
      ...text
    } = content[resolved];
    const items = entrances[resolved];
    return {
      ...text,
      // Derived from release-state truth: "repository baseline" until the
      // source line ships to @alpha, then the plain version (data/version.ts).
      version: sourceLineStamp(resolved),
      entrances: items.map(([title, copy, href], position) => ({
        index: String(position + 1).padStart(2, '0'),
        title,
        copy,
        href: localizePath(href, resolved),
      })),
      // The Examples cards keep their repository links absolute (they leave the
      // site) and localize only the related in-site doc route.
      examples: examples.map((example) => ({
        ...example,
        docHref: localizePath(example.docHref, resolved),
        // Each-item children in the compiled grammar must be {item.<field>}
        // (OEC9013), so the localized field labels ride on every card rather
        // than being read from props.* inside the mapped item.
        fieldSource: text.fieldSource,
        fieldRun: text.fieldRun,
        fieldDoc: text.fieldDoc,
        fieldLimits: text.fieldLimits,
      })),
    };
  },
});
