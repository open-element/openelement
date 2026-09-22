import { definePage } from '@openelement/router';
import { siteHead } from '@openelement/site-ui/head.ts';
import { contentLocale } from '@openelement/site-ui/locale.ts';
import { localizePath } from '@openelement/site-ui/link.ts';
import PageHome from '../../components/page-home.tsx';
import { homeStrings } from '../../site-ui/chrome-strings.ts';
import {
  diagramDsd,
  diagramElement,
  diagramIslands,
  diagramOutput,
} from '../../site-ui/diagrams.ts';
import { alphaLineNote, COMMON_PUBLISHED_NOTE, REGISTRY_NOTE } from '../../data/version.ts';
import { installCommand } from '../../data/_generated-install-command.ts';

const content = {
  en: {
    headTitle: 'openElement — The Web, composed.',
    headDescription:
      'OpenElement is a Web Components-native, static-first application framework built on Custom Elements, Declarative Shadow DOM and selective islands.',
    lede:
      'A Web Components-native application framework — beautiful, static-first applications composed from real browser primitives.',
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
      'Interactive regions hydrate on your schedule. Non-interactive regions ship no JavaScript of their own.',
    sceneOutputLead: 'Static first.',
    sceneOutputAccent: 'Deployable anywhere.',
    startBuilding: 'Start building',
    watchUnfold: 'Watch it unfold',
    getStarted: 'Get started',
    readGuide: 'Read the guide',
    specVersion: 'Version',
    specGraph: 'Graph',
    specEngines: 'CI engines',
    specDeps: 'Framework deps',
    specOutput: 'Server output',
    begin: 'Begin.',
    beginNote: `${
      alphaLineNote('en')
    } --minimum-dependency-age 0 keeps same-day compatible patches installable despite Deno's default ~24h minimumDependencyAge.`,
    facts: 'Facts behind the feeling',
    continueComposition: 'Continue the composition.',
    referenceCopy:
      'Every number and claim on this page is sourced from the repository\u2019s release and benchmark truth.',
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
    specVersion: '版本',
    specGraph: '包图',
    specEngines: 'CI 引擎',
    specDeps: '框架依赖',
    specOutput: '服务端输出',
    begin: '开始。',
    beginNote: `${
      alphaLineNote('zh')
    } --minimum-dependency-age 0 可绕过 Deno 默认约 24 小时的 minimumDependencyAge，使当天发布的兼容补丁仍可安装。`,
    facts: '感觉背后的事实',
    continueComposition: '继续这场组合。',
    referenceCopy: '本页每个数字与声称都取自仓库的发布与基准真值。',
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
  ],
  zh: [
    {
      key: 'load',
      className: 'strategy',
      glyph: 'L',
      name: 'load',
      tag: '',
      copy: '关键交互，解析完成后立即 hydrate。',
      uses: '导航 · 搜索 · 主题',
    },
    {
      key: 'idle',
      className: 'strategy default',
      glyph: 'I',
      name: 'idle',
      tag: '默认',
      copy: '浏览器空闲时升级——绝不阻塞绘制。',
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
        'Nitro server output. Static-first delivery with a generated request-time entry for dynamic routes.',
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
      description: 'Nitro 服务端输出。静态优先分发，动态路由由生成的请求时入口承接。',
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
      'Inspect the four-package surface and optional primitives.',
    ],
    [
      '03',
      'Architecture',
      '/architecture',
      'Follow the element, app and build contracts.',
    ],
    ['04', 'Roadmap', '/roadmap', 'See current truth and the next product boundary.'],
  ],
  zh: [
    ['01', '快速开始', '/guide/getting-started', '从受支持的公开接口创建一个真实应用。'],
    ['02', 'API 参考', '/reference', '检视四包表面与可选原语。'],
    ['03', '架构', '/architecture', '沿 element、app 与 build 三层契约走一遍。'],
    ['04', '路线图', '/roadmap', '查看当前事实与下一个产品边界。'],
  ],
} as const;

const marquee = 'CUSTOM ELEMENTS ✳ DECLARATIVE SHADOW DOM ✳ ES MODULES ✳ SIGNALS ✳ HTML FIRST ✳ ';

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
      ...homeStrings(resolved),
      // The begin-scene command is the create CLI's canonical string (#1414):
      // the page renders the generated module, never a copy of the flags.
      beginCommand: installCommand,
      registryNote: REGISTRY_NOTE,
      commonVersionNote: COMMON_PUBLISHED_NOTE(resolved),
      marqueeText: marquee + marquee,
      startBuildingHref: localizePath('/guide/getting-started', resolved),
      getStartedHref: localizePath('/guide/getting-started', resolved),
      docsHref: localizePath('/docs', resolved),
      strategies: [...strategies[resolved]],
      outputs: [...outputs[resolved]],
      diagrams: {
        element: diagramElement,
        dsd: diagramDsd,
        islands: diagramIslands,
        output: diagramOutput,
      },
      references: references[resolved].map(([index, title, href, copy]) => ({
        index,
        title,
        href: localizePath(href, resolved),
        copy,
      })),
    };
  },
});
