import { definePage } from '@openelement/router';
import { trustedHtml, type TrustedHtml } from '@openelement/element';
import '@openelement/ui/open-code-block';
// Side-effect imports: the island modules the page composes must stay in the
// route module's graph so the build discovers them (the retired page-home
// component carried these; the route module is one directory deeper, so the
// specifiers gained a level).
import '../../islands/open-cinematic-scroll.tsx';
import '../../islands/open-dragon-live-gaze.tsx';
import '../../islands/open-hero-polish.tsx';
import { siteHead } from '#site-ui/head.ts';
import { contentLocale } from '#site-ui/locale.ts';
import { localizePath } from '#site-ui/link.ts';
import { homeStrings } from '../../site-ui/chrome-strings.ts';
import {
  diagramDsd,
  diagramElement,
  diagramIslands,
  diagramOutput,
} from '../../site-ui/diagrams.ts';
import {
  alphaLineNote,
  COMMON_PUBLISHED_NOTE,
  packageCountModifier,
  REGISTRY_NOTE,
} from '../../data/version.ts';
import { installCommand } from '../../data/_generated-install-command.ts';
import { homeHeroCodeHtml } from '../../data/_generated-page-code.ts';

const content = {
  en: {
    headTitle: 'openElement — The Web, composed.',
    headDescription:
      'OpenElement is a Web Components-native, static-first application framework built on Custom Elements, Declarative Shadow DOM and selective islands.',
    lede: 'A Web Components-native application framework — beautiful, static-first applications composed from real browser primitives.',
    heroMono: 'THE WEB,',
    heroSerif: 'composed.',
    sceneElementLead: 'One durable',
    sceneElementAccent: 'contract.',
    sceneElementCopy:
      'Custom Elements are the application component contract — not a renderer integration, not a leaf-widget format. Write the element once; it renders on the server and upgrades in the browser.',
    sceneDsdLead: 'The server writes HTML.',
    sceneDsdAccent: 'The browser upgrades it.',
    sceneDsdCopy:
      'DSD is a first-class server output — no client re-render, no double payload. The compiled default root is light DOM today; the markup is the application either way.',
    sceneIslandsLead: 'Upgrade',
    sceneIslandsAccent: 'selectively.',
    sceneIslandsCopy:
      'Interactive blocks hydrate on your schedule. Non-interactive blocks ship no JavaScript of their own.',
    sceneOutputLead: 'Static first.',
    sceneOutputAccent: 'Deployable anywhere.',
    startBuilding: 'Start building',
    watchUnfold: 'Watch it unfold',
    getStarted: 'Get started',
    readGuide: 'Read the guide',
    begin: 'Begin.',
    beginNote: `${alphaLineNote('en')}`,
    facts: 'Facts behind the feeling',
    continueComposition: 'Continue the composition.',
    referenceCopy:
      'Every number and claim on this page is sourced from the repository\u2019s release and measured-output truth.',
  },
  zh: {
    headTitle: 'openElement — 组合而生的 Web。',
    headDescription:
      'openElement 是一个 Web Components 原生、静态优先的应用框架，构建于 Custom Elements、Declarative Shadow DOM 与按需 islands 之上。',
    lede: 'Web Components 原生应用框架——用真实的浏览器原语，组合出美观的 static-first 应用。',
    heroMono: '组合而生的',
    heroSerif: 'Web。',
    sceneElementLead: '一份持久的',
    sceneElementAccent: '契约。',
    sceneElementCopy:
      'Custom Elements 是应用组件契约——不是渲染器集成，也不是叶子组件格式。元素只写一次：在服务端渲染，在浏览器中升级。',
    sceneDsdLead: '服务端写出 HTML。',
    sceneDsdAccent: '浏览器就地升级。',
    sceneDsdCopy:
      'DSD 是一等服务端输出——无客户端重渲染、无双重载荷。当前编译默认 root 为 light DOM；两种模式下标记即应用。',
    sceneIslandsLead: '按需',
    sceneIslandsAccent: '升级。',
    sceneIslandsCopy: '交互区域按你的节奏水合；非交互区域自身不携带任何 JavaScript。',
    sceneOutputLead: '静态优先。',
    sceneOutputAccent: '随处可部署。',
    startBuilding: '开始构建',
    watchUnfold: '看它展开',
    getStarted: '快速开始',
    readGuide: '阅读指南',
    begin: '开始。',
    beginNote: `${alphaLineNote('zh')}`,
    facts: '感觉背后的事实',
    continueComposition: '继续这场组合。',
    referenceCopy: '本页每个数字与声称都取自仓库的发布与实测输出真值。',
  },
} as const;

const strategies = {
  en: [
    {
      key: 'load',
      className: 'strategy',
      glyph: 'L',
      name: 'load',
      tag: '',
      copy: 'First-screen controls: imported and upgraded as early as possible.',
      uses: 'nav · search · theme',
    },
    {
      key: 'idle',
      className: 'strategy default',
      glyph: 'I',
      name: 'idle',
      tag: 'DEFAULT',
      copy: 'Non-critical interaction, scheduled after load.',
      uses: 'counters · forms',
    },
    {
      key: 'visible',
      className: 'strategy',
      glyph: 'V',
      name: 'visible',
      tag: '',
      copy: 'IntersectionObserver gates hydration until scroll-in.',
      uses: 'comments · charts',
    },
    {
      key: 'only',
      className: 'strategy',
      glyph: 'O',
      name: 'only',
      tag: '',
      copy: 'Client-only, for what the server cannot know.',
      uses: 'webgl · media',
    },
  ],
  zh: [
    {
      key: 'load',
      className: 'strategy',
      glyph: 'L',
      name: 'load',
      tag: '',
      copy: '首屏关键控件，尽早导入并升级。',
      uses: '导航 · 搜索 · 主题',
    },
    {
      key: 'idle',
      className: 'strategy default',
      glyph: 'I',
      name: 'idle',
      tag: '默认',
      copy: '非关键交互，在加载后调度。',
      uses: '计数器 · 表单',
    },
    {
      key: 'visible',
      className: 'strategy',
      glyph: 'V',
      name: 'visible',
      tag: '',
      copy: 'IntersectionObserver 把关，滚动进入视口才 hydrate。',
      uses: '评论 · 图表',
    },
    {
      key: 'only',
      className: 'strategy',
      glyph: 'O',
      name: 'only',
      tag: '',
      copy: '仅客户端，用于服务端无从知晓的部分。',
      uses: 'WebGL · 媒体',
    },
  ],
} as const;

const outputs = {
  en: [
    {
      key: 'browser',
      className: 'output-row',
      name: 'BROWSER',
      description: 'Pure static HTML + DSD. CDN-ready, no runtime.',
    },
    {
      key: 'node',
      className: 'output-row active',
      name: 'NODE',
      description:
        'WinterCG server entry, with an optional Nitro mount for Node and Workers deploys.',
    },
    {
      key: 'workers',
      className: 'output-row',
      name: 'WORKERS',
      description: 'Edge deploys from the same page model. Proof gate per release.',
    },
  ],
  zh: [
    {
      key: 'browser',
      className: 'output-row',
      name: 'BROWSER',
      description: '纯静态 HTML + DSD。可直接上 CDN，无运行时。',
    },
    {
      key: 'node',
      className: 'output-row active',
      name: 'NODE',
      description: 'WinterCG 服务端入口，Node 与 Workers 部署可选 Nitro mount。',
    },
    {
      key: 'workers',
      className: 'output-row',
      name: 'WORKERS',
      description: '同一页模型产出边缘部署，每次发布附证明门禁。',
    },
  ],
} as const;

const references = {
  en: [
    [
      '01',
      'Get started',
      '/guide/getting-started',
      'Create a real app from the supported public interface.',
    ],
    [
      '02',
      'API reference',
      '/reference',
      `Inspect the ${packageCountModifier('en')} surface and optional primitives.`,
    ],
    ['03', 'Architecture', '/architecture', 'Follow the element, app and build contracts.'],
    ['04', 'Roadmap', '/roadmap', 'See current truth and the next product boundary.'],
  ],
  zh: [
    ['01', '快速开始', '/guide/getting-started', '从受支持的公开接口创建一个真实应用。'],
    ['02', 'API 参考', '/reference', `检视${packageCountModifier('zh')}表面与可选原语。`],
    ['03', '架构', '/architecture', '沿 element、app 与 build 三层契约走一遍。'],
    ['04', '路线图', '/roadmap', '查看当前事实与下一个产品边界。'],
  ],
} as const;

/**
 * The marquee slogan, one spinner cycle long — the trailing ' ✳ ' keeps the
 * seam invisible. The page renders it TWICE (see `marqueeText` below): the
 * strip's animation is `transform: translateX(-50%)` (site-chrome.css
 * `@keyframes marquee`), so the animated span must measure exactly two copies
 * for the loop to restart seamlessly.
 *
 * Every honest reduction of the duplicate was checked and rejected:
 * - a `connectedCallback` clone cannot run — pages ship as static markup and
 *   no `index-index` element is ever defined client-side (verified in the
 *   built page: `customElements.get('index-index')` is undefined after load;
 *   the server function page form registers no page class at all);
 * - one copy plus a wider container does not loop: the keyframe's -50% would
 *   expose the strip's own blank tail every cycle;
 * - CSS-generated content (`::after { content: attr(...) }`) would take
 *   decorative text out of the document entirely, so text-only consumers
 *   would lose the phrase instead of seeing it once.
 *
 * The duplicate therefore stays in the source, and the container carries the
 * exclusion attributes (the marquee div's `data-nosnippet` for search-engine
 * snippets and `data-pagefind-ignore` for the site's own search index — both
 * measured, see that comment).
 */
const marquee = 'CUSTOM ELEMENTS ✳ DECLARATIVE SHADOW DOM ✳ ES MODULES ✳ SIGNALS ✳ HTML FIRST ✳ ';

/**
 * The home page as a server function page (alpha15 server architecture): the
 * route module's own exported TSX function, lowered by the compiler into a
 * generative HTML constructor. The page hook class (`page-home`) scopes the
 * former component sheet's authored rules in the linked document stylesheet
 * (www/site-chrome.css).
 *
 * Presentation is authored as Tailwind utilities on this markup (alpha15
 * utility-first migration). The strategy/output rows are keyed list Blocks,
 * and a list item's class attribute admits only a static literal or the
 * single `{row.<field>}` slot — the rows keep the projector's data-driven
 * `className` ('strategy'/'strategy default', 'output-row'/'output-row
 * active'), so their own boxes are authored on the `.strategies`/
 * `.output-rows` parents with `[&>*]`/`[&>.default]`/`[&>.active]`
 * child-selector utilities. The child styles the rows select on are authored
 * on the children themselves (`[.active_&]:`, `[&:nth-child(2n)]:`).
 *
 * The region hooks the kept rules in site-chrome.css and the site's e2e/axe
 * specs address (hero-main, hero-foot, action, hero-stage, spec-strip,
 * spec-cell, spec-fact, version-line, marquee, scene, scene-copy, scene-art,
 * scene-split, scene-outlined, flood, flood-panel, flood-arrow, strategy,
 * glyph, tag-default, output-row, links) stay in the class lists as hooks.
 */
export function PageHome(props: {
  lede: string;
  eyebrow: string;
  heroMono: string;
  heroSerif: string;
  versionLine: string;
  versionHref: string;
  enginesValue: string;
  depsValue: string;
  outputValue: string;
  badgeRuntime: string;
  badgeAuthoring: string;
  sceneElementIndex: string;
  sceneDsdIndex: string;
  sceneIslandsIndex: string;
  sceneOutputIndex: string;
  sceneBeginIndex: string;
  floodServer: string;
  floodBrowser: string;
  startBuilding: string;
  watchUnfold: string;
  getStarted: string;
  readGuide: string;
  begin: string;
  beginCommand: string;
  beginNote: string;
  facts: string;
  continueComposition: string;
  referenceCopy: string;
  commonVersionNote: string;
  marqueeText: string;
  sceneElementLead: string;
  sceneElementAccent: string;
  sceneElementCopy: string;
  sceneDsdLead: string;
  sceneDsdAccent: string;
  sceneDsdCopy: string;
  sceneIslandsLead: string;
  sceneIslandsAccent: string;
  sceneIslandsCopy: string;
  sceneOutputLead: string;
  sceneOutputAccent: string;
  startBuildingHref: string;
  getStartedHref: string;
  docsHref: string;
  heroCodeHtml: TrustedHtml;
  diagramElement: TrustedHtml;
  diagramDsd: TrustedHtml;
  diagramIslands: TrustedHtml;
  diagramOutput: TrustedHtml;
  strategies: Array<{
    key: string;
    className: string;
    glyph: string;
    name: string;
    tag: string;
    copy: string;
    uses: string;
  }>;
  outputs: Array<{ key: string; className: string; name: string; description: string }>;
  references: Array<{ index: string; title: string; href: string; copy: string }>;
}) {
  return (
    <div class='page-home overflow-clip bg-background text-foreground' data-pagefind-body>
      <open-cinematic-scroll></open-cinematic-scroll>
      <open-hero-polish></open-hero-polish>
      <section class='relative isolate overflow-clip bg-background @container/band'>
        <div class='hero-main relative grid min-h-[calc(100svh-var(--nav-height))] grid-rows-[auto_minmax(0,1fr)_auto] justify-items-center overflow-clip bg-(--hero-ink) text-center text-(--hero-paper)'>
          <div class='relative z-2 row-start-1 px-[clamp(1.5rem,5vw,4.5rem)] pt-[clamp(2rem,6vh,4rem)] translate-y-[calc(var(--hero-exit,0)*-64px)] opacity-[calc(1-var(--hero-exit,0)*1.15)]'>
            <p class='eyebrow flex items-center justify-center gap-3 font-mono text-(length:--text-xs) font-extrabold tracking-[.16em] text-(--hero-gold-muted) uppercase text-shadow-[0_1px_18px_rgba(0,0,0,.6)] min-[521px]:tracking-[.29em] [&:lang(zh)]:normal-case [&:lang(zh)]:tracking-[.08em] [&:lang(zh)]:leading-[1.9]'>
              {props.eyebrow}
            </p>
            <h1 class='mt-[clamp(1rem,2.5vh,1.75rem)] font-extrabold leading-[.92] tracking-[-.045em] text-shadow-[0_2px_40px_rgba(0,0,0,.65)]'>
              <span class='mono-line block font-mono text-[clamp(2.6rem,6.4vw,5.6rem)] text-(--hero-paper) [@media_(max-height:940px)_and_(min-width:700px)]:text-[clamp(2.6rem,5.6vw,4.8rem)]'>
                {props.heroMono}
              </span>{' '}
              <span class='serif-line -mt-[0.04em] block font-serif text-[clamp(3.2rem,8.8vw,7.4rem)] font-normal italic tracking-[-.02em] text-(--hero-gold) [@media_(max-height:940px)_and_(min-width:700px)]:text-[clamp(3.2rem,7.6vw,6.4rem)]'>
                {props.heroSerif}
              </span>
            </h1>
          </div>
          <div class='hero-stage absolute inset-0 z-0 translate-y-[calc(var(--hero-exit,0)*6%)] scale-[calc(1+var(--hero-exit,0)*.07)] opacity-[calc(1-var(--hero-exit,0)*.5)]'>
            <open-dragon-live-gaze></open-dragon-live-gaze>
          </div>
          <div class='hero-foot relative z-2 row-start-3 grid justify-items-center px-[clamp(1.5rem,5vw,4.5rem)] pt-0 pb-[clamp(1.5rem,5vh,3rem)] translate-y-[calc(var(--hero-exit,0)*-32px)] opacity-[calc(1-var(--hero-exit,0))]'>
            <p class='lede m-0 max-w-[36rem] text-[clamp(1rem,1.2vw,1.1rem)] leading-[1.75] text-[rgba(244,241,234,.92)] text-shadow-[0_1px_18px_rgba(0,0,0,.6)] [&:lang(zh)]:leading-[1.9]'>
              {props.lede}
            </p>
            <div class='actions mt-3 mb-0 flex flex-wrap justify-center gap-3'>
              <a
                class='action inline-flex items-center rounded-md border border-primary bg-primary px-5 py-2 font-bold text-primary-foreground no-underline transition-[border-color,background] duration-[150ms] ease-[ease] hover:border-[color-mix(in_srgb,var(--color-primary)_80%,var(--color-foreground))] hover:bg-[color-mix(in_srgb,var(--color-primary)_80%,var(--color-foreground))]'
                href={props.startBuildingHref}
              >
                {props.startBuilding}
              </a>
              <a
                class='action link inline-flex items-center rounded-md border border-transparent px-1 py-2 font-bold text-(--hero-gold-muted) underline decoration-[color-mix(in_srgb,currentColor_45%,transparent)] underline-offset-[calc(var(--spacing)*1)] transition-[border-color,background] duration-[150ms] ease-[ease] hover:text-(--hero-gold) hover:decoration-current'
                href='#element'
              >
                {props.watchUnfold}
              </a>
            </div>
            <span
              class='scroll-cue mt-2 grid justify-items-center gap-2 font-mono text-(length:--font-size-micro) tracking-[.34em] text-[rgba(244,241,234,.62)] uppercase indent-[.34em] [@media(max-height:760px)]:hidden [@media(max-width:520px)]:hidden'
              aria-hidden='true'
            >
              {'Scroll'}
            </span>
          </div>
        </div>
        <div class='spec-strip grid grid-cols-1 border-t border-border @min-[641px]/band:grid-cols-2 @min-[1081px]/band:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))]'>
          <div class='spec-cell flex min-w-0 flex-col justify-center gap-2 border-border border-s-0 px-[clamp(1rem,2.5vw,2rem)] py-4 [&:nth-child(n+2)]:border-t @min-[641px]/band:border-s @min-[641px]/band:[&:nth-child(odd)]:border-s-0 @min-[641px]/band:[&:nth-child(n+2)]:border-t-0 @min-[1081px]/band:[&:nth-child(odd):not(:first-child)]:border-s'>
            <a
              class='version-line block overflow-x-auto font-mono text-(length:--text-sm) font-bold text-foreground whitespace-nowrap no-underline underline-offset-[calc(var(--spacing)*1)] hover:text-primary hover:underline'
              href={props.versionHref}
              target='_blank'
              rel='noopener noreferrer'
            >
              {props.versionLine}
            </a>
            <small class='text-(length:--font-size-micro) leading-[1.4] text-muted-foreground'>
              {props.commonVersionNote}
            </small>
          </div>
          <div class='spec-cell flex min-w-0 flex-col justify-center gap-2 border-border border-s-0 px-[clamp(1rem,2.5vw,2rem)] py-4 [&:nth-child(n+2)]:border-t @min-[641px]/band:border-s @min-[641px]/band:[&:nth-child(odd)]:border-s-0 @min-[641px]/band:[&:nth-child(n+2)]:border-t-0 @min-[1081px]/band:[&:nth-child(odd):not(:first-child)]:border-s'>
            <p class='spec-fact m-0 text-(length:--text-sm) font-semibold leading-[1.4] text-foreground [&:lang(zh)]:leading-[1.9]'>
              {props.enginesValue}
            </p>
          </div>
          <div class='spec-cell flex min-w-0 flex-col justify-center gap-2 border-border border-s-0 px-[clamp(1rem,2.5vw,2rem)] py-4 [&:nth-child(n+2)]:border-t @min-[641px]/band:border-s @min-[641px]/band:[&:nth-child(odd)]:border-s-0 @min-[641px]/band:[&:nth-child(n+2)]:border-t-0 @min-[1081px]/band:[&:nth-child(odd):not(:first-child)]:border-s'>
            <p class='spec-fact m-0 text-(length:--text-sm) font-semibold leading-[1.4] text-primary [&:lang(zh)]:leading-[1.9]'>
              {props.depsValue}
            </p>
          </div>
          <div class='spec-cell flex min-w-0 flex-col justify-center gap-2 border-border border-s-0 px-[clamp(1rem,2.5vw,2rem)] py-4 [&:nth-child(n+2)]:border-t @min-[641px]/band:border-s @min-[641px]/band:[&:nth-child(odd)]:border-s-0 @min-[641px]/band:[&:nth-child(n+2)]:border-t-0 @min-[1081px]/band:[&:nth-child(odd):not(:first-child)]:border-s'>
            <p class='spec-fact m-0 text-(length:--text-sm) font-semibold leading-[1.4] text-foreground [&:lang(zh)]:leading-[1.9]'>
              {props.outputValue}
            </p>
          </div>
        </div>
        {/* `marqueeText` carries the slogan twice by construction (the
            translateX(-50%) seam math — www/app/routes/index/index.tsx), so
            the container shields the duplicate from text consumers:
            `data-nosnippet` keeps search-engine snippets from echoing the
            phrase twice, and `data-pagefind-ignore` keeps it out of the
            site's own search index (the repo's chrome convention — measured:
            pagefind indexes the doubled phrase without it and drops it with
            it; data-nosnippet/aria-hidden alone do not). The page is
            runtime-free, so nothing can clone the second copy at run time;
            aria-hidden keeps it out of the a11y tree. */}
        <div
          class='marquee overflow-hidden border-y border-border bg-(--surface-1) whitespace-nowrap'
          aria-hidden='true'
          data-nosnippet
          data-pagefind-ignore
        >
          <span class='inline-block py-3 font-medium tracking-[.12em] text-(length:--text-sm) text-primary'>
            {props.marqueeText}
          </span>
        </div>
      </section>

      <section
        class='scene scene-split relative grid grid-cols-1 items-center gap-[clamp(2rem,6vw,6rem)] px-[clamp(1.5rem,5vw,4.5rem)] py-[clamp(4rem,10vh,8rem)] @container/band min-[901px]:grid-cols-[minmax(0,.9fr)_minmax(0,1.1fr)]'
        id='element'
      >
        <span
          class='scene-outlined pointer-events-none absolute left-[clamp(-.5rem,-.4vw,0rem)] top-[clamp(1rem,4vh,3rem)] z-[-1] font-mono text-[clamp(9rem,18vw,16rem)] font-extrabold leading-none text-transparent select-none'
          aria-hidden='true'
        >
          {'01'}
        </span>
        <div class='scene-copy max-w-[34rem] leading-[1.75] text-muted-foreground [&_p+p]:mt-3'>
          <p class='text-(length:--text-xs) font-extrabold tracking-[.24em] text-primary uppercase [&:lang(zh)]:normal-case [&:lang(zh)]:tracking-[.08em] [&:lang(zh)]:leading-[1.9]'>
            {props.sceneElementIndex}
          </p>
          <figure
            class='my-3 text-muted-foreground [&_svg]:block [&_svg]:h-[72px] [&_svg]:w-auto'
            aria-hidden='true'
          >
            <div innerHTML={props.diagramElement} trustedHtml />
          </figure>
          <h2 class='text-[clamp(2.2rem,3.6vw,3.2rem)] font-extrabold leading-none tracking-[-.03em]'>
            {props.sceneElementLead}
            <span class='block font-serif text-[1.15em] font-normal italic text-primary'>
              {props.sceneElementAccent}
            </span>
          </h2>
          <p class='[&:lang(zh)]:leading-[1.9]'>{props.sceneElementCopy}</p>
          <div class='mt-5 flex flex-wrap gap-2'>
            <span class='min-w-0 rounded-md border border-(--border-strong) px-2 py-[2px] text-(length:--text-xs) font-bold tracking-[.06em] text-primary'>
              {props.badgeRuntime}
            </span>
            <span class='min-w-0 rounded-md border border-(--border-strong) px-2 py-[2px] text-(length:--text-xs) font-bold tracking-[.06em] text-primary'>
              {props.badgeAuthoring}
            </span>
          </div>
        </div>
        <div class='scene-art min-w-0'>
          <open-code-block>
            <div innerHTML={props.heroCodeHtml} trustedHtml />
          </open-code-block>
        </div>
      </section>

      <section class='scene flood relative isolate overflow-clip bg-[linear-gradient(135deg,var(--color-primary),var(--color-secondary-foreground))] text-primary-foreground px-[clamp(1.5rem,5vw,4.5rem)] py-[clamp(4rem,10vh,8rem)] @container/band'>
        <div class='flex items-center justify-between gap-4'>
          <p class='text-(length:--text-xs) font-extrabold tracking-[.24em] text-secondary uppercase [&:lang(zh)]:normal-case [&:lang(zh)]:tracking-[.08em] [&:lang(zh)]:leading-[1.9]'>
            {props.sceneDsdIndex}
          </p>
          <figure
            class='m-0 text-muted-foreground [&_svg]:block [&_svg]:h-[72px] [&_svg]:w-auto'
            aria-hidden='true'
          >
            <div innerHTML={props.diagramDsd} trustedHtml />
          </figure>
        </div>
        <h2 class='text-[clamp(2.2rem,3.6vw,3.2rem)] font-extrabold leading-none tracking-[-.03em]'>
          {props.sceneDsdLead}
          <span class='block font-serif text-[1.15em] font-normal italic text-violet-300'>
            {props.sceneDsdAccent}
          </span>
        </h2>
        <div class='scene-copy max-w-[34rem] leading-[1.75] text-secondary [&_p+p]:mt-3'>
          <p class='[&:lang(zh)]:leading-[1.9]'>{props.sceneDsdCopy}</p>
        </div>
        <div class='mt-[clamp(2rem,5vh,3.5rem)] grid grid-cols-1 items-center gap-[clamp(1rem,3vw,2.5rem)] min-[901px]:grid-cols-[1fr_auto_1fr]'>
          <div class='flood-panel rounded-lg border-[1.5px] border-[color-mix(in_srgb,var(--color-primary-foreground)_70%,transparent)] bg-[color-mix(in_srgb,var(--color-primary-foreground)_8%,transparent)] p-5'>
            <small class='mb-3 block text-(length:--font-size-micro) font-bold tracking-[.14em] uppercase'>
              {props.floodServer}
            </small>
            <code class='block text-(length:--text-xs) leading-[1.8] whitespace-pre'>
              {`<open-counter count="0">
  <template shadowrootmode="open">
    <button>0</button>
  </template>`}
            </code>
          </div>
          <span
            class='flood-arrow rotate-90 justify-self-center text-(length:--text-5xl) text-primary-foreground min-[901px]:rotate-0 min-[901px]:justify-self-auto'
            aria-hidden='true'
          >
            {'⟶'}
          </span>
          <div class='flood-panel solid rounded-lg border-[1.5px] border-primary-foreground bg-primary-foreground p-5 text-violet-950'>
            <small class='mb-3 block text-(length:--font-size-micro) font-bold tracking-[.14em] uppercase'>
              {props.floodBrowser}
            </small>
            <span class='mb-2 inline-block rounded-md border-[1.5px] border-dashed border-primary px-3 py-1 text-(length:--text-xs) text-primary'>
              #shadow-root (open)
            </span>
            <code class='block text-(length:--text-xs) leading-[1.8] whitespace-pre'>
              {`└─ <button> → markup available/readable
   upgrade → signals/handlers bound`}
            </code>
          </div>
        </div>
      </section>

      <section class='scene relative px-[clamp(1.5rem,5vw,4.5rem)] py-[clamp(4rem,10vh,8rem)] @container/band'>
        <div class='flex items-center justify-between gap-4'>
          <p class='text-(length:--text-xs) font-extrabold tracking-[.24em] text-primary uppercase [&:lang(zh)]:normal-case [&:lang(zh)]:tracking-[.08em] [&:lang(zh)]:leading-[1.9]'>
            {props.sceneIslandsIndex}
          </p>
          <figure
            class='m-0 text-muted-foreground [&_svg]:block [&_svg]:h-[72px] [&_svg]:w-auto'
            aria-hidden='true'
          >
            <div innerHTML={props.diagramIslands} trustedHtml />
          </figure>
        </div>
        <h2 class='text-[clamp(2.2rem,3.6vw,3.2rem)] font-extrabold leading-none tracking-[-.03em]'>
          {props.sceneIslandsLead}
          <span class='block font-serif text-[1.15em] font-normal italic text-primary'>
            {props.sceneIslandsAccent}
          </span>
        </h2>
        <div class='scene-copy max-w-[34rem] leading-[1.75] text-muted-foreground [&_p+p]:mt-3'>
          <p class='[&:lang(zh)]:leading-[1.9]'>{props.sceneIslandsCopy}</p>
        </div>
        <div class='mt-[clamp(2rem,5vh,3rem)] grid grid-cols-1 border-y border-border @min-[641px]/band:grid-cols-2 @min-[1081px]/band:grid-cols-[repeat(4,1fr)] [&>*]:border-s-0 [&>*]:border-border [&>*]:px-4 [&>*]:py-5 [&>*:first-child]:border-s-0 [&>*:nth-child(n+2)]:border-t [&>.default]:bg-primary/14 @min-[641px]/band:[&>*]:border-s @min-[641px]/band:[&>*:first-child]:border-s-0 @min-[641px]/band:[&>*:nth-child(3)]:border-s-0 @min-[641px]/band:[&>*:nth-child(n+2)]:border-t-0 @min-[1081px]/band:[&>*:nth-child(3)]:border-s'>
          {props.strategies.map((strategy) => (
            <div key={strategy.key} class={strategy.className}>
              <span
                class='glyph block font-mono text-[clamp(3.5rem,7vw,6.5rem)] font-extrabold leading-none text-transparent'
                aria-hidden='true'
              >
                {strategy.glyph}
              </span>
              <strong class='mt-3 block text-(length:--text-xl) font-extrabold'>
                {strategy.name}
                <span class='tag-default ms-2 inline-block rounded-md bg-primary px-2 py-[1px] align-middle text-(length:--font-size-micro) font-bold tracking-[.1em] text-primary-foreground'>
                  {strategy.tag}
                </span>
              </strong>
              <p class='mt-2 text-(length:--text-xs) leading-[1.6] text-muted-foreground'>
                {strategy.copy}
              </p>
              <footer class='mt-3 text-(length:--font-size-micro) text-muted-foreground'>
                {strategy.uses}
              </footer>
            </div>
          ))}
        </div>
      </section>

      <section class='scene relative px-[clamp(1.5rem,5vw,4.5rem)] py-[clamp(4rem,10vh,8rem)] @container/band'>
        <div class='flex items-center justify-between gap-4'>
          <p class='text-(length:--text-xs) font-extrabold tracking-[.24em] text-primary uppercase [&:lang(zh)]:normal-case [&:lang(zh)]:tracking-[.08em] [&:lang(zh)]:leading-[1.9]'>
            {props.sceneOutputIndex}
          </p>
          <figure
            class='m-0 text-muted-foreground [&_svg]:block [&_svg]:h-[72px] [&_svg]:w-auto'
            aria-hidden='true'
          >
            <div innerHTML={props.diagramOutput} trustedHtml />
          </figure>
        </div>
        <h2 class='text-[clamp(2.2rem,3.6vw,3.2rem)] font-extrabold leading-none tracking-[-.03em]'>
          {props.sceneOutputLead}
          <span class='block font-serif text-[1.15em] font-normal italic text-primary'>
            {props.sceneOutputAccent}
          </span>
        </h2>
        <div class='mt-[clamp(2rem,5vh,3rem)] border-t border-border [&>*]:grid [&>*]:grid-cols-1 [&>*]:items-center [&>*]:gap-2 [&>*]:border-b [&>*]:border-border [&>*]:px-[clamp(1rem,3vw,2.5rem)] [&>*]:py-4 [&>.active]:bg-primary [&>.active]:text-primary-foreground min-[769px]:[&>*]:grid-cols-[minmax(0,1fr)_auto_auto] min-[769px]:[&>*]:gap-[clamp(1rem,4vw,3rem)]'>
          {props.outputs.map((output) => (
            <div key={output.key} class={output.className}>
              <span class='text-[clamp(2.2rem,4vw,3.5rem)] font-extrabold leading-none tracking-[-.02em]'>
                {output.name}
              </span>
              <span class='max-w-[22rem] text-(length:--text-xs) leading-[1.6] text-muted-foreground [.active_&]:text-primary-foreground'>
                {output.description}
              </span>
              <span
                class='hidden text-(length:--text-6xl) text-ring min-[769px]:inline [.active_&]:text-primary-foreground'
                aria-hidden='true'
              >
                →
              </span>
            </div>
          ))}
        </div>
      </section>

      <section class='scene relative px-[clamp(1.5rem,5vw,4.5rem)] py-[clamp(5rem,12vh,9rem)] text-center @container/band'>
        <p class='text-(length:--text-xs) font-extrabold tracking-[.24em] text-primary uppercase [&:lang(zh)]:normal-case [&:lang(zh)]:tracking-[.08em] [&:lang(zh)]:leading-[1.9]'>
          {props.sceneBeginIndex}
        </p>
        <h2 class='font-serif text-[clamp(4rem,8vw,7rem)] font-normal italic leading-none tracking-[-.03em] text-primary'>
          {props.begin}
        </h2>
        <div class='mt-6 inline-flex items-center gap-4 rounded-lg border border-border bg-(--surface-code) px-5 py-3 text-(--surface-code-foreground) text-(length:--text-sm)'>
          <code class='text-success'>$</code>
          <span>{props.beginCommand}</span>
        </div>
        <p class='mx-auto mt-3 mb-0 max-w-[32rem] text-(length:--text-xs) leading-[1.6] text-muted-foreground'>
          {props.beginNote}
        </p>
        <div class='actions mt-6 mb-0 flex flex-wrap justify-center gap-3'>
          <a
            class='action inline-flex items-center rounded-md border border-primary bg-primary px-5 py-2 font-bold text-primary-foreground no-underline transition-[border-color,background] duration-[150ms] ease-[ease] hover:bg-[color-mix(in_srgb,var(--color-primary)_80%,var(--color-foreground))]'
            href={props.getStartedHref}
          >
            {props.getStarted}
          </a>
          <a
            class='action inline-flex items-center rounded-md border border-(--border-strong) px-5 py-2 font-bold text-foreground no-underline transition-[border-color,background] duration-[150ms] ease-[ease] hover:border-primary'
            href={props.docsHref}
          >
            {props.readGuide}
          </a>
        </div>
      </section>

      <section class='border-t border-border px-[clamp(1.5rem,5vw,4.5rem)] py-[clamp(3rem,8vh,6rem)]'>
        <header class='mb-6 flex items-end justify-between gap-8'>
          <div>
            <p class='text-(length:--text-xs) font-extrabold tracking-[.24em] text-primary uppercase [&:lang(zh)]:normal-case [&:lang(zh)]:tracking-[.08em] [&:lang(zh)]:leading-[1.9]'>
              {props.facts}
            </p>
            <h2 class='text-[clamp(2rem,4vw,4rem)] leading-none tracking-[-.04em]'>
              {props.continueComposition}
            </h2>
          </div>
          <p class='max-w-[30rem] leading-[1.5] text-muted-foreground'>{props.referenceCopy}</p>
        </header>
        <div class='links grid grid-cols-1 border border-border min-[521px]:grid-cols-2 min-[1201px]:grid-cols-4'>
          {props.references.map((reference) => (
            <a
              key={reference.href}
              class='grid min-h-40 gap-2 border-b border-border p-5 text-inherit no-underline transition-[background,transform] duration-[200ms] ease-[ease] bg-popover/55 hover:-translate-y-1 hover:bg-[color-mix(in_srgb,var(--color-ring)_18%,var(--color-popover))] [&:last-child]:border-b-0 min-[521px]:border-e min-[521px]:border-b-0 [&:nth-child(2n)]:border-e-0 min-[1201px]:[&:nth-child(2n):not(:last-child)]:border-e'
              href={reference.href}
            >
              <span
                class='font-mono text-(length:--text-4xl) font-extrabold leading-none text-transparent'
                aria-hidden='true'
              >
                {reference.index}
              </span>
              <strong class='text-(length:--text-xl)'>{reference.title}</strong>
              <small class='leading-[1.4] text-muted-foreground'>{reference.copy}</small>
            </a>
          ))}
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
    const { headTitle: _headTitle, headDescription: _headDescription, ...copy } = content[resolved];
    // The version block is the per-package version table (T7): one entry
    // per package from the release-state registry projection, on one nowrap
    // row. It never claims a shared "one version" line — packages may ride
    // different versions after the per-package split, and the table shows it
    // with no further code change. The link target stays the per-package npm
    // view command's subject — the package name is the line's stable anchor,
    // while each version shown beside it moves with its own release.
    const versionLine = REGISTRY_NOTE;
    return {
      ...copy,
      ...homeStrings(resolved),
      // The begin-scene command is the create CLI's canonical string (#1414):
      // the page renders the generated module, never a copy of the flags.
      beginCommand: installCommand,
      // The hero code block is pre-highlighted by the shared site highlighter
      // (lib/markdown.ts via generate:content) — never a JSX copy. The four
      // diagrams are the site-ui SVG strings, branded here (the one place a
      // page may hand raw markup to the trustedHtml sink).
      heroCodeHtml: trustedHtml(homeHeroCodeHtml),
      diagramElement: trustedHtml(diagramElement),
      diagramDsd: trustedHtml(diagramDsd),
      diagramIslands: trustedHtml(diagramIslands),
      diagramOutput: trustedHtml(diagramOutput),
      versionLine,
      versionHref: 'https://www.npmjs.com/package/@openelement/element',
      commonVersionNote: COMMON_PUBLISHED_NOTE(resolved),
      // Two copies by construction — the translateX(-50%) keyframe's seam
      // math (see the `marquee` constant above).
      marqueeText: marquee + marquee,
      startBuildingHref: localizePath('/guide/getting-started', resolved),
      getStartedHref: localizePath('/guide/getting-started', resolved),
      docsHref: localizePath('/docs', resolved),
      strategies: [...strategies[resolved]],
      outputs: [...outputs[resolved]],
      references: references[resolved].map(([index, title, href, copy]) => ({
        index,
        title,
        href: localizePath(href, resolved),
        copy,
      })),
    };
  },
});
