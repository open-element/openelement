import { definePage } from '@openelement/router';
import { trustedHtml, type TrustedHtml } from '@openelement/element';
import '@openelement/ui/open-code-block';
import '../../islands/open-counter.tsx';
import { siteHead } from '#site-ui/head.ts';
import { contentLocale } from '#site-ui/locale.ts';
import { siteHref } from '#site-ui/site-url.ts';
import { CURRENT_ALPHA_VERSION, OPENELEMENT_VERSION } from '../../data/version.ts';
import { installCommand } from '../../data/_generated-install-command.ts';
import { SOURCE_LINE_PUBLISHED } from '../../data/_generated-release-line.ts';
import { homeHeroCodeHtml } from '../../data/_generated-page-code.ts';

const content = {
  en: {
    headTitle: 'openElement — The Web Components framework',
    headDescription:
      'OpenElement is a Web Components-native framework for static-first apps. Render HTML on the server and choose which components hydrate.',
    title: 'Build with',
    titleAccent: 'the browser.',
    description:
      'OpenElement is a static-first application framework for native Web Components. Render HTML on the server and add JavaScript where you need interactivity.',
    release: 'npm prerelease',
    start: 'Start building',
    docs: 'Read the docs',
    example: 'Interactive island',
    sourcePreview: 'Source preview',
    exampleNote: 'Try the live counter',
    counterLabel: 'Count:',
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
    gettingStarted: 'Getting started',
    reference: 'API reference',
    deployment: 'Deployment guide',
  },
  zh: {
    headTitle: 'openElement — 原生 Web Components 应用框架',
    headDescription:
      'OpenElement 是一个基于原生 Web Components 的静态优先应用框架。在服务端生成 HTML，按组件选择何时激活交互。',
    title: '用浏览器原生能力',
    titleAccent: '构建应用。',
    description:
      'OpenElement 是一个基于原生 Web Components 的静态优先应用框架。在服务端生成 HTML，按组件选择何时激活交互。',
    release: 'npm 预发布',
    start: '开始构建',
    docs: '阅读文档',
    example: '交互岛示例',
    sourcePreview: '源码预览',
    exampleNote: '试试实时计数器',
    counterLabel: '计数：',
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
          '可在构建时预渲染页面，也可按请求渲染。Shadow root 可以声明式 Shadow DOM 的形式随 HTML 发送。',
        link: '了解渲染机制',
        href: '/architecture/dsd/',
      },
      {
        label: '激活',
        title: '按需加载 JavaScript',
        description: '按交互岛配置激活时机：页面加载时、浏览器空闲时，或滚动进入视口时。',
        link: '了解交互岛',
        href: '/guide/islands-and-ssr/',
      },
    ],
    nextTitle: '开始上手',
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
  start: string;
  docs: string;
  command: string;
  example: string;
  exampleNote: string;
  counterLabel: string;
  code: TrustedHtml;
  featuresTitle: string;
  featuresDescription: string;
  steps: Array<{ label: string; title: string; description: string; link: string; href: string }>;
  nextTitle: string;
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
      <section class='home-hero' aria-labelledby='home-title'>
        <div class='home-width home-hero-grid'>
          <div class='home-intro'>
            <a class='home-release' href={props.changelogHref}>
              <span class='home-release-dot' aria-hidden='true'></span>
              {props.release}
              <span class='home-release-version'>{props.version}</span>
            </a>
            <h1 id='home-title'>
              {props.title} <span>{props.titleAccent}</span>
            </h1>
            <p class='home-description'>{props.description}</p>
            <div class='home-actions'>
              <a class='home-primary' href={props.startHref}>
                {props.start}
                <span aria-hidden='true'>→</span>
              </a>
              <a class='home-secondary' href={props.docsHref}>
                {props.docs}
              </a>
            </div>
            <p class='home-command'>
              <span aria-hidden='true'>$</span>
              <code>{props.command}</code>
            </p>
          </div>
          <figure class='home-example'>
            <figcaption>
              <span>{props.exampleNote}</span>
              <open-counter label={props.counterLabel}></open-counter>
            </figcaption>
            <div class='home-editor'>
              <div class='home-editor-heading'>
                <span class='home-file'>{'open-counter.tsx'}</span>
                <span class='home-editor-label'>{props.example}</span>
              </div>
              <open-code-block>
                <div innerHTML={props.code} trustedHtml />
              </open-code-block>
            </div>
          </figure>
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
                <span aria-hidden='true'>↗</span>
              </a>
            </li>
          ))}
        </ol>
      </section>

      <section class='home-next' id='begin' aria-labelledby='home-next-title'>
        <div class='home-width home-next-grid'>
          <div>
            <h2 id='home-next-title'>{props.nextTitle}</h2>
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
      example,
      sourcePreview,
      ...copy
    } = content[resolved];
    return {
      ...copy,
      steps: steps.map((step) => ({ ...step, href: siteHref(step.href, resolved) })),
      version: CURRENT_ALPHA_VERSION,
      command: installCommand,
      example: SOURCE_LINE_PUBLISHED ? example : `${sourcePreview} · ${OPENELEMENT_VERSION}`,
      code: trustedHtml(homeHeroCodeHtml),
      startHref: siteHref('/guide/getting-started', resolved),
      docsHref: siteHref('/docs', resolved),
      referenceHref: siteHref('/reference', resolved),
      deploymentHref: siteHref('/guide/deployment', resolved),
      changelogHref: siteHref('/changelog', resolved),
    };
  },
});
