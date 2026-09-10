import { definePage } from '@openelement/app';
import { siteHead } from '@openelement/site-ui/head.ts';
import { contentLocale } from '@openelement/site-ui/locale.ts';
import { localizePath } from '@openelement/site-ui/link.ts';
import PageHome from '../../components/page-home.tsx';
import { PUBLISHED_PACKAGE_VERSION, PUBLISHED_STABLE_VERSION } from '../../data/version.ts';

const content = {
  en: {
    headTitle: 'openElement — The Web, composed.',
    headDescription:
      'OpenElement is a Web Components-native, static-first application framework built on Custom Elements, Declarative Shadow DOM and selective islands.',
    lede:
      'A Web Components-native application framework — beautiful, static-first applications composed from real browser primitives.',
    startBuilding: 'Start building',
    watchUnfold: 'Watch it unfold',
    getStarted: 'Get started',
    readGuide: 'Read the guide',
    specVersion: 'Version',
    specGraph: 'Graph',
    specEngines: 'Engines',
    specDeps: 'Framework deps',
    specOutput: 'Server output',
    begin: 'Begin.',
    beginNote:
      `The default dist-tag is stable ${PUBLISHED_STABLE_VERSION}; --minimum-dependency-age 0 keeps same-day compatible patches installable despite Deno's default ~24h minimumDependencyAge.`,
    facts: 'Facts behind the feeling',
    continueComposition: 'Continue the composition.',
    referenceCopy:
      'Every scene is grounded in the public product surface, architecture and release truth — not a decorative fiction.',
  },
  zh: {
    headTitle: 'openElement — 组合而生的 Web。',
    headDescription:
      'openElement 是一个 Web Components 原生、静态优先的应用框架，构建于 Custom Elements、Declarative Shadow DOM 与按需 islands 之上。',
    lede: 'Web Components 原生应用框架——用真实的浏览器原语，组合出美观的 static-first 应用。',
    startBuilding: '开始构建',
    watchUnfold: '看它展开',
    getStarted: '快速开始',
    readGuide: '阅读指南',
    specVersion: '版本',
    specGraph: '包图',
    specEngines: '浏览器引擎',
    specDeps: '框架依赖',
    specOutput: '服务端输出',
    begin: '开始。',
    beginNote:
      `默认 dist-tag 即稳定版 ${PUBLISHED_STABLE_VERSION}；--minimum-dependency-age 0 可绕过 Deno 默认约 24 小时的 minimumDependencyAge，使当天发布的兼容补丁仍可安装。`,
    facts: '感觉背后的事实',
    continueComposition: '继续这场组合。',
    referenceCopy: '每一个场景都立足于公开产品面、架构与发布真相——不是装饰性的虚构。',
  },
} as const;

const strategies = [
  {
    key: 'load',
    className: 'strategy',
    glyph: 'L',
    name: 'load',
    tag: '',
    copy: 'Critical interactivity, hydrated immediately after parse.',
    uses: 'nav · search · theme',
  },
  {
    key: 'idle',
    className: 'strategy default',
    glyph: 'I',
    name: 'idle',
    tag: 'DEFAULT',
    copy: 'Upgrades when the browser is idle — never blocks paint.',
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
];

const outputs = [
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
      'Nitro server output. Static-first delivery with a generated request-time entry for dynamic routes.',
  },
  {
    key: 'workers',
    className: 'output-row',
    name: 'WORKERS',
    description: 'Edge deploys from the same page model. Proof gate per release.',
  },
];

const references = [
  [
    '01',
    'Get started',
    '/guide/getting-started',
    'Create a real app from the supported public interface.',
  ],
  ['02', 'API reference', '/apilist', 'Inspect the five-package surface and optional primitives.'],
  [
    '03',
    'Architecture',
    '/architecture/architecture',
    'Follow the element, app and build contracts.',
  ],
  ['04', 'Roadmap', '/roadmap', 'See current truth and the next product boundary.'],
] as const;

const marquee =
  'CUSTOM ELEMENTS ✳ SHADOW DOM ✳ DECLARATIVE SHADOW DOM ✳ ES MODULES ✳ SIGNALS ✳ HTML FIRST ✳ ';

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
    return {
      ...copy,
      stableVersion: PUBLISHED_STABLE_VERSION,
      packageVersion: PUBLISHED_PACKAGE_VERSION,
      marqueeText: marquee + marquee,
      startBuildingHref: localizePath('/guide/getting-started', resolved),
      getStartedHref: localizePath('/guide/getting-started', resolved),
      docsHref: localizePath('/docs', resolved),
      strategies,
      outputs,
      references: references.map(([index, title, href, copy]) => ({
        index,
        title,
        href: localizePath(href, resolved),
        copy,
      })),
    };
  },
});
