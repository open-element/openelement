import { definePage } from '@openelement/router';
import { siteHead } from '@openelement/site-ui/head.ts';
import { contentLocale } from '@openelement/site-ui/locale.ts';
import { localizePath } from '@openelement/site-ui/link.ts';
import PageDocs from '../../components/page-docs.tsx';
import { OPENELEMENT_VERSION } from '../../data/version.ts';

export const meta = { section: 'Quick Start', label: 'Docs', order: 0 };

const content = {
  en: {
    headTitle: 'Documentation',
    headDescription:
      'openElement documentation: guides, architecture notes and the supported public surface of the five consumer packages.',
    sidenote: 'Spec-042 · Docs index',
    eyebrow: 'Docs — The manual',
    serifLine: 'Read the',
    monoLine: 'MANUAL.',
    lede: 'Four entrances. Everything else is a footnote.',
    navLabel: 'Documentation entrances',
  },
  zh: {
    headTitle: '文档',
    headDescription: 'openElement 文档：指南、架构说明，以及五个面向使用者包的受支持公开面。',
    sidenote: 'Spec-042 · 文档索引',
    eyebrow: 'Docs — 手册',
    serifLine: '通读',
    monoLine: '手册。',
    lede: '四个入口。其余皆是注脚。',
    navLabel: '文档入口',
  },
} as const;

const entrances = {
  en: [
    ['Get started', 'Zero to a running application in three commands.', '/guide/getting-started'],
    ['API reference', 'The five-package surface, export by export.', '/apilist'],
    ['Architecture', 'Who owns what, and why the boundaries hold.', '/architecture/architecture'],
    ['Roadmap', 'Where the stable line goes next.', '/roadmap'],
  ],
  zh: [
    ['快速开始', '三条命令，从零到可运行的应用。', '/guide/getting-started'],
    ['API 参考', '五个包的接口面，逐个 export 列出。', '/apilist'],
    ['架构', '谁负责什么，以及边界为何成立。', '/architecture/architecture'],
    ['路线图', 'stable 线的下一步走向。', '/roadmap'],
  ],
} as const;

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
      version: OPENELEMENT_VERSION,
      entrance1Title: items[0][0],
      entrance1Copy: items[0][1],
      entrance1Href: localizePath(items[0][2], resolved),
      entrance2Title: items[1][0],
      entrance2Copy: items[1][1],
      entrance2Href: localizePath(items[1][2], resolved),
      entrance3Title: items[2][0],
      entrance3Copy: items[2][1],
      entrance3Href: localizePath(items[2][2], resolved),
      entrance4Title: items[3][0],
      entrance4Copy: items[3][1],
      entrance4Href: localizePath(items[3][2], resolved),
    };
  },
});
