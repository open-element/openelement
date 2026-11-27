import { definePage } from '@openelement/router';
import { siteHead } from '#site-ui/head.ts';
import { contentLocale } from '#site-ui/locale.ts';
import { siteHref } from '#site-ui/site-url.ts';
import { navSections } from '../../data/_generated-nav-data.ts';
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
const pathIds = ['learn', 'guides', 'reference', 'project'] as const;

const content = {
  en: {
    headTitle: 'Documentation',
    headDescription: `openElement documentation: guides, architecture notes and the supported public surface of the ${countEn} consumer set.`,
    lede: 'Build your first application, learn how it renders, or look up a supported API.',
    navLabel: 'Documentation sections',
    jumpLabel: 'On this page',
    statusLabel: 'Release status',
    startTitle: 'Start here',
    startSteps: [
      {
        index: '1.',
        title: 'Getting started',
        copy: `Create and run your first application in ${quickstartEn}.`,
        href: '/guide/getting-started',
      },
      {
        index: '2.',
        title: 'Tutorial',
        copy: 'Build a page, an island and a form action.',
        href: '/guide/tutorial',
      },
      {
        index: '3.',
        title: 'Core concepts',
        copy: 'Learn the component and rendering model.',
        href: '/guide/core-concepts',
      },
    ],
    paths: [
      {
        copy: 'See what the server renders and which regions hydrate in the browser.',
        action: 'Read about hydration',
        href: '/guide/islands-and-ssr#hydration-boundary',
      },
      {
        copy: 'Add a native form and handle submissions on the server.',
        action: 'Build a form action',
        href: '/guide/routing-and-data#form-actions',
      },
      {
        copy: 'Check import paths, signatures, and source notes for public exports.',
        action: 'Browse exported symbols',
        href: '/reference#api-reference',
      },
      {
        copy: 'See the current release line and upcoming milestones.',
        action: 'Read the release roadmap',
        href: '/roadmap#release-line',
      },
    ],
    examplesTitle: 'Examples',
    examplesLabel: 'Example scenarios',
    examplesLede:
      'Run these examples locally. Each includes the source and the command to build or start it.',
    examplesPrepare:
      'For the repository examples, clone https://github.com/open-element/openelement, run pnpm install at its root, and run the fixture commands there. For the starter, run its command in the directory where you want to create my-app.',
    fieldSource: 'Source',
    fieldRun: 'Run (repo root)',
    fieldRunStarter: 'Run (new app)',
    fieldDoc: 'Related doc',
    fieldLimits: 'Limits',
    examples: [
      {
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
        title: 'Reusable Custom Element',
        useCase:
          'Reuse a browser-native custom element across pages. The starter counter uses a TSX function component with a shadow root.',
        sourceLabel: 'create starter · my-counter',
        sourceHref: `${REPO}/blob/main/packages/create/templates/app/islands/my-counter.tsx.tmpl`,
        sourceFile: 'packages/create/templates/app/islands/my-counter.tsx.tmpl',
        run: 'npm create @openelement my-app && cd my-app && npm run dev',
        docLabel: 'Core concepts',
        docHref: '/guide/core-concepts',
        limits:
          'The starter counter is a demo, not a data contract; the file ships as a .tmpl and is written by the generator. No hosted preview — the quickstart is the run path.',
      },
      {
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
    lede: '创建你的第一个应用，了解页面如何渲染，或查阅受支持的 API。',
    navLabel: '文档分区',
    jumpLabel: '本页目录',
    statusLabel: '发布状态',
    startTitle: '从这里开始',
    startSteps: [
      {
        index: '1.',
        title: '快速开始',
        copy: `用 ${quickstartZh}创建并运行应用。`,
        href: '/guide/getting-started',
      },
      {
        index: '2.',
        title: '教程',
        copy: '构建页面、island 与表单 action。',
        href: '/guide/tutorial',
      },
      {
        index: '3.',
        title: '核心概念',
        copy: '了解组件与渲染模型。',
        href: '/guide/core-concepts',
      },
    ],
    paths: [
      {
        copy: '了解哪些内容由服务端生成，哪些交互区域在浏览器中激活。',
        action: '了解水合边界',
        href: '/guide/islands-and-ssr#hydration-边界',
      },
      {
        copy: '为页面添加原生表单，在服务端处理提交。',
        action: '实现表单提交',
        href: '/guide/routing-and-data#表单-action',
      },
      {
        copy: '查阅公开导出项的导入路径、签名和源码说明。',
        action: '浏览导出项',
        href: '/reference#api-reference',
      },
      {
        copy: '查看当前发布线和后续里程碑。',
        action: '查看发布路线图',
        href: '/roadmap#release-line',
      },
    ],
    examplesTitle: '示例',
    examplesLabel: '示例场景',
    examplesLede: '这些示例可在本地运行。每项都附有源码和构建或启动命令。',
    examplesPrepare:
      '运行仓库示例前，先克隆 https://github.com/open-element/openelement，在仓库根目录执行 pnpm install，再从同一目录运行各个 fixture 命令。要运行起步模板，请先进入要创建 my-app 的目录，再运行该示例的命令。',
    fieldSource: '源码',
    fieldRun: '运行（仓库根目录）',
    fieldRunStarter: '运行（创建应用）',
    fieldDoc: '相关文档',
    fieldLimits: '限制',
    examples: [
      {
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
        title: '可复用 Custom Element',
        useCase:
          '跨页面复用浏览器原生自定义元素。起步项目的计数器使用 TSX 函数组件和 shadow root。',
        sourceLabel: 'create 起手模板 · my-counter',
        sourceHref: `${REPO}/blob/main/packages/create/templates/app/islands/my-counter.tsx.tmpl`,
        sourceFile: 'packages/create/templates/app/islands/my-counter.tsx.tmpl',
        run: 'npm create @openelement my-app && cd my-app && npm run dev',
        docLabel: '核心概念',
        docHref: '/guide/core-concepts',
        limits:
          '起手计数器只是 demo，不是数据契约；该文件以 .tmpl 形式发布，由生成器写出。无托管预览——快速开始就是运行路径。',
      },
      {
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

/**
 * The docs hub as a server function page (alpha15 server architecture): the
 * route module's own exported TSX function, lowered by the compiler into a
 * generative HTML constructor. The page hook class (`page-docs`) scopes the
 * former component sheet's authored rules (www/site-chrome.css).
 */
export function PageDocs(props: {
  title: string;
  lede: string;
  navLabel: string;
  jumpLabel: string;
  jumpLinks: Array<{ href: string; title: string }>;
  statusLabel: string;
  version: string;
  statusHref: string;
  startTitle: string;
  startSteps: Array<{ index: string; title: string; copy: string; href: string }>;
  paths: Array<{ id: string; title: string; copy: string; action: string; href: string }>;
  examplesTitle: string;
  examplesLabel: string;
  examplesLede: string;
  examplesPrepare: string;
  fieldSource: string;
  fieldRun: string;
  fieldDoc: string;
  fieldLimits: string;
  examples: Array<{
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
      <header class='masthead'>
        <h1 class='m-0 text-[clamp(2.1rem,5vw,3.4rem)] font-semibold tracking-[-0.035em] text-foreground'>
          {props.title}
        </h1>
        <p class='mt-3 mb-0 max-w-[53ch] text-base leading-relaxed text-muted-foreground'>
          {props.lede}
        </p>
        <a
          class='mt-2 inline-flex min-h-8 items-center text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground'
          href={props.statusHref}
        >
          {props.statusLabel} · {props.version}
        </a>
        <nav class='docs-jumps min-[901px]:hidden' aria-label={props.jumpLabel}>
          {props.jumpLinks.map((link) => (
            <a href={link.href} key={link.href}>
              {link.title}
            </a>
          ))}
        </nav>
      </header>
      <section
        class='docs-start border-t border-border py-[clamp(2rem,5vh,3.5rem)]'
        aria-labelledby='docs-start-title'
      >
        <h2
          id='docs-start-title'
          class='m-0 text-[length:clamp(1.35rem,2.2vw,1.85rem)] font-semibold tracking-[-0.02em] text-foreground'
        >
          {props.startTitle}
        </h2>
        <ol class='mt-5 grid list-none grid-cols-1 gap-3 p-0 min-[721px]:grid-cols-3' role='list'>
          {props.startSteps.map((step) => (
            <li class='min-w-0' key={step.href}>
              <a
                class='grid min-h-11 grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 rounded-sm px-2 py-2 text-foreground no-underline hover:underline hover:underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring'
                href={step.href}
              >
                <span class='text-sm tabular-nums text-muted-foreground' aria-hidden='true'>
                  {step.index}
                </span>
                <div>
                  <span class='block text-lg font-semibold'>{step.title}</span>
                  <span class='mt-1 block text-sm leading-relaxed text-muted-foreground'>
                    {step.copy}
                  </span>
                </div>
              </a>
            </li>
          ))}
        </ol>
      </section>
      <nav class='docs-paths border-t border-border' aria-label={props.navLabel}>
        {props.paths.map((path) => (
          <section class='docs-path' key={path.id}>
            <h2 id={path.id} tabindex='-1' data-docs-group>
              {path.title}
            </h2>
            <p>{path.copy}</p>
            <a href={path.href}>{path.action}</a>
          </section>
        ))}
      </nav>
      {/*
        WEB-201 (P2): an honest Examples entry. Four scenarios, each bound to a
        REAL repository source and the command that builds it. There is no
        hosted demo app, so no card may simulate one — the section says that
        explicitly and every link is a repository/route link that exists today.
      */}
      <details class='docs-examples border-t border-border py-5'>
        <summary class='cursor-pointer font-mono text-(length:--text-sm) font-bold text-foreground'>
          {props.examplesTitle}
        </summary>
        <section class='pt-6' aria-label={props.examplesLabel}>
          <p class='mt-3 mb-0 max-w-[46rem] font-mono text-(length:--text-sm) leading-[1.7] text-muted-foreground'>
            {props.examplesLede}
          </p>
          <p class='mt-3 mb-0 max-w-[46rem] font-mono text-(length:--text-xs) leading-[1.6] text-muted-foreground'>
            {props.examplesPrepare}
          </p>
          <ul class='mt-6 grid list-none grid-cols-1 gap-4 p-0 min-[901px]:grid-cols-2' role='list'>
            {props.examples.map((example) => (
              <li
                class='flex min-w-0 flex-col rounded-lg border border-border p-[clamp(1rem,2.5vw,1.5rem)]'
                key={example.sourceHref}
              >
                <h2 class='m-0 text-lg font-semibold text-foreground'>{example.title}</h2>
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
          </ul>
        </section>
      </details>
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
      headTitle: title,
      headDescription: _headDescription,
      examples,
      paths,
      ...text
    } = content[resolved];
    const taskPaths = paths.map((path, index) => {
      const section = navSections[index];
      return {
        ...path,
        id: pathIds[index],
        title: resolved === 'zh' ? (section.sectionZh ?? section.section) : section.section,
        href: siteHref(path.href, resolved),
      };
    });
    return {
      ...text,
      title,
      // Derived from release-state truth: "repository baseline" until the
      // source line ships to @alpha, then the plain version (data/version.ts).
      version: sourceLineStamp(resolved),
      statusHref: siteHref('/changelog', resolved),
      paths: taskPaths,
      jumpLinks: taskPaths.map(({ id, title }) => ({ href: `#${id}`, title })),
      startSteps: text.startSteps.map((step) => ({ ...step, href: siteHref(step.href, resolved) })),
      // The Examples cards keep their repository links absolute (they leave the
      // site) and localize only the related in-site doc route.
      examples: examples.map((example) => ({
        ...example,
        docHref: siteHref(example.docHref, resolved),
        // Each-item children in the compiled grammar must be {item.<field>}
        // (OEC9013), so the localized field labels ride on every card rather
        // than being read from props.* inside the mapped item.
        fieldSource: text.fieldSource,
        fieldRun: example.run.startsWith('npm create ') ? text.fieldRunStarter : text.fieldRun,
        fieldDoc: text.fieldDoc,
        fieldLimits: text.fieldLimits,
      })),
    };
  },
});
