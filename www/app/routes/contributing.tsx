import { definePage } from '@openelement/router';
import { trustedHtml, type TrustedHtml } from '@openelement/element';
import '@openelement/ui/open-code-block';
import '@openelement/ui/open-button';
import '../islands/open-copy-button.tsx';
import '#site-ui/open-reading-shell.tsx';
import { siteHead } from '#site-ui/head.ts';
import { contentLocale } from '#site-ui/locale.ts';
import { siteHref } from '#site-ui/site-url.ts';
import { contributingSetupCodeHtml } from '../data/_generated-page-code.ts';

export const meta = { section: '', label: 'Contributing', order: 30 };

const content = {
  en: {
    headTitle: 'Contributing',
    headDescription:
      'Set up an openElement checkout, run the required checks, and choose a first contribution.',
    title: 'Contributing',
    lede: 'Choose a small first contribution, then set up your checkout and run the checks for your pull request.',
    firstTaskLink: 'Choose a first task',
    adrLink: 'When to write an architecture decision record (ADR)',
    setupLabel: 'Development setup',
    copyLabel: 'Copy setup commands',
    copied: 'Copied',
    copyAnnouncement: 'Setup commands copied to clipboard.',
    copyFailed:
      'Clipboard access is unavailable. Select the commands below and copy them manually.',
    dismissCopyError: 'Dismiss copy error',
    setupCopy:
      'Use the Node version in .node-version and the pnpm version in package.json. The commands clone the repository, enter it, install dependencies, and run the repository checks.',
    setupHelp: 'Read the repository setup and development guide',
    maintainerTitle: 'For maintainers',
    releaseLinkLabel: 'Read the repository release process',
    beforePrLabel: 'Before a pull request',
    checklist: [
      {
        id: 'format',
        text: 'Run pnpm exec vp run check and the tests for the packages you changed.',
      },
      {
        id: 'commits',
        text: 'Use a Conventional Commit prefix and sign off each commit with git commit -s.',
      },
      {
        id: 'evidence',
        text: 'Link the issue when one exists and include the commands you ran and their results.',
      },
    ],
    layeringCopy:
      'Before adding a feature, check what HTML, CSS, and browser APIs already provide. Reuse existing dependencies before adding custom code.',
    helpLabel: 'Where to help',
    helpRows: [
      {
        id: 'dogfood',
        title: 'Try the starter',
        copy: 'Follow Getting Started in a clean directory. If a step fails, record the Node and package versions, the command, and the smallest example that reproduces it.',
        linkLabel: 'Open Getting Started',
        href: '/guide/getting-started',
      },
      {
        id: 'corpus',
        title: 'Test a third-party component',
        copy: 'Find a Web Component whose server-rendered or hydrated behavior differs from the existing Native, Lit, FAST, and Stencil fixtures. Use the fixture probes to make the difference reproducible.',
        linkLabel: 'Open the interoperability fixtures',
        href: 'https://github.com/open-element/openelement/tree/main/tests/fixtures/web-component-interop',
      },
      {
        id: 'docs',
        title: 'Fix a documentation example',
        copy: 'Choose an example that fails or a claim that has drifted. Verify it against the checkout and include the result with your correction.',
        linkLabel: 'Browse the documentation source',
        href: 'https://github.com/open-element/openelement/tree/main/www/content/docs',
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
    headTitle: '参与贡献',
    headDescription: '配置 openElement 的本地开发环境，运行所需检查，并选择适合第一次参与的任务。',
    title: '参与贡献',
    lede: '选一项小任务开始，再配置本地开发环境并运行拉取请求所需的检查。',
    firstTaskLink: '选择第一项任务',
    adrLink: '了解何时需要编写架构决策记录（ADR）',
    setupLabel: '开发环境设置',
    copyLabel: '复制配置命令',
    copied: '已复制',
    copyAnnouncement: '配置命令已复制到剪贴板。',
    copyFailed: '无法访问剪贴板。请选中下方命令，手动复制。',
    dismissCopyError: '关闭复制错误提示',
    setupCopy:
      '请使用 .node-version 指定的 Node 版本和 package.json 指定的 pnpm 版本。这组命令会克隆仓库、进入目录、安装依赖并运行仓库检查。',
    setupHelp: '阅读仓库的环境配置和开发指南',
    maintainerTitle: '维护者专区',
    releaseLinkLabel: '阅读仓库的发布流程',
    beforePrLabel: '提交拉取请求之前',
    checklist: [
      {
        id: 'format',
        text: '运行 pnpm exec vp run check，并测试改动涉及的包。',
      },
      {
        id: 'commits',
        text: '使用 Conventional Commits 前缀，并用 git commit -s 签署每次提交。',
      },
      {
        id: 'evidence',
        text: '附上运行过的命令及结果。如有对应的 issue，也请附上链接。',
      },
    ],
    layeringCopy:
      '新增功能前，先检查 HTML、CSS 和浏览器 API 能实现什么，再考虑复用现有依赖，最后才添加自定义代码。',
    helpLabel: '可以从哪里入手',
    helpRows: [
      {
        id: 'dogfood',
        title: '试用脚手架',
        copy: '在空目录中按快速开始操作。如果某步失败，记录 Node 和软件包版本、执行的命令，以及能复现问题的最小示例。',
        linkLabel: '打开快速开始',
        href: '/guide/getting-started',
      },
      {
        id: 'corpus',
        title: '测试第三方 Web Component',
        copy: '找一个在服务端渲染或 hydration 时与现有原生、Lit、FAST、Stencil 测试样例表现不同的组件，用样例中的探针复现差异。',
        linkLabel: '打开组件互操作测试样例',
        href: 'https://github.com/open-element/openelement/tree/main/tests/fixtures/web-component-interop',
      },
      {
        id: 'docs',
        title: '修正文档示例',
        copy: '找出一个运行失败的示例或一处过时的说明。在本地检出中验证，并在提交修正时附上结果。',
        linkLabel: '浏览文档源码',
        href: 'https://github.com/open-element/openelement/tree/main/www/content/docs',
      },
    ],
    calloutLabel: '先提问',
    calloutIntro: '用法与设计问题请使用 ',
    discussionsLabel: 'GitHub Discussions',
    calloutBetween: '。',
    issuesLabel: 'Issues',
    calloutAfter: ' 用于可复现的 bug、文档缺陷与已达成共识的提案。',
    changelogLabel: '更新日志',
    roadmapLabel: '路线图',
  },
} as const;

/** The page-contributing class scopes rules in site-chrome.css. */
export function PageContributing(props: {
  title: string;
  lede: string;
  locale: string;
  setupCodeHtml: TrustedHtml;
  setupLabel: string;
  setupCopy: string;
  setupHelp: string;
  firstTaskLink: string;
  adrLink: string;
  copyLabel: string;
  copied: string;
  copyAnnouncement: string;
  copyFailed: string;
  dismissCopyError: string;
  maintainerTitle: string;
  releaseLinkLabel: string;
  beforePrLabel: string;
  checklist: Array<{ id: string; text: string }>;
  layeringCopy: string;
  helpLabel: string;
  helpRows: Array<{ id: string; title: string; copy: string; linkLabel: string; href: string }>;
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
      <open-reading-shell meta footer locale={props.locale}>
        <div slot='meta'>
          <h1 class='m-0 font-sans text-[clamp(2.1rem,4.6vw,3.4rem)] leading-[1.05] font-extrabold tracking-[-0.035em] text-balance text-foreground'>
            {props.title}
          </h1>
          <p class='mt-[clamp(1.25rem,3vh,2rem)] mb-0 max-w-[38rem] text-muted-foreground text-[clamp(1rem,1.2vw,1.1rem)] leading-[1.75]'>
            {props.lede}
          </p>
          <nav class='mt-3 flex flex-wrap gap-x-6'>
            <a
              class='inline-flex min-h-11 items-center text-sm font-semibold text-primary underline underline-offset-4'
              href='#contributing-help-heading'
            >
              {props.firstTaskLink}
            </a>
            <a
              class='inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-4'
              href='#contributing-setup-heading'
            >
              {props.setupLabel}
            </a>
          </nav>
        </div>

        <section class='grid' aria-labelledby='contributing-help-heading'>
          <h2
            id='contributing-help-heading'
            tabindex='-1'
            class='m-0 scroll-mt-[calc(var(--nav-height)+1rem)] pb-4 text-xl font-bold text-foreground'
          >
            {props.helpLabel}
          </h2>
          {props.helpRows.map((item) => (
            <div
              class='help-row grid grid-cols-[minmax(0,1fr)] items-center gap-2 border-t border-border py-5 min-[901px]:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)] min-[901px]:gap-6'
              key={item.id}
            >
              <h3 class='m-0 text-lg font-bold text-foreground'>{item.title}</h3>
              <div>
                <p class='my-0 text-sm leading-relaxed text-muted-foreground'>{item.copy}</p>
                <a
                  class='mt-2 inline-block text-sm text-primary underline underline-offset-4'
                  href={item.href}
                >
                  {item.linkLabel}
                </a>
              </div>
            </div>
          ))}
        </section>

        <section
          class='grid grid-cols-1 gap-8 border-t border-border py-8'
          aria-labelledby='contributing-setup-heading'
        >
          <div class='grid grid-cols-[minmax(0,1fr)] content-start gap-4'>
            <h2
              id='contributing-setup-heading'
              class='m-0 scroll-mt-[calc(var(--nav-height)+1rem)] text-xl font-bold text-foreground'
              tabindex='-1'
            >
              {props.setupLabel}
            </h2>
            <div class='min-w-0'>
              <open-copy-button
                class='contributing-copy'
                target='contributing-setup-commands'
                label={props.copyLabel}
                accessible-name={props.copyLabel}
                copied={props.copied}
                announce={props.copyAnnouncement}
                failed={props.copyFailed}
                dismiss={props.dismissCopyError}
              ></open-copy-button>
              <open-code-block>
                <div id='contributing-setup-commands' innerHTML={props.setupCodeHtml} trustedHtml />
              </open-code-block>
            </div>
            <p class='my-0 text-muted-foreground text-(length:--text-sm) leading-[1.75]'>
              {props.setupCopy}
            </p>
            <a
              class='w-fit text-sm text-primary underline underline-offset-4'
              href='https://github.com/open-element/openelement/blob/main/CONTRIBUTING.md#development'
            >
              {props.setupHelp}
            </a>
          </div>

          <div class='grid grid-cols-[minmax(0,1fr)] content-start gap-4'>
            <h2 class='m-0 text-xl font-bold text-foreground'>{props.beforePrLabel}</h2>
            <ul class='checklist my-0 grid list-disc gap-4 ps-5'>
              {props.checklist.map((item) => (
                <li class='text-sm leading-relaxed text-muted-foreground' key={item.id}>
                  {item.text}
                </li>
              ))}
              <li class='text-sm leading-relaxed text-muted-foreground'>
                <a
                  class='text-primary underline underline-offset-4'
                  href='https://github.com/open-element/openelement/blob/main/CONTRIBUTING.md#when-an-adr-is-required'
                >
                  {props.adrLink}
                </a>
              </li>
            </ul>
            <p class='my-0 text-muted-foreground text-(length:--text-sm) leading-[1.75]'>
              {props.layeringCopy}
            </p>
          </div>
        </section>

        <aside class='my-8 rounded-lg border border-border bg-muted px-6 py-5'>
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

        <section
          class='mb-6 border-t border-border pt-5'
          aria-labelledby='contributing-maintainers-heading'
        >
          <h2 id='contributing-maintainers-heading' class='m-0 text-xl font-bold text-foreground'>
            {props.maintainerTitle}
          </h2>
          <a
            class='mt-2 inline-block text-primary underline'
            href='https://github.com/open-element/openelement/blob/main/CONTRIBUTING.md#release-work'
          >
            {props.releaseLinkLabel}
          </a>
        </section>

        <div slot='footer' class='flex flex-wrap gap-3'>
          <open-button variant='ghost' size='sm' href={props.changelogHref}>
            {props.changelogLabel}
          </open-button>
          <open-button variant='ghost' size='sm' href={props.roadmapHref}>
            {props.roadmapLabel}
          </open-button>
        </div>
      </open-reading-shell>
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
      locale: resolved,
      helpRows: text.helpRows.map((item) => ({
        ...item,
        href: siteHref(item.href, resolved),
      })),
      // The setup code block is pre-highlighted by the shared site highlighter
      // (lib/markdown.ts via generate:content) — never a JSX copy.
      setupCodeHtml: trustedHtml(contributingSetupCodeHtml),
      discussionsHref: 'https://github.com/open-element/openelement/discussions',
      issuesHref: 'https://github.com/open-element/openelement/issues',
      changelogHref: siteHref('/changelog', resolved),
      roadmapHref: siteHref('/roadmap', resolved),
    };
  },
});
