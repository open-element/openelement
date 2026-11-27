import { definePage } from '@openelement/router';
import '@openelement/ui/open-button';
import { siteHead } from '#site-ui/head.ts';
import { contentLocale } from '#site-ui/locale.ts';
import { siteHref } from '#site-ui/site-url.ts';
import '#site-ui/open-reading-shell.tsx';
import { CURRENT_ALPHA_VERSION, OPENELEMENT_VERSION, PUBLISHED_LATEST } from '../data/version.ts';

export const meta = { section: '', label: 'Changelog', order: 20 };

const releaseNotesUrl = 'https://github.com/open-element/openelement/releases';

const registryStateUrl =
  'https://github.com/open-element/openelement/blob/main/docs/release/release-state.json';

const content = {
  en: {
    title: 'Changelog',
    description:
      'See what changed in past releases and check which versions are available on npm and in the source checkout.',
    npmTitle: 'Published on npm',
    npmNote: 'Run the command below to check the live tags for the starter.',
    sourceTitle: 'Source checkout',
    sourceNote: 'Build the starter from the checkout to run the examples in the current guides.',
    previewLabel: 'Preview the source checkout',
    previewHref:
      'https://github.com/open-element/openelement/blob/main/README.md#preview-the-source-checkout',
    stateLabel: 'Registry snapshot',
    historyLabel: 'Read release notes and breaking changes on GitHub',
    onThisPage: 'On this page',
    guide: 'Getting Started',
    roadmap: 'Roadmap',
  },
  zh: {
    title: '更新日志',
    description: '查看各次发布的变更，以及 npm 已发布版本和当前源码版本。',
    npmTitle: 'npm 已发布版本',
    npmNote: '运行下面的命令，查看脚手架当前的 npm 标签。',
    sourceTitle: '当前源码',
    sourceNote: '从当前源码构建脚手架，即可运行当前指南里的示例。',
    previewLabel: '预览当前源码',
    previewHref: 'https://github.com/open-element/openelement/blob/main/README.zh.md#预览当前源码',
    stateLabel: 'npm 注册表快照',
    historyLabel: '在 GitHub 查看发布说明和破坏性变更',
    onThisPage: '本页目录',
    guide: '快速开始',
    roadmap: '路线图',
  },
};

export function PageChangelog(props: {
  title: string;
  description: string;
  npmTitle: string;
  npmNote: string;
  npmVersion: string;
  packages: Array<{ key: string; name: string; version: string; href: string }>;
  sourceTitle: string;
  sourceVersion: string;
  sourceNote: string;
  previewHref: string;
  previewLabel: string;
  stateLabel: string;
  historyLabel: string;
  historyHref: string;
  onThisPage: string;
  stateHref: string;
  guide: string;
  guideHref: string;
  roadmap: string;
  roadmapHref: string;
  locale: string;
}) {
  return (
    <div class='page-changelog' data-pagefind-body>
      <open-reading-shell meta footer locale={props.locale}>
        <div slot='meta'>
          <h1 class='m-0 font-sans text-[clamp(2.1rem,4.6vw,3.4rem)] leading-[1.05] font-extrabold tracking-[-0.035em] text-balance text-foreground'>
            {props.title}
          </h1>
          <p class='mt-4 max-w-[640px] text-[clamp(var(--text-base),1.4vw,var(--text-xl))] leading-[1.65] text-muted-foreground'>
            {props.description}
          </p>
          <a
            class='inline-flex min-h-8 items-center text-primary underline underline-offset-4'
            href={props.historyHref}
          >
            {props.historyLabel}
          </a>
          <nav class='mt-2 flex flex-wrap gap-x-6' aria-label={props.onThisPage}>
            <a
              class='inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-4'
              href='#published'
            >
              {props.npmTitle}
            </a>
            <a
              class='inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-4'
              href='#source'
            >
              {props.sourceTitle}
            </a>
          </nav>
        </div>
        <section id='published' class='mb-10 pt-6' tabindex='-1'>
          <h2 class='mb-3 text-2xl font-extrabold text-foreground'>{props.npmTitle}</h2>
          <p class='mb-4 flex flex-wrap items-baseline gap-3'>
            <span class='rounded-md bg-primary px-2 py-1 font-mono text-xs font-bold text-primary-foreground'>
              latest
            </span>
            <strong class='font-mono text-lg text-foreground'>{props.npmVersion}</strong>
          </p>
          <ul class='mb-4 max-w-[480px] divide-y divide-border border-y border-border'>
            {props.packages.map((pkg) => (
              <li
                key={pkg.key}
                class='flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 font-mono text-sm'
              >
                <a class='wrap-anywhere text-primary underline' href={pkg.href}>
                  {pkg.name}
                </a>
                <span class='text-muted-foreground'>{pkg.version}</span>
              </li>
            ))}
          </ul>
          <p class='mb-2 leading-relaxed text-muted-foreground'>{props.npmNote}</p>
          <pre class='max-w-[480px] overflow-auto rounded-md border border-border bg-muted p-3 font-mono text-sm text-foreground'>
            <code>npm view @openelement/create dist-tags</code>
          </pre>
          <a class='mt-3 inline-block text-primary underline' href={props.stateHref}>
            {props.stateLabel}
          </a>
        </section>
        <section id='source' class='mb-10 pt-6' tabindex='-1'>
          <h2 class='mb-3 text-2xl font-extrabold text-foreground'>{props.sourceTitle}</h2>
          <p class='mb-2 font-mono text-lg font-bold text-foreground'>{props.sourceVersion}</p>
          <p class='mb-3 leading-relaxed text-muted-foreground'>{props.sourceNote}</p>
          <a class='text-primary underline' href={props.previewHref}>
            {props.previewLabel}
          </a>
        </section>
        <div slot='footer' class='flex flex-wrap justify-between gap-3 border-t border-border pt-4'>
          <open-button class='no-underline' variant='ghost' size='sm' href={props.guideHref}>
            {props.guide}
          </open-button>
          <open-button class='no-underline' variant='ghost' size='sm' href={props.roadmapHref}>
            {props.roadmap}
          </open-button>
        </div>
      </open-reading-shell>
    </div>
  );
}

export default definePage(PageChangelog, {
  head({ locale }) {
    const resolved = contentLocale(locale ?? 'en');
    return siteHead({ route: '/changelog', locale: resolved, ...content[resolved] });
  },
  props({ locale }) {
    const resolved = contentLocale(locale ?? 'en');
    return {
      ...content[resolved],
      npmVersion: CURRENT_ALPHA_VERSION,
      packages: Object.entries(PUBLISHED_LATEST).map(([name, version]) => ({
        key: name,
        name,
        version,
        href: `https://www.npmjs.com/package/${name}`,
      })),
      sourceVersion: OPENELEMENT_VERSION,
      stateHref: registryStateUrl,
      historyHref: releaseNotesUrl,
      guideHref: siteHref('/guide/getting-started', resolved),
      roadmapHref: siteHref('/roadmap', resolved),
      locale: resolved,
    };
  },
});
