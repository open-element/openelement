import { definePage } from '@openelement/router';
import { siteHead } from '#site-ui/head.ts';
import { contentLocale } from '#site-ui/locale.ts';
import { localizePath } from '#site-ui/link.ts';
import { packageCountModifier, sourceLineStamp } from '../../data/version.ts';

// The hub is the manual's first entry: it opens the guide section the rest of
// /guide/* fills, so the sidebar tree and the URL tree name the same family.
export const meta = { section: 'Guide', label: 'Docs', order: 0 };

// Package-count phrases derive from release-state truth (data/version.ts), so
// the hub copy moves with the surface and no hand-written numeral can go stale.
const countEn = packageCountModifier('en');
const countZh = packageCountModifier('zh');

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
  },
} as const;

const entrances = {
  en: [
    ['Get started', 'Zero to a running application in three commands.', '/guide/getting-started'],
    ['Tutorial', 'Build a page, an island and a form action, step by step.', '/guide/tutorial'],
    ['API reference', `The ${countEn} surface, export by export.`, '/reference'],
    ['Architecture', 'Who owns what, and why the boundaries hold.', '/architecture'],
    ['Roadmap', 'Where the stable line goes next.', '/roadmap'],
  ],
  zh: [
    ['快速开始', '三条命令，从零到可运行的应用。', '/guide/getting-started'],
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
    const { headTitle: _headTitle, headDescription: _headDescription, ...text } = content[resolved];
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
    };
  },
});
