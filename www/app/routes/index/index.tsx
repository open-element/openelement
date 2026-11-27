import { definePage } from '@openelement/router';
import { trustedHtml, type TrustedHtml } from '@openelement/element';
import '../../islands/open-counter.tsx';
import '../../islands/open-copy-button.tsx';
import '../../islands/open-source-toggle.tsx';
import '../../islands/open-layer-strip.tsx';
import { siteHead } from '#site-ui/head.ts';
import { contentLocale } from '#site-ui/locale.ts';
import { REPOSITORY_URL } from '#site-ui/open-layout-navigation.ts';
import { siteHref } from '#site-ui/site-url.ts';
import { CURRENT_ALPHA_VERSION } from '../../data/version.ts';
import { installCommand } from '../../data/_generated-install-command.ts';
import { homeHeroCodeHtml } from '../../data/_generated-page-code.ts';
import {
  HOME_DEMO_HYDRATION_BYTES,
  HOME_DEMO_HYDRATION_GZIP_BYTES,
  homeKilobytes,
} from '../../data/home-measurements.ts';

const content = {
  en: {
    headTitle: 'openElement — The Web Components framework',
    headDescription:
      'openElement is a Web Components-native framework for static-first apps. Render HTML on the server and choose which components hydrate.',
    title: 'Build with',
    titleAccent: 'the browser.',
    description:
      'Build apps with native Web Components. Pages arrive as ready-to-read HTML, and JavaScript loads where users interact.',
    release: 'npm prerelease',
    alphaNote: 'Alpha APIs can still change. See the ',
    alphaEnd: '.',
    releaseNotes: 'release notes',
    start: 'Start building',
    docs: 'Read the docs',
    demoJump: 'Try the live counter',
    glossIslandTerm: 'Island',
    glossIsland:
      'one interactive component that hydrates on its own after the page is already readable.',
    glossDsdTerm: 'Declarative Shadow DOM',
    glossDsd:
      'ships a component’s shadow root as HTML, so it renders before any JavaScript arrives.',
    glossHydrationTerm: 'Hydration',
    glossHydration:
      'when an island’s chunk — the one JavaScript file that island ships — upgrades the server HTML in place.',
    commandLabel: 'Install command',
    commandRequirement: 'Requires Node.js 24.2+.',
    setupGuide: 'Setup guide',
    copy: 'Copy',
    copied: 'Copied',
    copyAnnouncement: 'Install command copied to clipboard.',
    copyFailed: 'Copy failed — select the command manually.',
    sourceCopy: 'Copy source',
    sourceCopied: 'Copied',
    sourceAnnouncement: 'Source copied to clipboard.',
    sourceFailed: 'Copy failed — select the code manually.',
    sourceView: 'View source',
    sourceHide: 'Hide source',
    sourceLabel: 'Component body',
    sourceFile: 'open-counter.tsx',
    sourceStamp: 'Source used in this build',
    sourceScroll: 'scroll →',
    demoLabel: 'Interactive counter',
    demoNote: 'Rendered on the server',
    demoLive: 'Use + to count',
    copyDismiss: 'Dismiss copy error',
    counterLabel: 'Count:',
    counterReset: 'Reset',
    counterAction: 'Increment count, currently',
    copyAria: 'Copy install command',
    sourceCopyAria: 'Copy component source',
    layerTitle: 'Layer strip',
    layerHtmlName: 'HTML',
    layerDsdName: 'Declarative Shadow DOM',
    layerHydrateName: 'island JavaScript',
    regionHydrateName: 'island JS',
    layerHtml: 'server output',
    layerDsd: 'shadow root',
    layerHydrate: 'chunk',
    layerAll: 'All layers',
    layerAllReading: 'the whole window',
    layerHint: 'Select a layer to highlight it.',
    layerHintTouch: 'Tap a layer to highlight it.',
    evidenceTitle: 'Evidence',
    evidenceJsValue: '0 B',
    evidenceJsLabel: 'framework JavaScript required for first paint',
    evidenceJsNote: 'The HTML renders completely with JavaScript disabled.',
    evidenceHydrationLabel: 'demo island hydration chunk',
    evidenceHydrationNote: 'gzip · loaded on visibility, not for first paint',
    evidenceComparisonLabel: 'Architecture comparison',
    evidenceComparisonNote: 'Qualitative fit, no speed ranking.',
    featuresTitle: 'From source to browser',
    featuresDescription: 'Write components in JSX and control when they come to life.',
    steps: [
      {
        label: 'Author',
        title: 'Native Web Components',
        description:
          'Define components as Custom Elements. Compose them in JSX and use signals for local state.',
        link: 'Explore the architecture',
        href: '/architecture/',
      },
      {
        label: 'Render',
        title: 'HTML on first paint',
        description:
          'Pre-render pages at build time or render on request. Shadow roots can arrive as Declarative Shadow DOM.',
        link: 'See how rendering works',
        href: '/architecture/dsd/',
      },
      {
        label: 'Activate',
        title: 'JavaScript where it matters',
        description:
          'Choose when each interactive island hydrates: on load, when the browser is idle, or when it scrolls into view.',
        link: 'Learn about islands',
        href: '/guide/islands-and-ssr/',
      },
    ],
    nextTitle: 'Build your first app',
    // Keep these three steps aligned with the getting-started guide.
    nextLede:
      'Scaffold the app, start the dev server, and add a page that ships no client JavaScript of its own.',
    gettingStarted: 'Getting started',
    reference: 'API reference',
    deployment: 'Deployment guide',
  },
  zh: {
    headTitle: 'openElement — 原生 Web Components 应用框架',
    headDescription:
      'openElement 是一个基于原生 Web Components 的静态优先应用框架。在服务端生成 HTML，按组件选择何时水合交互。',
    title: '用浏览器原生能力',
    titleAccent: '构建应用。',
    description:
      '用浏览器原生 Web Components 构建应用。页面以完整 HTML 送达，用户可立即阅读，只有交互部分加载 JavaScript。',
    release: 'npm 预发布',
    alphaNote: 'Alpha 阶段的 API 仍可能变化，详见',
    alphaEnd: '。',
    releaseNotes: '发布说明',
    start: '开始构建',
    docs: '阅读文档',
    demoJump: '试用计数器',
    glossIslandTerm: '交互岛（island）',
    glossIsland: '一个自行水合的交互组件；页面其余部分已经可读，不必等它。',
    glossDsdTerm: '声明式 Shadow DOM（DSD）',
    glossDsd: '随 HTML 一起发送组件的 shadow root，JavaScript 加载前即可显示。',
    glossHydrationTerm: '水合',
    glossHydration:
      '交互岛的 chunk（该岛单独加载的那一个 JavaScript 文件）就地接管服务端渲染的 HTML。',
    commandLabel: '安装命令',
    commandRequirement: '需要 Node.js 24.2+。',
    setupGuide: '环境配置指南',
    copy: '复制',
    copied: '已复制',
    copyAnnouncement: '安装命令已复制到剪贴板。',
    copyFailed: '复制失败——请手动选中命令。',
    sourceCopy: '复制源码',
    sourceCopied: '已复制',
    sourceAnnouncement: '源码已复制到剪贴板。',
    sourceFailed: '复制失败——请手动选中代码。',
    sourceView: '查看源码',
    sourceHide: '收起源码',
    sourceLabel: '组件主体',
    sourceFile: 'open-counter.tsx',
    sourceStamp: '构建使用的源码',
    sourceScroll: '横向滚动 →',
    demoLabel: '交互计数器',
    demoNote: '由服务端渲染',
    demoLive: '按 + 增加计数',
    copyDismiss: '关闭复制错误提示',
    counterLabel: '计数：',
    counterReset: '重置',
    counterAction: '增加计数，当前',
    copyAria: '复制安装命令',
    sourceCopyAria: '复制组件源码',
    layerTitle: '分层',
    layerHtmlName: 'HTML',
    layerDsdName: '声明式 Shadow DOM',
    layerHydrateName: '交互岛 JavaScript',
    regionHydrateName: '交互岛 JS',
    layerHtml: '服务端输出',
    layerDsd: 'shadow root',
    layerHydrate: 'chunk',
    layerAll: '全部',
    layerAllReading: '整个窗口',
    layerHint: '选择一层，高亮对应区域。',
    layerHintTouch: '点按一层，高亮对应区域。',
    evidenceTitle: '证据',
    evidenceJsValue: '0 B',
    evidenceJsLabel: '首屏绘制前所需的框架 JavaScript',
    evidenceJsNote: '禁用 JavaScript，页面依然完整呈现。',
    evidenceHydrationLabel: '演示交互岛的水合产物',
    evidenceHydrationNote: 'gzip · 可见时加载，不参与首屏',
    evidenceComparisonLabel: '架构对比',
    evidenceComparisonNote: '只看适配，不做速度排名。',
    featuresTitle: '从源码到浏览器',
    featuresDescription: '用 JSX 编写组件，自行决定何时启用交互。',
    steps: [
      {
        label: '编写',
        title: '原生 Web Components',
        description: '用 Custom Elements 定义组件，在 JSX 中组合组件，并用 signals 管理局部状态。',
        link: '探索框架架构',
        href: '/architecture/',
      },
      {
        label: '渲染',
        title: '首屏即有 HTML',
        description:
          '可在构建时预渲染页面，也可按请求渲染。Shadow root 可以以声明式 Shadow DOM 的形式随 HTML 发送。',
        link: '了解渲染机制',
        href: '/architecture/dsd/',
      },
      {
        label: '水合',
        title: '按需加载 JavaScript',
        description: '按交互岛配置水合时机：页面加载时、浏览器空闲时，或滚动进入视口时。',
        link: '了解交互岛',
        href: '/guide/islands-and-ssr/',
      },
    ],
    nextTitle: '开始上手',
    nextLede: '生成应用，启动开发服务器，再添加一个不携带客户端 JavaScript 的页面。',
    gettingStarted: '快速开始',
    reference: 'API 参考',
    deployment: '部署指南',
  },
} as const;

export function PageHome(props: {
  title: string;
  titleAccent: string;
  description: string;
  release: string;
  version: string;
  alphaNote: string;
  alphaEnd: string;
  releaseNotes: string;
  releaseNotesHref: string;
  start: string;
  docs: string;
  demoJump: string;
  glossIslandTerm: string;
  glossIsland: string;
  glossIslandHref: string;
  glossDsdTerm: string;
  glossDsd: string;
  glossDsdHref: string;
  glossHydrationTerm: string;
  glossHydration: string;
  glossHydrationHref: string;
  command: string;
  commandLabel: string;
  commandRequirement: string;
  setupGuide: string;
  copy: string;
  copied: string;
  copyAnnouncement: string;
  copyFailed: string;
  sourceCopy: string;
  sourceCopied: string;
  sourceAnnouncement: string;
  sourceFailed: string;
  sourceView: string;
  sourceHide: string;
  sourceCue: string;
  sourceLabel: string;
  sourceFile: string;
  sourceStamp: string;
  sourceScroll: string;
  demoLabel: string;
  demoNote: string;
  demoLive: string;
  copyDismiss: string;
  counterLabel: string;
  counterReset: string;
  counterAction: string;
  copyAria: string;
  sourceCopyAria: string;
  layerTitle: string;
  layerHtmlName: string;
  layerDsdName: string;
  layerHydrateName: string;
  regionHydrateName: string;
  layerHtml: string;
  layerDsd: string;
  layerHydrate: string;
  layerAll: string;
  layerAllReading: string;
  layerHint: string;
  layerHintTouch: string;
  hydrationValue: string;
  hydrationNote: string;
  evidenceTitle: string;
  evidenceJsValue: string;
  evidenceJsLabel: string;
  evidenceJsNote: string;
  evidenceHydrationLabel: string;
  evidenceComparisonLabel: string;
  evidenceComparisonNote: string;
  comparisonHref: string;
  code: TrustedHtml;
  featuresTitle: string;
  featuresDescription: string;
  steps: Array<{
    label: string;
    title: string;
    description: string;
    link: string;
    href: string;
  }>;
  nextTitle: string;
  nextLede: string;
  gettingStarted: string;
  reference: string;
  deployment: string;
  startHref: string;
  docsHref: string;
  referenceHref: string;
  deploymentHref: string;
  changelogHref: string;
}) {
  return (
    <div class='page-home' data-pagefind-body>
      <section class='home-hero'>
        <div class='home-width home-hero-grid'>
          <div class='home-intro max-sm:pt-6!'>
            <a class='home-release' href={props.changelogHref}>
              <span class='home-release-dot' aria-hidden='true'></span>
              <span class='home-release-label'>{props.release}</span>
              <span class='home-release-version'>{props.version}</span>
              <span class='home-release-arrow' aria-hidden='true'>
                →
              </span>
            </a>

            <h1 id='home-title'>
              <span>{props.title}</span> <span class='home-title-accent'>{props.titleAccent}</span>
            </h1>
            <p class='home-description'>{props.description}</p>

            <div class='home-actions'>
              <a class='home-button home-button-primary' href={props.startHref}>
                {props.start}
                <span aria-hidden='true'>→</span>
              </a>
              <a class='home-button home-button-ghost' href={props.docsHref}>
                {props.docs}
              </a>
            </div>
            <a class='home-demo-jump' href='#home-live-demo'>
              {props.demoJump}
            </a>

            <div
              class='home-command'
              role='group'
              aria-label={props.commandLabel}
              aria-describedby='home-install-requirements'
            >
              <span class='home-command-prompt' aria-hidden='true'>
                $
              </span>
              <code id='home-install-command'>{props.command}</code>
              <open-copy-button
                target='home-install-command'
                label={props.copy}
                copied={props.copied}
                announce={props.copyAnnouncement}
                failed={props.copyFailed}
                dismiss={props.copyDismiss}
                accessible-name={props.copyAria}
              ></open-copy-button>
            </div>
            <p id='home-install-requirements' class='mt-2 text-sm text-(--site-muted)'>
              {props.commandRequirement}{' '}
              <a class='underline underline-offset-4' href={props.startHref}>
                {props.setupGuide}
              </a>
            </p>

            <p class='home-alpha'>
              {props.alphaNote}
              <a href={props.releaseNotesHref}>{props.releaseNotes}</a>
              {props.alphaEnd}
            </p>
          </div>

          <figure class='home-window max-sm:mt-5!'>
            <figcaption class='home-window-head'>
              <span class='home-window-file'>{props.sourceFile}</span>
              <span class='home-window-stamp'>{props.sourceStamp}</span>
            </figcaption>
            <div class='home-window-body'>
              <div class='home-demo home-region home-region-html' id='home-live-demo' tabindex='-1'>
                {/* The header reflects the island's current phase. CSS keys
                    the badge to `open-counter:defined`, i.e. the moment the
                    island chunk registers its element — the same upgrade the
                    counter below answers clicks with. With JS off, the note
                    still describes the server-rendered output. */}
                <div class='home-demo-head'>
                  <span class='home-demo-head-id'>
                    {/* The three layer markers stay in normal flow at
                        the start of the row they label (01 here, 02 beside
                        #shadow-root, 03 beside the counter). Their vertical
                        order is therefore the strip's order at every width,
                        theme and locale, and no marker can cover the demo head
                        or the counter. */}
                    <span class='home-region-label home-region-label-html' aria-hidden='true'>
                      <span class='home-region-index'>01</span>
                      <span class='home-region-name'> HTML</span>
                    </span>
                    <span class='home-demo-label'>{props.demoLabel}</span>
                    <span class='home-demo-state'>
                      <span class='home-demo-state-dot' aria-hidden='true'></span>
                      <span class='home-demo-state-text'>{props.demoLive}</span>
                    </span>
                  </span>
                  <span class='home-demo-note'>{props.demoNote}</span>
                </div>
                <div class='home-dsd home-region home-region-dsd'>
                  <div class='home-dsd-head'>
                    <span class='home-region-label home-region-label-dsd' aria-hidden='true'>
                      <span class='home-region-index'>02</span>
                      <span class='home-region-name'> DSD</span>
                    </span>
                    <span class='home-dsd-tag' aria-hidden='true'>
                      #shadow-root
                    </span>
                  </div>
                  <div class='home-hydrate home-region home-region-hydrate'>
                    <span class='home-region-label home-region-label-hydrate' aria-hidden='true'>
                      <span class='home-region-index'>03</span>
                      <span class='home-region-name'> {props.regionHydrateName}</span>
                    </span>
                    {/* Without JavaScript the interactive counter is
                        hidden and this static read-out of the server-rendered
                        value remains. It is plain text: no button semantics,
                        no focus stop, nothing inert to click. */}
                    <span class='home-counter-static'>
                      {props.counterLabel}
                      {' 0'}
                    </span>
                    <open-counter
                      label={props.counterLabel}
                      reset={props.counterReset}
                      increment={props.counterAction}
                    ></open-counter>
                  </div>
                </div>
              </div>

              {/* Press `All layers` or the active row again to clear the selection.
                  SSR puts the tab stop on the default row. The arrow keys
                  move it via open-layer-strip-controller.ts, and selecting
                  a row keeps focus on the page. */}
              <div class='home-layers' role='group' aria-label={props.layerTitle}>
                <p class='home-layer-hint'>
                  <span class='home-layer-hint-fine'>{props.layerHint}</span>
                  <span class='home-layer-hint-touch'>{props.layerHintTouch}</span>
                </p>
                <button
                  type='button'
                  class='home-layer home-layer-all'
                  data-layer='all'
                  aria-pressed='true'
                  tabindex='0'
                >
                  <span class='home-layer-name'>{props.layerAll}</span>
                  <span class='home-layer-rule' aria-hidden='true'></span>
                  <span class='home-layer-reading'>{props.layerAllReading}</span>
                  <span class='home-layer-chevron' aria-hidden='true'>
                    ›
                  </span>
                </button>
                <button
                  type='button'
                  class='home-layer'
                  data-layer='html'
                  aria-pressed='false'
                  tabindex='-1'
                >
                  <span class='home-layer-index' aria-hidden='true'>
                    01
                  </span>
                  <span class='home-layer-name'>{props.layerHtmlName}</span>
                  <span class='home-layer-rule' aria-hidden='true'></span>
                  <span class='home-layer-reading'>{props.layerHtml}</span>
                  <span class='home-layer-chevron' aria-hidden='true'>
                    ›
                  </span>
                </button>
                <button
                  type='button'
                  class='home-layer'
                  data-layer='dsd'
                  aria-pressed='false'
                  tabindex='-1'
                >
                  <span class='home-layer-index' aria-hidden='true'>
                    02
                  </span>
                  <span class='home-layer-name'>{props.layerDsdName}</span>
                  <span class='home-layer-rule' aria-hidden='true'></span>
                  <span class='home-layer-reading'>{props.layerDsd}</span>
                  <span class='home-layer-chevron' aria-hidden='true'>
                    ›
                  </span>
                </button>
                <button
                  type='button'
                  class='home-layer'
                  data-layer='hydrate'
                  aria-pressed='false'
                  tabindex='-1'
                >
                  <span class='home-layer-index' aria-hidden='true'>
                    03
                  </span>
                  <span class='home-layer-name'>{props.layerHydrateName}</span>
                  <span class='home-layer-rule' aria-hidden='true'></span>
                  <span class='home-layer-reading'>
                    {props.hydrationValue} {props.layerHydrate}
                  </span>
                  <span class='home-layer-chevron' aria-hidden='true'>
                    ›
                  </span>
                </button>
                <open-layer-strip></open-layer-strip>
              </div>

              <div class='home-editor'>
                <div class='home-editor-bar'>
                  <span class='home-editor-label'>{props.sourceLabel}</span>
                  <span class='home-editor-actions'>
                    <open-copy-button
                      target='home-source-text'
                      label={props.sourceCopy}
                      copied={props.sourceCopied}
                      announce={props.sourceAnnouncement}
                      failed={props.sourceFailed}
                      dismiss={props.copyDismiss}
                      accessible-name={props.sourceCopyAria}
                    ></open-copy-button>
                  </span>
                </div>
                <div class='home-source' id='home-source-code'>
                  <div class='home-source-view'>
                    <div id='home-source-text' innerHTML={props.code} trustedHtml />
                    <span class='home-source-fade' aria-hidden='true'></span>
                  </div>
                  <div class='home-source-foot'>
                    <span class='home-source-cue' aria-hidden='true'>
                      {props.sourceScroll}
                    </span>
                    <open-source-toggle
                      target='home-source-code'
                      label={props.sourceCue}
                      hide-label={props.sourceHide}
                    ></open-source-toggle>
                    {/* Pre-hydration cue: the toggle only becomes interactive
                        after its island upgrades, so the footer still names the
                        full file and its line count until then. */}
                    <span class='home-source-meta' aria-hidden='true'>
                      {props.sourceCue}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </figure>

          <dl class='home-gloss'>
            <dt>
              <a class='home-gloss-link' href={props.glossIslandHref}>
                {props.glossIslandTerm}
              </a>
            </dt>
            <dd>{props.glossIsland}</dd>
            <dt>
              <a class='home-gloss-link' href={props.glossDsdHref}>
                {props.glossDsdTerm}
              </a>
            </dt>
            <dd>{props.glossDsd}</dd>
            <dt>
              <a class='home-gloss-link' href={props.glossHydrationHref}>
                {props.glossHydrationTerm}
              </a>
            </dt>
            <dd>{props.glossHydration}</dd>
          </dl>
        </div>
      </section>

      <section class='home-evidence' aria-labelledby='home-evidence-title'>
        <div class='home-width'>
          <h2 class='sr-only' id='home-evidence-title'>
            {props.evidenceTitle}
          </h2>
          <div class='home-evidence-grid'>
            <div class='home-evidence-cell'>
              <span class='home-evidence-value'>{props.evidenceJsValue}</span>
              <span class='home-evidence-label'>{props.evidenceJsLabel}</span>
              <span class='home-evidence-note'>{props.evidenceJsNote}</span>
            </div>
            <div class='home-evidence-cell'>
              <span class='home-evidence-value'>{props.hydrationValue}</span>
              <span class='home-evidence-label'>{props.evidenceHydrationLabel}</span>
              <span class='home-evidence-note'>{props.hydrationNote}</span>
            </div>
            {/* The link shares the first-row baseline of the stats. Its
                label uses the same 1.1 line box as the two values, and the
                empty aria-hidden row below reproduces the label row the other
                cells occupy, so all three notes share one baseline. */}
            <a class='home-evidence-cell home-evidence-link' href={props.comparisonHref}>
              <span class='home-evidence-value'>
                <span class='home-evidence-link-label'>
                  {props.evidenceComparisonLabel}
                  <span class='home-evidence-arrow' aria-hidden='true'>
                    →
                  </span>
                </span>
              </span>
              <span class='home-evidence-link-spacer' aria-hidden='true'></span>
              <span class='home-evidence-note'>{props.evidenceComparisonNote}</span>
            </a>
          </div>
        </div>
      </section>

      <section class='home-features home-width' id='element' aria-labelledby='home-features-title'>
        <h2 id='home-features-title'>{props.featuresTitle}</h2>
        <p class='home-section-description'>{props.featuresDescription}</p>
        <ol class='home-steps' role='list'>
          {props.steps.map((step) => (
            <li key={step.href}>
              <p class='home-step-label'>{step.label}</p>
              <h3>{step.title}</h3>
              <p class='home-step-description'>{step.description}</p>
              <a class='home-text-link' href={step.href}>
                {step.link}
                <span aria-hidden='true'>→</span>
              </a>
            </li>
          ))}
        </ol>
      </section>

      <section class='home-next' id='begin' aria-labelledby='home-next-title'>
        <div class='home-width home-next-grid'>
          <div class='home-next-intro'>
            <h2 id='home-next-title'>{props.nextTitle}</h2>
            <p class='home-next-lede'>{props.nextLede}</p>
          </div>
          <ul class='home-next-links' role='list'>
            <li>
              <a href={props.startHref}>
                {props.gettingStarted}
                <span aria-hidden='true'>→</span>
              </a>
            </li>
            <li>
              <a href={props.referenceHref}>
                {props.reference}
                <span aria-hidden='true'>→</span>
              </a>
            </li>
            <li>
              <a href={props.deploymentHref}>
                {props.deployment}
                <span aria-hidden='true'>→</span>
              </a>
            </li>
          </ul>
        </div>
      </section>
    </div>
  );
}

export default definePage(PageHome, {
  head({ locale }) {
    const resolved = contentLocale(locale ?? 'en');
    const copy = content[resolved];
    return siteHead({
      route: '/',
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
      steps,
      ...copy
    } = content[resolved];
    const hydrationValue = homeKilobytes(HOME_DEMO_HYDRATION_BYTES);
    const sourceLineCount = (homeHeroCodeHtml.match(/class="line"/g) ?? []).length;
    return {
      ...copy,
      steps: steps.map((step) => ({ ...step, href: siteHref(step.href, resolved) })),
      version: CURRENT_ALPHA_VERSION,
      command: installCommand,
      hydrationValue,
      hydrationNote: `${homeKilobytes(HOME_DEMO_HYDRATION_GZIP_BYTES)} ${copy.evidenceHydrationNote}`,
      sourceCue: `${copy.sourceView} · ${sourceLineCount} ${resolved === 'zh' ? '行' : 'lines'}`,
      code: trustedHtml(homeHeroCodeHtml),
      // The glossary is the page's own mini-index; each term links to the docs
      // page that owns it, through the localized href helper so /zh/ never
      // points at an English route.
      glossIslandHref: siteHref('/guide/islands-and-ssr', resolved),
      glossDsdHref: siteHref('/architecture/dsd', resolved),
      glossHydrationHref: siteHref('/guide/islands-and-ssr', resolved),
      comparisonHref: siteHref('/architecture', resolved),
      startHref: siteHref('/guide/getting-started', resolved),
      docsHref: siteHref('/docs', resolved),
      referenceHref: siteHref('/reference', resolved),
      deploymentHref: siteHref('/guide/deployment', resolved),
      changelogHref: siteHref('/changelog', resolved),
      releaseNotesHref: `${REPOSITORY_URL}/releases`,
    };
  },
});
